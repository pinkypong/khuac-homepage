import { CLIMBING_GUIDANCE, CRAG_SCREENING, EQUIPMENT_GUIDANCE, REGION_GUIDANCE, STYLE_GUIDANCE } from "./answer-guidance";
import "server-only";
import { generateGroundedText, generateStructured } from "@/lib/gemini/client";

export interface RouteSuggestion {
  name: string;
  waypoints: string[];
  distanceText: string | null;
  durationText: string | null;
  difficulty: string | null;
  /** What the course is actually like, in the model's own words. This is the
      prose that used to sit in a numbered list above the cards, repeating
      what the cards already said; it belongs on the card it describes. */
  description: string | null;
  notes: string | null;
  sourceUrls: string[];
}

const ROUTE_SCHEMA = {
  type: "object",
  properties: {
    // The mountain the courses belong to. Asked for explicitly because a
    // course can be turned into an album, and an album is filed under a place:
    // "관악산" is the folder, "사당역 코스" is the outing inside it. The club's
    // own place list cannot supply this when the question is about somewhere
    // the club has never been, which is exactly when a new folder is needed.
    placeName: { type: "string", nullable: true },
    // Anything true of the outing as a whole rather than of one course -
    // seasonal closures, access notes - which would otherwise be lost now
    // that the cards carry the answer.
    summary: { type: "string", nullable: true },
    routes: { type: "array", items: {
      type: "object",
      properties: {
        name: { type: "string" },
        waypoints: { type: "array", items: { type: "string" } },
        distanceText: { type: "string", nullable: true },
        durationText: { type: "string", nullable: true },
        difficulty: { type: "string", nullable: true },
        description: { type: "string", nullable: true },
        notes: { type: "string", nullable: true },
      },
      required: ["name", "waypoints"],
    } },
  },
  required: ["routes"],
};

const asText = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

/** A caveat that applies to the whole outing rather than to one course. */
export function normalizeSummary(value: unknown): string | null {
  if (!value || typeof value !== "object" || !("summary" in value)) return null;
  return asText((value as { summary: unknown }).summary);
}

/** The mountain name the model attached to the courses, if it gave one. */
export function normalizePlaceName(value: unknown): string | null {
  if (!value || typeof value !== "object" || !("placeName" in value)) return null;
  return asText((value as { placeName: unknown }).placeName);
}

// Structured output enforces syntax, but model values still need validation.
export function normalizeRoutes(value: unknown, sources: string[]): RouteSuggestion[] {
  if (!value || typeof value !== "object" || !("routes" in value) || !Array.isArray(value.routes)) return [];
  const text = asText;
  return value.routes.flatMap((r: unknown): RouteSuggestion[] => {
    if (!r || typeof r !== "object") return [];
    const row = r as Record<string, unknown>;
    const name = text(row.name);
    if (!name) return [];
    const waypoints = Array.isArray(row.waypoints) ? row.waypoints.flatMap((p) => text(p) ? [text(p)!] : []).slice(0, 12) : [];
    return [{ name, waypoints, distanceText: text(row.distanceText), durationText: text(row.durationText), difficulty: text(row.difficulty), description: text(row.description), notes: text(row.notes), sourceUrls: sources }];
    // Six rather than four: 도봉산 came back without Y계곡 because the cap cut
  // the list before its best-known scramble, and a member comparing options
  // is better served by one extra card than by a shorter list.
  }).slice(0, 6);
}

export async function suggestRoutes(
  placeName: string | null,
  question: string,
  clubContext: string | null,
  climbing = false,
) {
  const grounded = await generateGroundedText([
    EQUIPMENT_GUIDANCE,
    REGION_GUIDANCE,
    STYLE_GUIDANCE,
    climbing ? CLIMBING_GUIDANCE : null,
    climbing ? CRAG_SCREENING : null,
    climbing
      // Asking for "등산/등반 코스" got four hiking trails for 불암산 등반루트:
      // the crag was never searched for, because the word covering both let
      // the model answer the easier question.
      ? "암벽등반 루트를 웹에서 검색해 안내해주세요. 정상까지 걸어 오르는 등산로는 답이 아닙니다. 그 산·바위에 실제로 개척된 암벽 루트를 찾으세요."
      : "산행 도우미로서 질문에 맞는 실제 등산 코스를 웹에서 검색해 비교해주세요.",
    placeName ? `대상 장소: ${placeName}` : "질문에 언급된 산이나 지역을 기준으로 검색하세요. 장소와 지역이 모두 불분명하면 서울·수도권을 기준으로 답하세요.",
    clubContext ? `참고 자료: ${clubContext}` : null,
    `질문: ${question}`,
    climbing
      ? "서로 다른 루트 3~6개를 소개하고, 각 루트마다 이름, 어프로치 경유지(들머리→바위 아래 순서), 등급, 피치 수와 길이, 확보물, 특징 2~3문장을 한국어로 쓰세요."
      : "서로 다른 코스 3~6개를 소개하고, 각 코스마다 이름, 경유지(들머리→정상 순서), 총 거리, 예상 소요시간(편도/왕복 구분), 난이도, 특징 2~3문장을 한국어로 쓰세요.",
    // Telling the model only to avoid guessing left it with nothing to report:
    // it marked every distance 미확인 without ever looking one up. These
    // figures are published on hiking sites, so searching for them is the
    // instruction and 미확인 is the fallback, not the default.
    "총 거리와 소요시간은 등산 정보 사이트에 공개되어 있습니다. 반드시 검색해서 실제 수치를 찾아 기재하세요. 검색으로도 확인되지 않을 때만 '미확인'이라고 쓰고, 추측한 숫자는 쓰지 마세요.",
    // Every waypoint is looked up by name on the map, so a nickname or a
    // slash-joined pair resolves to nothing and leaves a gap in the line.
    "경유지는 지도에서 찾을 수 있는 실제 지명만 쓰세요. '계곡길/능선길'처럼 둘을 붙여 쓴 이름은 피하고, 역·사찰·봉우리처럼 지점이 하나로 정해지는 이름을 고르세요.",
    "널리 알려진 대표 코스를 빠뜨리지 마세요. 그 산을 검색하면 반드시 나오는 코스는 목록에 포함하세요.",
    "동아리 기록이 없어도 검색 결과를 활용하세요. 최신 통제 정보와 출처도 안내하세요.",
  ].filter(Boolean).join("\n"));

  try {
    const extracted = await generateStructured<unknown>(
      `아래 검색 답변에 실제로 나온 코스만 구조화하세요. placeName에는 코스들이 속한 산 이름만, summary에는 코스 전체에 해당하는 주의사항이 있을 때만 한두 문장으로 적으세요. description에는 각 코스의 특징 설명을 그대로 옮기세요. 없는 값은 null, 없는 경유지는 []로 두세요. 추가 검색이나 추측은 하지 마세요.\n\n${grounded.text}`,
      ROUTE_SCHEMA,
    );
    return {
      ...grounded,
      routes: normalizeRoutes(extracted, grounded.sources),
      placeName: normalizePlaceName(extracted) ?? placeName,
      summary: normalizeSummary(extracted),
    };
  } catch {
    // A failed formatting call must not discard a successful search answer.
    console.warn("[assistant/routes] structured extraction failed; preserving grounded answer");
    return { ...grounded, routes: [] as RouteSuggestion[], placeName, summary: null };
  }
}
