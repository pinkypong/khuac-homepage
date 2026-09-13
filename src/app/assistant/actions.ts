"use server";

import { EQUIPMENT_GUIDANCE, REGION_GUIDANCE } from "@/lib/assistant/answer-guidance";
import { requireApprovedMember } from "@/lib/supabase/require-role";
import {
  classifyQuery,
  extractTimeframe,
  isRouteQuestion,
  weatherSubject,
  type QueryIntent,
} from "@/lib/assistant/intent";
import { findMatchingPlace, type PlaceCandidateHike } from "@/lib/assistant/resolve";
import { buildClubHistoryContext } from "@/lib/assistant/context";
import { suggestRoutes, type RouteSuggestion } from "@/lib/assistant/routes";
import {
  daysInRange,
  fetchForecast,
  geocodePlace,
  resolveTimeframe,
  summarizeForecast,
  type DailyForecast,
} from "@/lib/weather/open-meteo";
import { generateText, generateGroundedText } from "@/lib/gemini/client";
import { ageLabel, cacheKey, isFresh } from "@/lib/assistant/cache";

const MAX_QUESTION_LENGTH = 2000;

export interface AssistantAnswer {
  intent: QueryIntent;
  text: string;
  place: { name: string; lat: number; lng: number } | null;
  /** Only set for a weather answer. Numbers come straight from Open-Meteo, not
      from the model - an LLM is not asked to relay a figure we already have
      exactly, only to reason about what it means. */
  forecastDays?: DailyForecast[];
  /** Only set when the question asked for routes. Waypoints are place names,
      not coordinates - geocoding them into pins happens in the browser. */
  routes?: RouteSuggestion[];
  /** The mountain the routes belong to, which is the folder an album built
      from one of them is filed under. Not the same as `place`: a question can
      ask about somewhere the club has no record of, and that is precisely
      when a new folder has to be created. */
  routePlaceName?: string | null;
  /** A caveat covering the whole outing, shown above the course cards. */
  summary?: string | null;
  sources?: string[];
  /** Set when this answer came from the club cache rather than from a fresh
      pair of Gemini calls, so the panel can say how old it is and offer to
      search again. */
  cachedAge?: string;
}

export interface RecentQuestion {
  question: string;
  ageLabel: string;
}

/**
 * The questions the club has asked recently, newest first. Every one is
 * already paid for, so re-asking one costs nothing - which is the point of
 * putting them on screen.
 */
export async function recentQuestions(): Promise<RecentQuestion[]> {
  const { supabase } = await requireApprovedMember();
  const { data } = await supabase
    .from("assistant_cache")
    .select("question, created_at")
    .order("created_at", { ascending: false })
    .limit(6);
  return ((data ?? []) as unknown as { question: string; created_at: string }[])
    .filter((row) => isFresh(row.created_at))
    .map((row) => ({ question: row.question, ageLabel: ageLabel(row.created_at) }));
}

interface LocationRow {
  id: string;
  name: string;
  lat: number;
  lng: number;
  region: string | null;
}

interface HikeRow {
  id: string;
  title: string;
  location_id: string | null;
  lat: number | null;
  lng: number | null;
}

/**
 * One question in, one answer out - see src/lib/assistant/intent.ts for why
 * this dispatches to three different amounts of work rather than always
 * calling Gemini. "인수봉 위치" and "인수봉 오늘 날씨" never reach the model at
 * all; only a question asking for judgment does.
 */
