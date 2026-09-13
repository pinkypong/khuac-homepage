"use server";

import { requireApprovedMember } from "@/lib/supabase/require-role";
import {
  classifyQuery,
  extractTimeframe,
  isRouteQuestion,
  type QueryIntent,
} from "@/lib/assistant/intent";
import { findMatchingPlace, type PlaceCandidateHike } from "@/lib/assistant/resolve";
import { buildClubHistoryContext } from "@/lib/assistant/context";
import { suggestRoutes, type RouteSuggestion } from "@/lib/assistant/routes";
import {
  daysInRange,
  fetchForecast,
  resolveTimeframe,
  summarizeForecast,
  type DailyForecast,
} from "@/lib/weather/open-meteo";
import { generateText } from "@/lib/gemini/client";

const MAX_QUESTION_LENGTH = 200;

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
export async function askAssistant(question: string): Promise<AssistantAnswer> {
  const { supabase } = await requireApprovedMember();

  const trimmed = question.trim().slice(0, MAX_QUESTION_LENGTH);
  if (!trimmed) throw new Error("질문을 입력해주세요.");

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

  const intent = classifyQuery(trimmed);

  if (intent === "location") {
    if (!place || !placeSummary) {
      return { intent, text: "동아리 기록에서 그 장소를 찾지 못했습니다.", place: null };
    }
    return { intent, text: `${placeSummary.name}의 위치입니다.`, place: placeSummary };
  }

  if (intent === "weather") {
    if (!place || !placeSummary) {
      return {
        intent,
        text: "동아리 기록에서 그 장소를 찾지 못해 날씨를 확인할 수 없습니다.",
        place: null,
      };
    }
    const forecast = await fetchForecast(place.lat, place.lng);
    const range = resolveTimeframe(extractTimeframe(trimmed));
    const days = daysInRange(forecast, range);
    return {
      intent,
      text:
        days.length > 0
          ? `${placeSummary.name}의 날씨입니다.`
          : `${placeSummary.name}의 해당 기간 예보를 아직 받아올 수 없습니다.`,
      place: placeSummary,
      forecastDays: days,
    };
  }

  // "complex": the one path that pays for a model call, because this is the
  // one kind of question that needs judgment rather than a lookup.
  let clubHistory: string | null = null;
  let weatherContext: string | null = null;
  if (place) {
    clubHistory = await buildClubHistoryContext(supabase, place.location.id, place.location.name);
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
  if (isRouteQuestion(trimmed) && placeSummary) {
    const routes = await suggestRoutes(placeSummary.name, trimmed, clubHistory);
    return {
      intent,
      text:
        routes.length > 0
          ? `${placeSummary.name} 코스 ${routes.length}개를 찾았습니다.`
          : `${placeSummary.name}의 코스를 찾지 못했습니다. 다른 표현으로 다시 물어봐주세요.`,
      place: placeSummary,
      routes,
    };
  }

  const context = [clubHistory, weatherContext].filter((c): c is string => c !== null);
  const text = await generateText(buildAssistantPrompt(trimmed, context));
  return { intent, text, place: placeSummary };
}

function buildAssistantPrompt(question: string, context: string[]): string {
  return [
    "당신은 대학 산악부 동아리의 산행 도우미입니다. 동아리원의 질문에 답합니다.",
    "아래에 동아리 자체 활동 기록과 날씨 예보가 있다면 그것을 참고하세요.",
    "동아리 기록이 없더라도 답을 피하지 말고, 일반적인 등산 상식과 알고 있는 정보로 실질적인 답을 주세요.",
    "확실하지 않은 사실을 단정하지 마세요.",
    "한국어로, 3~5문장 정도로 답하세요.",
    "",
    context.length > 0 ? context.join("\n\n") : "(동아리 기록 없음)",
    "",
    `질문: ${question}`,
  ].join("\n");
}
