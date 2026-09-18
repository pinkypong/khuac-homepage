"use server";

import { CLIMBING_GUIDANCE, CRAG_SCREENING, EQUIPMENT_GUIDANCE, REGION_GUIDANCE, STYLE_GUIDANCE } from "@/lib/assistant/answer-guidance";
import { requireApprovedMember } from "@/lib/supabase/require-role";
import {
  classifyQuery,
  extractTimeframe,
  isClimbingQuestion,
  isRouteQuestion,
  weatherSubject,
  type QueryIntent,
} from "@/lib/assistant/intent";
import { findMatchingPlace, type PlaceCandidateHike } from "@/lib/assistant/resolve";
import { buildClubHistoryContext } from "@/lib/assistant/context";
import { closureNotice, extractRoutes, searchRoutes, selectFromLibrary, type LibraryCourse, type RouteSuggestion } from "@/lib/assistant/routes";
import {
  daysInRange,
  fetchForecast,
  geocodePlace,
  resolveTimeframe,
  summarizeForecast,
  type DailyForecast,
} from "@/lib/weather/open-meteo";
import { generateText, generateGroundedText, type GroundedSource } from "@/lib/gemini/client";
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
  /** True while the search answer is here and the cards are not. The browser
      asks for them next; until it does, the prose is the whole answer. */
  routesPending?: boolean;
  /** The mountain the routes belong to, which is the folder an album built
      from one of them is filed under. Not the same as `place`: a question can
      ask about somewhere the club has no record of, and that is precisely
      when a new folder has to be created. */
  routePlaceName?: string | null;
  /** A caveat covering the whole outing, shown above the course cards. */
  summary?: string | null;
  /** What is closed on this mountain today, searched every time because it is
      the one part of an answer a stored course cannot know. */
  closures?: string | null;
  sources?: GroundedSource[];
  /** Set when this answer came from the club cache rather than from a fresh
      pair of Gemini calls, so the panel can say how old it is and offer to
      search again. */
  cachedAge?: string;
  /** Why there is no answer, in the member's own language.

      Returned rather than thrown because a built Worker is a production build,
      and Next replaces the message of anything a server action throws with a
      generic one before it reaches the browser. Every message in
      gemini/client.ts - the depleted credits, the quota, the region block, each
      written to tell a member what to do next - was being swallowed on the way
      out, and what showed instead was React's own English placeholder. */
  failure?: string;
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

/**
 * Takes a question off the recent list.
 *
 * The cached answer goes with it, so the next person to ask pays for it again.
 * That is the whole cost, and it is smaller than leaving a question somebody
 * asked by mistake on screen for a fortnight.
 */
export async function forgetQuestion(question: string): Promise<void> {
  const { supabase } = await requireApprovedMember();
  // Matched on the question itself, not on its key. The key carries the prompt
  // version it was stored under - the table holds v2, v3 and rows from before
  // versioning existed - while cacheKey() only ever builds today's. Asking by
  // key meant the delete matched nothing and said nothing, which on screen was
  // a chip that would not go away.
  const { error } = await supabase
    .from("assistant_cache")
    .delete()
    .eq("question", question);
  if (error) throw new Error(error.message);
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
  // Membership is checked outside the catch: not being signed in is not an
  // answer with a reason on it, it is a request that should not have arrived,
  // and the app already has a place for it.
  const session = await requireApprovedMember();
  try {
    return await produceAnswer(session, question, refresh);
  } catch (error) {
    // Everything past here is an expected way for this to fail - the model
    // timed out, the quota is gone, the region is blocked - and each already
    // carries a sentence written for the member.
    const failure = error instanceof Error
      ? error.message
      : "답을 가져오지 못했습니다. 잠시 후 다시 시도해주세요.";
    console.error("[assistant] 실패", failure);
    return { intent: "complex", text: "", place: null, failure };
  }
}