export async function askAssistant(question: string, refresh = false): Promise<AssistantAnswer> {
  const { supabase, memberId } = await requireApprovedMember();

  const trimmed = question.trim();
  if (!trimmed) throw new Error("질문을 입력해주세요.");
  if (trimmed.length > MAX_QUESTION_LENGTH) throw new Error("질문은 2,000자 이내로 입력해주세요.");

  // Checked before any work is done. 위치 and 날씨 answers are never stored:
  // they cost nothing to produce, and a cached forecast is a wrong forecast.
  const intent = classifyQuery(trimmed);
  const clubQuestion = /동아리|산악부|우리.{0,6}(기록|활동|산행|방문)|지난.{0,6}(산행|활동)/.test(trimmed);
  const venueQuestion = /인공암벽|암벽장|클라이밍장|실내.{0,4}(암벽|등반|클라이밍)|더클라임/.test(trimmed);
  const directQuestion = !clubQuestion && (venueQuestion || (intent === "complex" && !isRouteQuestion(trimmed)));
  const key = cacheKey(trimmed);
  if (!refresh && intent === "complex" && !directQuestion) {
    const { data: hit } = await supabase
      .from("assistant_cache")
      .select("answer, created_at")
      .eq("question_key", key)
      .maybeSingle();
    const row = hit as { answer: AssistantAnswer; created_at: string } | null;
    if (row && isFresh(row.created_at)) return { ...row.answer, cachedAge: ageLabel(row.created_at) };
  }

  if (directQuestion) {
    const prompt = [EQUIPMENT_GUIDANCE, REGION_GUIDANCE, "한국어로 질문에 직접 답하세요. 불필요한 배경 설명 없이 요청한 내용에 집중하세요.", `질문: ${trimmed}`].join("\n");
    if (venueQuestion || /추천|근처|주변|영업|가격/.test(trimmed)) {
      const result = await generateGroundedText([prompt,
        "실제 장소는 반드시 검색으로 확인하세요. 공식 운영자/시설 안내의 정확한 지점명과 주소를 우선 확인하고, 확인되지 않은 장소나 지점명을 만들지 마세요.",
        "각 추천의 근거 출처를 명시하세요. 확인할 수 없는 운영시간, 가격, 거리는 추측하지 마세요. 검색 근거가 없으면 확인하지 못했다고 답하세요.",
        "번호는 1, 2, 3 순서로 작성하세요. 질문에 직접 간결하게 답하세요.",
      ].join("\n"));
      return { intent: "complex", place: null, text: result.sources.length ? result.text : "검색 출처를 확보하지 못해 실제 운영 중인 장소를 확인할 수 없습니다. 잠시 후 다시 시도하거나 지역을 더 좁혀 질문해주세요.", sources: result.sources };
    }
    return { intent, text: await generateText(prompt), place: null };
  }

  const [{ data: locationRows }, { data: hikeRows }] = await Promise.all([
    supabase
      .from("locations")
      .select("id, name, lat, lng, region")
      .not("lat", "is", null)
      .not("lng", "is", null),
    supabase.from("hikes").select("id, title, location_id, lat, lng"),
  ]);

  const locations = (locationRows ?? []) as unknown as LocationRow[];
  const hikeCandidates: PlaceCandidateHike[] = ((hikeRows ?? []) as unknown as HikeRow[])
    .filter((h) => h.location_id !== null)
    .map((h) => ({ id: h.id, title: h.title, locationId: h.location_id as string, lat: h.lat, lng: h.lng }));

  const place = findMatchingPlace(trimmed, locations, hikeCandidates);
  const placeLabel = place
    ? place.hike
      ? `${place.location.name} · ${place.hike.title}`
      : place.location.name
    : null;
  const placeSummary = place && placeLabel ? { name: placeLabel, lat: place.lat, lng: place.lng } : null;

  if (intent === "location") {
    if (!place || !placeSummary) {
      return { intent, text: "동아리 기록에서 그 장소를 찾지 못했습니다.", place: null };
    }
    return { intent, text: `${placeSummary.name}의 위치입니다.`, place: placeSummary };
  }

  if (intent === "weather") {
    // Our own places first, then the wider gazetteer. The club's rows win
    // because they hold coordinates a member actually stood on: Open-Meteo's
    // index knows mountains, not crags, and resolves 백운대 to a 90m spot in
    // 경주 rather than the 836m one on 북한산, while 선인봉 is missing from it
    // entirely. Both are exact in our own table.
    let target = placeSummary;
    let region: string | null = null;

    if (!target) {
      const subject = weatherSubject(trimmed);
      // Averaging our own locations biases the search toward where the club
      // actually goes, which is what settles 청계산 - the name belongs to
      // three different mountains, and the list is not ordered helpfully.
      const bias = averagePoint(locations);
      const found = subject ? await geocodePlace(subject, bias) : null;
      if (!found) {
        return {
          intent,
          text: subject
            ? `'${subject}'의 위치를 찾지 못했습니다. 산 이름을 조금 더 정확히 적어주세요.`
            : "어느 산의 날씨인지 알려주세요. 예: 이번 주말 북한산 날씨",
          place: null,
        };
      }
      target = { name: found.name, lat: found.lat, lng: found.lng };
      region = found.region;
    }

    const forecast = await fetchForecast(target.lat, target.lng);
    const range = resolveTimeframe(extractTimeframe(trimmed));
    const days = daysInRange(forecast, range);
    // The region is spelled out for a place we looked up rather than one of
    // ours, so picking the wrong same-named mountain is visible instead of
    // silently producing somewhere else's weather.
    const label = region ? `${region} ${target.name}` : target.name;
    return {
      intent,
      text:
        days.length > 0
          ? `${label}의 날씨입니다.`
          : `${label}의 요청 기간(${range.from.toISOString().slice(0, 10)}~${range.to.toISOString().slice(0, 10)})에 해당하는 예보가 없습니다. 제공된 예보 기간: ${forecast.days[0]?.date ?? "없음"}~${forecast.days.at(-1)?.date ?? "없음"}.`,
      place: target,
      forecastDays: days,
    };
  }

  // "complex": the one path that pays for a model call, because this is the
  // one kind of question that needs judgment rather than a lookup.
  let clubHistory: string | null = null;
  let weatherContext: string | null = null;
  if (place) {
    if (clubQuestion) clubHistory = await buildClubHistoryContext(supabase, place.location.id, place.location.name);
    try {
      const forecast = await fetchForecast(place.lat, place.lng);
      const range = resolveTimeframe(extractTimeframe(trimmed));
      weatherContext = `날씨 예보:\n${summarizeForecast(daysInRange(forecast, range))}`;
    } catch {
      // Weather is enrichment. Losing it should not block an answer that is
      // otherwise answerable from the club's own history.
    }
  }

  // A route question gets real, current course names via search grounding
  // rather than the model's own static knowledge - and answers regardless of
  // whether the club has been there. "동아리 기록이 없습니다" and stopping
  // there was the wrong instinct: not having gone somewhere is not a reason to
  // withhold what is knowable about it.
  if (isRouteQuestion(trimmed)) {
    const result = await suggestRoutes(placeSummary?.name ?? null, trimmed, [clubHistory, weatherContext].filter(Boolean).join("\n") || null);
    return store(supabase, key, trimmed, memberId, {
      intent,
      text: result.text,
      place: placeSummary,
      routes: result.routes,
      // The club's own folder name wins when the question matched one, so
      // asking about a mountain already on the map adds to that folder rather
      // than starting a second one under the model's spelling of it.
      routePlaceName: place?.location.name ?? result.placeName,
      // Replaces the prose answer when courses were extracted: the cards say
      // the same things in a form that can be tapped onto the map, and the
      // two side by side were the same answer twice.
      summary: result.summary,
      sources: result.sources,
    });
  }
  const context = [clubHistory, weatherContext].filter((c): c is string => c !== null);
  const text = await generateText(buildAssistantPrompt(trimmed, context));
  return store(supabase, key, trimmed, memberId, { intent, text, place: placeSummary });
}

