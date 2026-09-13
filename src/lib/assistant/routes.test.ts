import { beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/gemini/client", () => ({ generateGroundedText: vi.fn(), generateStructured: vi.fn() }));
import { generateGroundedText, generateStructured } from "@/lib/gemini/client";
import { normalizeRoutes, suggestRoutes } from "./routes";
beforeEach(() => vi.resetAllMocks());
it("preserves the grounded answer and sources when formatting fails", async () => {
  vi.mocked(generateGroundedText).mockResolvedValue({ text: "관악산 코스 비교", sources: ["https://example.com"] });
  vi.mocked(generateStructured).mockRejectedValue(new Error("invalid JSON"));
  expect(await suggestRoutes(null, "관악산 등산 루트 추천해줘", null)).toEqual({ text: "관악산 코스 비교", sources: ["https://example.com"], routes: [], placeName: null, summary: null });
});
it("handles malformed and missing optional fields without crashing", () => {
  expect(normalizeRoutes(null, [])).toEqual([]);
  const routes = normalizeRoutes({ routes: [null, { name: "코스", waypoints: null, durationText: "약 3시간" }, { name: 3 }] }, []);
  expect(routes).toHaveLength(1); expect(routes[0]).toMatchObject({ waypoints: [], durationText: "약 3시간", difficulty: null });
});

it("keeps the club's own place name when the model does not name the mountain", async () => {
  vi.mocked(generateGroundedText).mockResolvedValue({ text: "코스", sources: [] });
  vi.mocked(generateStructured).mockResolvedValue({ routes: [] });
  expect(await suggestRoutes("북한산", "코스 알려줘", null)).toMatchObject({ placeName: "북한산" });
});
it("takes the mountain name the model extracted", async () => {
  vi.mocked(generateGroundedText).mockResolvedValue({ text: "코스", sources: [] });
  vi.mocked(generateStructured).mockResolvedValue({ placeName: "관악산", routes: [] });
  expect(await suggestRoutes(null, "코스 알려줘", null)).toMatchObject({ placeName: "관악산" });
});