async function produceAnswer(
  { supabase, memberId }: Awaited<ReturnType<typeof requireApprovedMember>>,
  question: string,
  refresh: boolean,
): Promise<AssistantAnswer> {

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
  if (!refresh && intent === "complex") {
    const { data: hit } = await supabase
      .from("assistant_cache")
      .select("answer, created_at")
      .eq("question_key", key)
      .maybeSingle();
    const row = hit as { answer: AssistantAnswer; created_at: string } | null;
    if (row && isFresh(row.created_at)) return { ...row.answer, cachedAge: ageLabel(row.created_at) };
  }

  if (directQuestion) {
    const climbing = isClimbingQuestion(trimmed);
    const prompt = [EQUIPMENT_GUIDANCE, REGION_GUIDANCE, STYLE_GUIDANCE, climbing ? CLIMBING_GUIDANCE : null, climbing ? CRAG_SCREENING : null, "한국어로 질문에 직접 답하세요. 불필요한 배경 설명 없이 요청한 내용에 집중하세요.", `질문: ${trimmed}`].filter(Boolean).join("\n");
    if (venueQuestion || /추천|근처|주변|영업|가격/.test(trimmed)) {
      const visited = await visitedPlaces(supabase);
      const result = await generateGroundedText([prompt,
        // The club's own album is the one source here that knows whether a
        // place was worth going to. A crag can be real, close and still be a
        // 7m practice rock; somewhere the club has actually been has already
        // passed that judgment, so it leads rather than competing on equal
        // footing with whatever the search turns up.
        visited.length > 0
          ? `동아리가 실제로 다녀온 곳(우선 추천 대상): ${visited.join(", ")}
질문 조건에 맞는 곳이 이 목록에 있으면 먼저 추천하고 '동아리 방문 기록 있음'이라고 밝히세요. 목록에 없다는 이유로 다른 곳을 배제하지는 마세요.`
          : null,
        "실제 장소는 반드시 검색으로 확인하세요. 공식 운영자/시설 안내의 정확한 지점명과 주소를 우선 확인하고, 확인되지 않은 장소나 지점명을 만들지 마세요.",
        "각 추천의 근거 출처를 명시하세요. 확인할 수 없는 운영시간, 가격, 거리는 추측하지 마세요. 검색 근거가 없으면 확인하지 못했다고 답하세요.",
        "번호는 1, 2, 3 순서로 작성하세요. 질문에 직접 간결하게 답하세요.",
      ].join("\n"));
      const answer: AssistantAnswer = { intent: "complex", place: null, text: result.sources.length ? result.text : "검색 출처를 확보하지 못해 실제 운영 중인 장소를 확인할 수 없습니다. 잠시 후 다시 시도하거나 지역을 더 좁혀 질문해주세요.", sources: result.sources };
      // Stored like any other paid answer: without this, re-opening it from
      // the recent list paid for the same search all over again.
      return result.sources.length ? store(supabase, key, trimmed, memberId, answer) : answer;
    }
    return store(supabase, key, trimmed, memberId, { intent, text: await generateText(prompt), place: null });
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
    // What we already hold, read against the question instead of searched for.
    // A grounded search costs 27 seconds and is spent again on every
    // rephrasing; the courses themselves barely change, so only the reading is
    // worth paying for once we know the mountain. A table read, not a model
    // call, so it settles which mountain this is before anything slow starts.
    const held = await libraryFor(supabase, trimmed, place?.location.name ?? placeSummary?.name ?? null);
    const mountain = held?.mountain ?? place?.location.name ?? placeSummary?.name ?? null;

    // Started here, not awaited here. Today's closures are a grounded search of
    // their own, and it used to run after the courses had been found: two
    // 27-second searches end to end, past the 60-second deadline the Gemini
    // client gives a call, so "북한산 고독길 어프로치 루트" came back as a
    // timeout rather than as an answer. Nothing about what is shut depends on
    // which courses we offer, so it runs alongside them.
    //
    // Failure is already swallowed inside - saying nothing about closures is
    // honest, claiming nothing is closed would not be - and this keeps that
    // true for a rejection nobody is awaiting yet.
    const closures = closuresFor(supabase, mountain).catch(() => null);
    // Two mountains share this name and the question did not say which. Asking
    // costs a sentence; picking one and being wrong half the time costs the
    // member a walk up the wrong mountain, and they would have no way to tell
    // from the answer that a choice had been made at all.
    if (held?.kind === "ambiguous") {
      return store(supabase, key, trimmed, memberId, {
        intent,
        text: askWhichMountain(held.mountain, held.regions),
        place: placeSummary,
        routes: [],
        closures: await closures,
      });
    }

    if (held) {
      const picked = await selectFromLibrary(
        held.mountain,
        trimmed,
        held.courses,
        [clubHistory, weatherContext].filter(Boolean).join("\n") || null,
      );
      // An empty answer means nothing we hold fits the question, which is a
      // reason to go and look rather than to say there is nothing.
      if (picked.routes.length > 0) {
        return store(supabase, key, trimmed, memberId, {
          intent,
          text: "",
          place: placeSummary,
          routes: picked.routes,
          routePlaceName: place?.location.name ?? picked.placeName,
          summary: picked.summary,
          // Always current, never from the library: a course written last
          // month cannot know what shut this morning. Asked about the mountain
          // the question named; the library's own name for it can differ, and
          // the member asked about theirs.
          closures: await closures,
          sources: picked.sources,
        });
      }
    }

    // Returned as soon as the search answer exists. Turning it into cards is a
    // second model call that cannot start until this one has finished, and
    // waiting for both before showing anything is what made a slow answer feel
    // like a broken one.
    const found = await searchRoutes(
      placeSummary?.name ?? null,
      trimmed,
      [clubHistory, weatherContext].filter(Boolean).join("\n") || null,
      isClimbingQuestion(trimmed),
    );
    return store(supabase, key, trimmed, memberId, {
      intent,
      text: found.text,
      place: placeSummary,
      routes: [],
      // The browser asks for the cards next. Stored this way too, so a reader
      // who leaves and comes back finds the answer rather than nothing.
      routesPending: true,
      // The club's own folder name wins when the question matched one, so
      // asking about a mountain already on the map adds to that folder rather
      // than starting a second one under the model's spelling of it.
      routePlaceName: place?.location.name ?? null,
      summary: null,
      closures: await closures,
      sources: found.sources,
    });
  }

  const context = [clubHistory, weatherContext].filter((c): c is string => c !== null);
  const text = await generateText(buildAssistantPrompt(trimmed, context));
  return store(supabase, key, trimmed, memberId, { intent, text, place: placeSummary });
}

