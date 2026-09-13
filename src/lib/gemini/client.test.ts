import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { generateText, generateStructured } from "./client";
const fetchMock = vi.fn();
const answer = (text: string, finishReason = "STOP") => new Response(JSON.stringify({ candidates: [{ finishReason, content: { parts: [{ text }] } }] }));
beforeEach(() => { vi.stubGlobal("fetch", fetchMock); vi.stubEnv("GEMINI_API_KEY", "test-key"); vi.stubEnv("GEMINI_PROVIDER", "developer"); fetchMock.mockReset(); vi.spyOn(console, "error").mockImplementation(() => {}); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); vi.useRealTimers(); });
describe("Gemini transport", () => {
  it("uses Developer API even when a legacy Vertex secret exists", async () => {
    vi.stubEnv("GEMINI_VERTEX_SERVICE_ACCOUNT", "old-secret"); fetchMock.mockResolvedValue(answer("답변"));
    expect(await generateText("질문")).toBe("답변");
    expect(fetchMock.mock.calls[0][0]).toContain("generativelanguage.googleapis.com");
    expect(fetchMock.mock.calls[0][0]).not.toContain("test-key");
  });
  it("retries a temporary 503", async () => {
    vi.useFakeTimers(); fetchMock.mockResolvedValueOnce(new Response("{}", { status: 503 })).mockResolvedValueOnce(answer("복구"));
    const result = generateText("질문"); await vi.runAllTimersAsync(); expect(await result).toBe("복구"); expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("does not retry location restrictions", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: { message: "User location is not supported" } }), { status: 400 }));
    await expect(generateText("질문")).rejects.toThrow("서버 지역"); expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("rejects empty and truncated answers", async () => {
    fetchMock.mockResolvedValueOnce(answer("")).mockResolvedValueOnce(answer('{"routes":', "MAX_TOKENS"));
    await expect(generateText("질문")).rejects.toThrow("빈 응답");
    await expect(generateStructured("질문", {})).rejects.toThrow("잘렸습니다");
  });
  it("accepts fenced JSON and excludes thinking text", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "private thought", thought: true }, { text: '```json\n{"routes":[]}\n```' }] } }] })));
    expect(await generateStructured("질문", {})).toEqual({ routes: [] });
  });
});
