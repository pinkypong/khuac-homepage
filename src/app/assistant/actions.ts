"use server";

import { requireApprovedMember } from "@/lib/supabase/require-role";
import { classifyQuery, extractTimeframe, type QueryIntent } from "@/lib/assistant/intent";
import { findMatchingPlace, type PlaceCandidateHike } from "@/lib/assistant/resolve";
import { buildClubHistoryContext } from "@/lib/assistant/context";
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
  const context: string[] = [];
  if (place) {
    context.push(await buildClubHistoryContext(supabase, place.location.id, place.location.name));
    try {
      const forecast = await fetchForecast(place.lat, place.lng);
      const range = resolveTimeframe(extractTimeframe(trimmed));
      context.push(`날씨 예보:\n${summarizeForecast(daysInRange(forecast, range))}`);
    } catch {
      // Weather is enrichment. Losing it should not block an answer that is
      // otherwise answerable from the club's own history.
    }
  }

  const text = await generateText(buildAssistantPrompt(trimmed, context));
  return { intent, text, place: placeSummary };
}

function buildAssistantPrompt(question: string, context: string[]): string {
  return [
    "당신은 대학 산악부 동아리의 산행 도우미입니다. 동아리원의 질문에 답합니다.",
    "아래에 동아리 자체 활동 기록과 날씨 예보가 있다면 그것을 우선 근거로 답하세요.",
    "동아리 기록이 없는 장소라면 그렇게 말하고, 일반적인 등산 상식으로 보충하세요.",
    "확실하지 않은 사실을 단정하지 마세요.",
    "한국어로, 3~5문장 정도로 답하세요.",
    "",
    context.length > 0 ? context.join("\n\n") : "(동아리 기록 없음)",
    "",
    `질문: ${question}`,
  ].join("\n");
}
