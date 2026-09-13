import "server-only";
import { generateGroundedText, generateStructured } from "@/lib/gemini/client";

export interface RouteSuggestion {
  name: string;
  /** Named waypoints in walking order - place names, not coordinates. Turning
      these into pins happens in the browser (see assistant-panel.tsx), using
      the same public Maps key already loaded there. */
  waypoints: string[];
  distanceText: string | null;
  notes: string | null;
  sourceUrls: string[];
}

const ROUTE_SCHEMA = {
  type: "object",
  properties: {
    routes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          waypoints: { type: "array", items: { type: "string" } },
          distanceText: { type: "string", nullable: true },
          notes: { type: "string", nullable: true },
        },
        required: ["name", "waypoints"],
      },
    },
  },
  required: ["routes"],
};

interface RouteExtraction {
  routes: {
    name: string;
    waypoints: string[];
    distanceText: string | null;
    notes: string | null;
  }[];
}

/**
 * Real, current route options for a place, whether or not the club has ever
 * been there - answering "동아리 기록이 없습니다" and stopping was the wrong
 * instinct a member pointed out directly: not having gone somewhere is not a
 * reason to withhold what is knowable about it.
 *
 * Two calls rather than one, for the same reason the (currently unused, but
 * kept for this) course-finder in src/lib/routes/ was designed that way:
 * Gemini 3 documents pairing Search grounding with a response schema as
 * unstable. The grounded call writes prose with citations; the second call,
 * with no tools attached, only reshapes that prose into fixed fields.
 */
export async function suggestRoutes(
  placeName: string,
  question: string,
  clubContext: string | null,
): Promise<RouteSuggestion[]> {
  const grounded = await generateGroundedText(
    [
      `"${placeName}"의 등산/등반 코스를 실제 최신 블로그나 산행 후기를 검색해서 조사해줘.`,
      clubContext ? `참고로 동아리 자체 기록: ${clubContext}` : null,
      `질문: ${question}`,
      "서로 다른 코스를 2~4개 찾아서, 각각 이름/경유지(출발지→...→도착지 순서)/총 거리/난이도나 주의사항을 한국어로 정리해줘.",
      "동아리 기록이 없다는 이유로 답을 피하지 말고, 검색한 내용을 바탕으로 실제 코스를 제시해줘.",
    ]
      .filter(Boolean)
      .join("\n"),
  );

  if (!grounded.text) return [];

  const extracted = await generateStructured<RouteExtraction>(
    `다음 글에서 등산 코스 정보를 추출해 JSON으로 구조화해줘. 언급되지 않은 값은 null로 둬.\n\n${grounded.text}`,
    ROUTE_SCHEMA,
  );

  return extracted.routes
    .filter((r) => r.waypoints.length > 0)
    .map((r) => ({ ...r, sourceUrls: grounded.sources }));
}
