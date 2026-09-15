import { beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/require-role", () => ({ requireApprovedMember: vi.fn() }));
vi.mock("@/lib/assistant/context", () => ({ buildClubHistoryContext: vi.fn() }));
vi.mock("@/lib/assistant/routes", () => ({ searchRoutes: vi.fn(), extractRoutes: vi.fn() }));
vi.mock("@/lib/gemini/client", () => ({ generateText: vi.fn(), generateGroundedText: vi.fn() }));
import { requireApprovedMember } from "@/lib/supabase/require-role";
import { searchRoutes } from "@/lib/assistant/routes";
import { generateGroundedText } from "@/lib/gemini/client";
import { askAssistant } from "./actions";
beforeEach(() => {
  vi.resetAllMocks();
  // A chainable stub: every builder method returns the same object, and the
  // object itself is awaitable. maybeSingle answers "no cache entry", so these
  // tests exercise the path that actually calls the model.
  const query = {
    select: vi.fn(), not: vi.fn(), eq: vi.fn(), order: vi.fn(), limit: vi.fn(),
    maybeSingle: vi.fn(), upsert: vi.fn(),
    then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: [] }).then(resolve),
  };
  for (const method of [query.select, query.not, query.eq, query.order, query.limit]) method.mockReturnValue(query);
  query.maybeSingle.mockResolvedValue({ data: null });
  query.upsert.mockResolvedValue({ error: null });
  vi.mocked(requireApprovedMember).mockResolvedValue({ supabase: { from: vi.fn(() => query) }, memberId: "m1", isAdmin: false } as unknown as Awaited<ReturnType<typeof requireApprovedMember>>);
  vi.mocked(searchRoutes).mockResolvedValue({ text: "검색 결과", sources: [{ url: "https://example.com", label: "example.com" }] });
});
it.each(["관악산 등산 루트", "관악산 등산 루트 추천해줘"])("searches routes even without a club record: %s", async (question) => {
  expect(await askAssistant(question)).toMatchObject({ text: "검색 결과", place: null, sources: [{ url: "https://example.com", label: "example.com" }] });
  expect(searchRoutes).toHaveBeenCalledWith(null, question, null, false);
});
it("does not silently truncate detailed questions at 200 characters", async () => {
  const question = "관악산 등산 루트 " + "상세 조건 ".repeat(40) + "추천해줘";
  await askAssistant(question);
  expect(searchRoutes).toHaveBeenCalledWith(null, question, null, false);
});
it("rejects oversized input explicitly", async () => {
  await expect(askAssistant("가".repeat(2001))).rejects.toThrow("2,000자");
  expect(searchRoutes).not.toHaveBeenCalled();
});

it("answers a venue question with one grounded search", async () => {
 vi.mocked(generateGroundedText).mockResolvedValue({ text: "확인된 시설", sources: [{ url: "https://example.com/facility", label: "example.com" }] });
 expect(await askAssistant("경희대 근처 인공암벽 추천")).toMatchObject({ text: "확인된 시설" });
 expect(generateGroundedText).toHaveBeenCalledTimes(1);
});
// A crag can be real, nearby and still not worth the trip; the club's own
// album is the only source that already knows which ones were.
it("puts places the club has visited in front of the model", async () => {
 vi.mocked(generateGroundedText).mockResolvedValue({ text: "확인된 시설", sources: [{ url: "https://example.com/facility", label: "example.com" }] });
 await askAssistant("경희대 근처 암벽장 추천");
 const { supabase } = await requireApprovedMember();
 expect(supabase.from).toHaveBeenCalledWith("locations");
});
// A venue answer costs a grounded search, so re-opening it from the recent
// list has to come out of the cache - it used to re-run the search every time.
it("caches a venue answer so reopening it is free", async () => {
 vi.mocked(generateGroundedText).mockResolvedValue({ text: "확인된 시설", sources: [{ url: "https://example.com/facility", label: "example.com" }] });
 await askAssistant("경희대 근처 인공암벽 추천");
 const { supabase } = await requireApprovedMember();
 expect(supabase.from).toHaveBeenCalledWith("assistant_cache");
});
it("tells a climbing question apart from a hiking one", async () => {
 await askAssistant("불암산 등반루트");
 expect(searchRoutes).toHaveBeenCalledWith(null, "불암산 등반루트", null, true);
});
it("rejects venue answers with no search sources", async () => {
 vi.mocked(generateGroundedText).mockResolvedValue({ text: "더클라임 종로점", sources: [] });
 expect((await askAssistant("경희대 근처 인공암벽 추천")).text).not.toContain("더클라임 종로점");
});