/** Where the club's activity sits, used to settle same-named mountains. */
function averagePoint(rows: LocationRow[]): { lat: number; lng: number } | null {
  if (rows.length === 0) return null;
  const total = rows.reduce((sum, row) => ({ lat: sum.lat + row.lat, lng: sum.lng + row.lng }), { lat: 0, lng: 0 });
  return { lat: total.lat / rows.length, lng: total.lng / rows.length };
}

type Client = Awaited<ReturnType<typeof requireApprovedMember>>["supabase"];

/**
 * Files a freshly generated answer for the rest of the club, then hands it
 * back unchanged. A failed write is logged and swallowed: the member already
 * has their answer, so losing the cache entry is a missed saving rather than
 * a reason to turn a good answer into an error.
 */
async function store(
  supabase: Client,
  key: string,
  question: string,
  memberId: string,
  answer: AssistantAnswer,
): Promise<AssistantAnswer> {
  const { error } = await supabase
    .from("assistant_cache")
    .upsert(
      { question_key: key, question, answer, asked_by: memberId, created_at: new Date().toISOString() },
      { onConflict: "question_key" },
    );
  if (error) console.error("[assistant/cache] store failed", error.message);
  return answer;
}

function buildAssistantPrompt(question: string, context: string[]): string {
  return [
    "당신은 대학 산악부 동아리의 산행 도우미입니다. 동아리원의 질문에 답합니다.",
    "아래에 동아리 자체 활동 기록과 날씨 예보가 있다면 그것을 참고하세요.",
    "동아리 기록이 없더라도 답을 피하지 말고, 일반적인 등산 상식과 알고 있는 정보로 실질적인 답을 주세요.",
    "확실하지 않은 사실을 단정하지 마세요.",
    EQUIPMENT_GUIDANCE,
    REGION_GUIDANCE,
    "한국어로 질문의 각 조건에 충분히 답하세요. 비교는 목록을 활용하고, 불필요한 반복은 피하세요.",
    "",
    context.length > 0 ? context.join("\n\n") : "(동아리 기록 없음)",
    "",
    `질문: ${question}`,
  ].join("\n");
}