/**
 * The cards for an answer whose search half is already on screen.
 *
 * Kept as its own request because the two model calls are serial and together
 * took 33 seconds, of which our own code was 30 milliseconds. Nothing here is
 * re-searched: the prose and its sources come back out of the cache row the
 * first call wrote, and this pays only for the formatting.
 */
export async function finishRouteAnswer(question: string): Promise<AssistantAnswer | null> {
  const { supabase, memberId } = await requireApprovedMember();
  const trimmed = question.trim();
  if (!trimmed) return null;
  const key = cacheKey(trimmed);

  const { data } = await supabase
    .from("assistant_cache")
    .select("answer")
    .eq("question_key", key)
    .maybeSingle();
  const stored = (data as { answer: AssistantAnswer } | null)?.answer ?? null;
  // Someone else finished it, or the row is gone. Either way there is nothing
  // to do and nothing to correct on screen.
  if (!stored || !stored.routesPending) return stored;

  const result = await extractRoutes(stored.text, stored.sources ?? [], stored.routePlaceName ?? null);
  // Filed while we have it, so the next question about this mountain reads the
  // list instead of searching for it again.
  await rememberCourses(supabase, stored.routePlaceName ?? result.placeName, result.routes);
  return store(supabase, key, trimmed, memberId, {
    ...stored,
    routes: result.routes,
    routePlaceName: stored.routePlaceName ?? result.placeName,
    // Replaces the prose answer when courses were extracted: the cards say the
    // same things in a form that can be tapped onto the map, and the two side
    // by side were the same answer twice.
    summary: result.summary,
    routesPending: false,
  });
}

/**
 * Today's closures for a mountain, asked once a day rather than once a question.
 *
 * It has to be searched - a course written last month cannot know what shut
 * this morning - but it does not have to be searched by everyone who asks.
 * Held under its own key so it expires on its own schedule, separate from the
 * answers that quote it.
 */
async function closuresFor(supabase: Client, mountain: string | null): Promise<string | null> {
  if (!mountain) return null;
  const key = `closure:${new Date().toISOString().slice(0, 10)}:${mountain}`;
  const { data } = await supabase
    .from("assistant_cache")
    .select("answer")
    .eq("question_key", key)
    .maybeSingle();
  const held = (data as { answer: { closures?: string | null } } | null)?.answer;
  if (held) return held.closures ?? null;

  let closures: string | null = null;
  try {
    closures = await closureNotice(mountain);
  } catch {
    // A failed closure check must not cost the courses. Saying nothing is
    // honest; claiming nothing is closed would not be.
    return null;
  }
  const { error } = await supabase.from("assistant_cache").upsert(
    {
      question_key: key,
      question: `${mountain} 탐방로 통제 (${new Date().toISOString().slice(0, 10)})`,
      answer: { intent: "complex", text: closures ?? "", place: null, closures },
      created_at: new Date().toISOString(),
    },
    { onConflict: "question_key" },
  );
  if (error) console.error("[assistant/closures] store failed", error.message);
  return closures;
}

/** Enough of a mountain held that asking the web again is not worth 27 seconds. */
const LIBRARY_ENOUGH = 3;

/**
 * How far a course is to be trusted, by where it came from.
 *
 * A walked track beats a surveyed one, a surveyed one beats a member's memory,
 * and all three beat a sentence off a web page - so a row is ranked by its
 * origin and the better row wins when two describe the same course.
 *
 *   gpx     a track somebody actually walked, with the club's own GPS behind it
 *   knps    국립공원공단's survey: stated distance checked against its own
 *           measured line before it was filed
 *   club    a member wrote it down
 *   search  a grounded web search said so, and nothing has checked it
 *
 * search sits last and is still kept, because for 불암산 or 수락산 it is all
 * there is: nothing holds those mountains, and an unchecked answer beats no
 * answer. It is the row a better source is expected to replace later.
 */
const ORIGIN_RANK: Record<string, number> = { gpx: 5, knps: 4, club: 3, forest: 2, search: 1 };
/**
 * An origin nobody listed ranks with `search`, not below it.
 *
 * It used to fall to 0, which is lower than every real source - so a row filed
 * under an origin added later would sort last and, worse, `rememberCourses`
 * would let a web search overwrite it, because its guard asks whether the held
 * row outranks `search`. That is exactly what happened to the 502 rows imported
 * as `forest` before it was named here.
 */
const rankOf = (origin: string | null | undefined) => ORIGIN_RANK[origin ?? "search"] ?? ORIGIN_RANK.search;

interface LibraryRow {
  mountain: string;
  name: string;
  region: string | null;
  origin: string | null;
  waypoints: string[];
  distance_text: string | null;
  duration_text: string | null;
  difficulty: string | null;
  description: string | null;
  notes: string | null;
  sources: string[];
}

/**
 * The long forms of a province, and what a member actually types instead.
 *
 * 산림청 writes 전남 on one row and 전라남도 on the next, for mountains twenty
 * kilometres apart. Neither is what gets typed: somebody asking about the
 * 계룡산 in 거제 types "거제", not "경상남도" and not "거제시".
 */
/**
 * Every spelling of a province, and the one this code calls it.
 *
 * Sources disagree and the disagreement is not cosmetic. 국립공원공단's rows get
 * their region from OSM, which already says 전북특별자치도 and 강원특별자치도;
 * 산림청 still writes 전라북도 and 강원도, and shortens either to 전북 and 강원
 * from one row to the next. 광주광역시 and 전라남도 were merged into
 * 광주전남특별시 on 2026-07-01 - OSM answers with the merged name, 산림청 has
 * not caught up - and that merged thing is a province containing 여수, 순천 and
 * 담양, not another name for 광주 the city.
 */
const PROVINCES: [string, string[]][] = [
  ["전남광주", ["광주전남특별시", "광주전남특별통합시", "전남광주통합특별시", "전라남도", "광주광역시", "전남"]],
  ["전북", ["전북특별자치도", "전라북도", "전북"]],
  ["강원", ["강원특별자치도", "강원도", "강원"]],
  ["제주", ["제주특별자치도", "제주도", "제주"]],
  ["경남", ["경상남도", "경남"]], ["경북", ["경상북도", "경북"]],
  ["충남", ["충청남도", "충남"]], ["충북", ["충청북도", "충북"]],
  ["경기", ["경기도", "경기"]], ["서울", ["서울특별시", "서울시", "서울"]],
  ["부산", ["부산광역시"]], ["대구", ["대구광역시"]], ["인천", ["인천광역시"]],
  ["대전", ["대전광역시"]], ["울산", ["울산광역시"]], ["세종", ["세종특별자치시"]],
];

/**
 * The city whose 구 a bare 구 belongs to, inside each province.
 *
 * A mountain crosses borough lines - 무등산 stands in 광주's 동구 and 북구, and
 * 산림청 names the first while the park's own centre falls in the second - so a
 * borough is folded into its city or one mountain reads as two.
 */
const BOROUGH_CITY: Record<string, string> = {
  전남광주: "광주", 서울: "서울", 부산: "부산", 대구: "대구",
  인천: "인천", 대전: "대전", 울산: "울산",
};

/** 전남 and 경북 carry no suffix, so they are matched as whole words. */
const PLACE_TOKEN =
  /(?:전남|전북|경남|경북|충남|충북|강원|경기|제주|서울)(?![가-힣])|[가-힣]{1,7}(?:특별자치도|특별통합시|통합특별시|특별자치시|특별시|광역시|도|시|군|구)/g;

/**
 * Where a region string says the mountain is, as province-qualified places.
 *
 * Province-qualified because a district name alone is not a place: 경기도 광주시
 * and the 광주 in 전남광주 are 107km apart, and a 태화산 stands near each.
 *
 * A district rather than a province because provinces are what the sources
 * spell differently, and because a province is too coarse - 전남광주 holds
 * several mountains of one name.
 */
function placesOf(region: string | null): string[] {
  if (!region) return [];
  const places = new Set<string>();
  let province: string | null = null;
  for (const token of region.match(PLACE_TOKEN) ?? []) {
    const canonical = PROVINCES.find(([, spellings]) => spellings.includes(token))?.[0];
    if (canonical) {
      province = canonical;
      // 광주광역시 names a province here and a city as well; both are meant.
      if (token === "광주광역시") places.add("전남광주/광주");
      continue;
    }
    if (token.length < 2) continue;
    if (token.endsWith("구")) {
      const city = province ? BOROUGH_CITY[province] : undefined;
      if (city) places.add(`${province}/${city}`);
      continue;
    }
    if (token.endsWith("시") || token.endsWith("군")) places.add(`${province}/${token}`);
  }
  return [...places];
}

const PROVINCE_ALIAS: Record<string, string[]> = {
  전라남도: ["전남"], 전라북도: ["전북"], 경상남도: ["경남"], 경상북도: ["경북"],
  충청남도: ["충남"], 충청북도: ["충북"], 강원특별자치도: ["강원도", "강원"],
  제주특별자치도: ["제주도", "제주"], 서울특별시: ["서울시", "서울"],
  인천광역시: ["인천"], 대전광역시: ["대전"], 대구광역시: ["대구"],
  부산광역시: ["부산"], 울산광역시: ["울산"], 광주광역시: ["광주"],
  세종특별자치시: ["세종"], 경기도: ["경기"], 강원도: ["강원"],
  광주전남특별시: ["광주전남", "전남광주", "전남"],
};

/** Every way a member might name the place a region string describes. */
function regionWords(region: string | null): string[] {
  if (!region) return [];
  const words = new Set<string>();
  for (const part of region.split(/[\s,·ㆍ]+/)) {
    const word = part.trim();
    if (word.length < 2) continue;
    words.add(word);
    for (const alias of PROVINCE_ALIAS[word] ?? []) words.add(alias);
    // 거제시 is 거제, 구이면 is 구이. The suffix is how an address is written,
    // not how the place is spoken about.
    const bare = word.replace(/(특별자치도|특별자치시|특별시|광역시|[시군구읍면동리])$/, "");
    if (bare.length >= 2) words.add(bare);
  }
  return [...words];
}

/**
 * What the library can answer with: one mountain's courses, or the fact that
 * the name belongs to more than one mountain and nothing in the question says
 * which.
 */
export type LibraryHit =
  | { kind: "courses"; mountain: string; courses: LibraryCourse[] }
  | { kind: "ambiguous"; mountain: string; regions: string[] };

/**
 * The mountain a route question is about, when we hold courses for one.
 *
 * Named outright in most questions. Not in "도선사로 하산하는 코스", which
 * names only a place on the way - so the waypoints we already hold are read
 * too, and the mountain whose courses mention it wins.
 */
async function libraryFor(
  supabase: Client,
  question: string,
  placeName: string | null,
): Promise<LibraryHit | null> {
  const { data } = await supabase
    .from("course_library")
    .select(
      "mountain, name, region, origin, waypoints, distance_text, duration_text, difficulty, description, notes, sources",
    );
  const rows = (data ?? []) as unknown as LibraryRow[];
  if (rows.length === 0) return null;

  // Scored per mountain, not per name. Seventeen names in the library belong to
  // more than one mountain, and keying on the name alone added 계룡산 in 공주
  // and 계룡산 in 거제 into one number and then handed back every row with that
  // name - three mountains' courses offered as one mountain's list, which the
  // model has no way to see and would answer from confidently.
  // Rows of one name gathered into actual mountains, by whether they name any
  // district in common.
  //
  // Comparing the region strings themselves does not work, because a mountain
  // stands in several districts and each source writes down a different part of
  // it. 지리산's park rows say 경상남도 함양군, from the single point at the
  // centre of what the agency surveyed; 산림청 writes 전라북도 남원시,
  // 전라남도 구례군, 경상남도 하동군ㆍ산청군ㆍ함양군 for the same mountain. They
  // share 함양군, and that is what says they are the same.
  //
  // Checked over all 33 shared names in the library: 14 are one mountain
  // written down differently, 19 are genuinely separate. Confirmed against
  // coordinates - for every pair called separate, the two peaks of that name
  // are at least 41km apart, and the closest pair called the same shares a
  // district. The two methods disagreed nowhere.
  const mountains: { mountain: string; places: Set<string>; rows: LibraryRow[] }[] = [];
  // Rows that say where they are, first. A row without a region cannot be
  // placed against them until they exist, and letting it go first would have it
  // adopt whichever group happened to come back from PostgREST first - which is
  // what put 가야산's seven park courses, which are in 합천, into the 서산 group.
  const placed = rows.map((row) => ({ row, places: new Set(placesOf(row.region)) }));
  for (const { row, places } of placed.filter((entry) => entry.places.size > 0)) {
    const existing = mountains.find(
      (candidate) =>
        candidate.mountain === row.mountain &&
        [...places].some((place) => candidate.places.has(place)),
    );
    if (existing) {
      for (const place of places) existing.places.add(place);
      existing.rows.push(row);
    } else {
      mountains.push({ mountain: row.mountain, places: new Set(places), rows: [row] });
    }
  }
  const unplaced = new Map<string, typeof mountains[number]>();
  for (const { row } of placed.filter((entry) => entry.places.size === 0)) {
    const groups = mountains.filter((candidate) => candidate.mountain === row.mountain);
    // Exactly one mountain carries this name, so there is nowhere else it could
    // be. Where the name is shared it stays out: a course filed under the wrong
    // one of two mountains is worse than one the member is asked about.
    if (groups.length === 1) {
      groups[0].rows.push(row);
      continue;
    }
    // All of them together, not one group each. They are courses on the same
    // mountain - we just cannot say which of the mountains with this name it is.
    const waiting = unplaced.get(row.mountain);
    if (waiting) waiting.rows.push(row);
    else {
      const group = { mountain: row.mountain, places: new Set<string>(), rows: [row] };
      unplaced.set(row.mountain, group);
      mountains.push(group);
    }
  }

  const score = new Map<number, number>();
  mountains.forEach((candidate, index) => {
    let hit = 0;
    if (placeName && candidate.mountain === placeName) hit += 100;
    if (question.includes(candidate.mountain)) hit += 50;
    // Enough to settle a name shared by two mountains, not enough to beat the
    // mountain the question actually names: "거제" picks between two 계룡산, it
    // does not turn a question about 계룡산 into one about somewhere else.
    const words = candidate.rows.flatMap((row) => regionWords(row.region));
    if (words.some((word) => question.includes(word))) hit += 30;
    for (const row of candidate.rows) {
      for (const waypoint of row.waypoints) {
        if (waypoint.length >= 2 && question.includes(waypoint)) hit += 5;
      }
    }
    if (hit > 0) score.set(index, hit);
  });
  const ranked = [...score].sort((a, b) => b[1] - a[1]);
  const best = ranked[0];
  if (!best) return null;
  const picked = mountains[best[0]];

  // Two mountains of one name, and nothing in the question told them apart -
  // no district named, no waypoint only one of them has. Answering from either
  // is answering the wrong question half the time, and the member could not
  // tell from the answer that a choice had been made, so ask which.
  const tied = ranked.filter(
    ([index, points]) => mountains[index].mountain === picked.mountain && points === best[1],
  );
  if (tied.length > 1) {
    return {
      kind: "ambiguous",
      mountain: picked.mountain,
      regions: tied
        .map(([index]) => mountains[index].rows.find((row) => row.region)?.region ?? "")
        .filter(Boolean),
    };
  }

  // Best source first. The model is told to fold courses that are the same
  // course under different names into one; which of them it keeps should not
  // depend on the order PostgREST happened to return.
  const courses = picked.rows
    .slice()
    .sort((a, b) => rankOf(b.origin) - rankOf(a.origin))
    .map((row) => ({
      name: row.name,
      waypoints: row.waypoints ?? [],
      distanceText: row.distance_text,
      durationText: row.duration_text,
      difficulty: row.difficulty,
      description: row.description,
      notes: row.notes,
      sources: row.sources ?? [],
    }));
  return courses.length >= LIBRARY_ENOUGH ? { kind: "courses", mountain: picked.mountain, courses } : null;
}

/**
 * What to say when a name belongs to more than one mountain.
 *
 * The regions as their agency wrote them are an address, not an answer: nobody
 * picks between "대전광역시, 충청남도 공주시 계룡면ㆍ논산시 상월면" and
 * "경상남도 거제시 신현읍, 거제면" comfortably. The first two words of each are
 * what distinguishes them.
 */
function askWhichMountain(mountain: string, regions: string[]): string {
  const shortened = regions.map((region) => region.split(/[,ㆍ·]/)[0].split(/\s+/).slice(0, 2).join(" "));
  const lines = [`${mountain}이라는 이름의 산이 ${regions.length}곳입니다. 어디를 말씀하시나요?`];
  for (const where of shortened) lines.push(`· ${where}`);
  return lines.join("\n");
}

/** Files what a search found, so the next question about this mountain is fast. */
async function rememberCourses(
  supabase: Client,
  mountain: string | null,
  routes: RouteSuggestion[],
): Promise<void> {
  if (!mountain || routes.length === 0) return;

  // What a search found must not overwrite what a survey or a member filed.
  // The upsert below keys on (mountain, name), so a search answer that lands on
  // an existing name replaces it - and the row it replaced may be the one whose
  // distance was checked against a measured line. Read the names first and drop
  // the ones already held by a better source.
  //
  // Two searches racing here can still both pass this check and the later write
  // wins; that costs one search row overwriting another, which is what would
  // have happened anyway. It is the knps/club/gpx rows this is protecting.
  const { data: existing } = await supabase
    .from("course_library")
    .select("name, origin")
    .eq("mountain", mountain)
    .in("name", routes.map((route) => route.name));
  const heldBetter = new Set(
    ((existing ?? []) as { name: string; origin: string | null }[])
      .filter((row) => rankOf(row.origin) > rankOf("search"))
      .map((row) => row.name),
  );

  const rows = routes.filter((route) => !heldBetter.has(route.name)).map((route) => ({
    mountain,
    name: route.name,
    waypoints: route.waypoints,
    distance_text: route.distanceText,
    duration_text: route.durationText,
    difficulty: route.difficulty,
    description: route.description,
    notes: route.notes,
    sources: route.sourceUrls ?? [],
    origin: "search",
    updated_at: new Date().toISOString(),
  }));
  if (rows.length === 0) return;
  const { error } = await supabase.from("course_library").upsert(rows, { onConflict: "mountain,name" });
  if (error) console.error("[assistant/library] store failed", error.message);
}

/** Where the club's activity sits, used to settle same-named mountains. */
function averagePoint(rows: LocationRow[]): { lat: number; lng: number } | null {
  if (rows.length === 0) return null;
  const total = rows.reduce((sum, row) => ({ lat: sum.lat + row.lat, lng: sum.lng + row.lng }), { lat: 0, lng: 0 });
  return { lat: total.lat / rows.length, lng: total.lng / rows.length };
}

type Client = Awaited<ReturnType<typeof requireApprovedMember>>["supabase"];

/**
 * Names of places the club has been to, newest first.
 *
 * Deliberately just the names: this is fed to the model as a preference, not
 * as data to repeat, and a longer payload would only invite it to quote rows
 * back as if they were search results.
 */
async function visitedPlaces(supabase: Client): Promise<string[]> {
  const { data } = await supabase
    .from("locations")
    .select("name, created_at")
    .order("created_at", { ascending: false })
    .limit(40);
  return ((data ?? []) as unknown as { name: string }[])
    .map((row) => row.name)
    .filter((name) => !!name);
}

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
    STYLE_GUIDANCE,
    "한국어로 질문의 각 조건에 충분히 답하세요. 비교는 목록을 활용하고, 불필요한 반복은 피하세요.",
    "",
    context.length > 0 ? context.join("\n\n") : "(동아리 기록 없음)",
    "",
    `질문: ${question}`,
  ].join("\n");
}
