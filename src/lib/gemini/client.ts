import "server-only";
import { requireEnv } from "@/lib/env";
import { getVertexAccessToken } from "./vertex-auth";

const DEFAULT_MODEL = "gemini-3.6-flash";
const TIMEOUT_MS = 60_000;
const MAX_ATTEMPTS = 3;

interface GeminiResponse {
  candidates?: {
    finishReason?: string;
    content?: { parts?: { text?: string; thought?: boolean }[] };
    groundingMetadata?: { groundingChunks?: { web?: { uri?: string } }[] };
  }[];
  promptFeedback?: { blockReason?: string };
  error?: { status?: string; message?: string; code?: number };
}

async function resolveTarget() {
  const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;
  // API-key billing is the default even if an old Vertex secret remains.
  if (process.env.GEMINI_PROVIDER === "vertex") {
    const { accessToken, projectId } = await getVertexAccessToken(requireEnv("GEMINI_VERTEX_SERVICE_ACCOUNT"));
    const region = process.env.VERTEX_REGION || "global";
    const host = region === "global" ? "aiplatform.googleapis.com" : `${region}-aiplatform.googleapis.com`;
    return {
      url: `https://${host}/v1/projects/${projectId}/locations/${region}/publishers/google/models/${model}:generateContent`,
      headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` } as Record<string, string>,
    };
  }
  return {
    url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    headers: { "content-type": "application/json", "x-goog-api-key": requireEnv("GEMINI_API_KEY") },
  };
}

function errorMessage(data: GeminiResponse | null, status: number): string {
  const message = data?.error?.message ?? "";
  if (/prepayment credits are depleted/i.test(message)) return "AI 기능의 결제 크레딧이 소진되었습니다. 관리자에게 알려주세요.";
  if (/User location is not supported/i.test(message)) return "현재 서버 지역에서 Gemini API 접속이 제한되었습니다. 관리자에게 서버 접속 지역 확인을 요청해주세요.";
  if (/API key not valid/i.test(message)) return "AI 키 설정에 문제가 있습니다. 관리자에게 알려주세요.";
  if (status === 404 || /no longer available to new users/i.test(message)) return "AI 모델 설정을 확인해야 합니다. 관리자에게 알려주세요.";
  if (status === 403) return "AI 서비스 접근 권한이 없습니다. 관리자에게 알려주세요.";
  if (status === 429) return "AI 요청 한도에 도달했습니다. 잠시 후 다시 시도해주세요.";
  if (status === 400) return "AI에게 보낸 요청 형식에 문제가 있습니다.";
  return "AI 서비스가 일시적으로 응답하지 않습니다. 잠시 후 다시 시도해주세요.";
}

async function callGemini(body: Record<string, unknown>): Promise<GeminiResponse> {
  const target = await resolveTarget();
  // One total deadline bounds retries as well as the response body read.
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    let response: Response;
    let data: GeminiResponse | null;
    try {
      response = await fetch(target.url, { method: "POST", headers: target.headers, body: JSON.stringify(body), signal });
      data = await response.json().catch(() => null) as GeminiResponse | null;
    } catch {
      // Do not log URLs, credentials or private question content.
      console.error("[gemini/client] transport failure", { attempt: attempt + 1, timeout: signal.aborted });
      if (signal.aborted) throw new Error("AI 응답 시간이 길어지고 있습니다. 잠시 후 다시 시도해주세요.");
      if (attempt === MAX_ATTEMPTS - 1) throw new Error("AI 서버에 연결하지 못했습니다. 잠시 후 다시 시도해주세요.");
      await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
      continue;
    }
    if (response.ok && data && !data.error) return data;
    console.error("[gemini/client] request failed", { status: response.status, code: data?.error?.status, attempt: attempt + 1 });
    const transient = [429, 500, 502, 503, 504].includes(response.status)
      && !/prepayment credits are depleted/i.test(data?.error?.message ?? "");
    if (!transient || attempt === MAX_ATTEMPTS - 1) throw new Error(errorMessage(data, response.status));
    const retryAfter = response.headers.get("retry-after");
    const seconds = retryAfter ? Number(retryAfter) : NaN;
    const delay = Number.isFinite(seconds) ? seconds * 1000 : retryAfter ? Date.parse(retryAfter) - Date.now() : 500 * 2 ** attempt + Math.random() * 250;
    // Long quota waits belong to a later user request, not a sleeping action.
    if (delay > 10_000) throw new Error(errorMessage(data, response.status));
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, Number.isFinite(delay) ? delay : 1000)));
  }
  throw new Error("AI 응답을 가져오지 못했습니다.");
}

function extractText(response: GeminiResponse): string {
  const candidate = response.candidates?.[0];
  if (response.promptFeedback?.blockReason || (candidate?.finishReason && !["STOP", "MAX_TOKENS"].includes(candidate.finishReason))) {
    console.error("[gemini/client] blocked response", { finishReason: candidate?.finishReason, blockReason: response.promptFeedback?.blockReason });
    throw new Error("AI가 이 질문에 답변하지 못했습니다. 질문을 조금 바꿔주세요.");
  }
  if (candidate?.finishReason === "MAX_TOKENS") throw new Error("AI 답변이 도중에 잘렸습니다. 질문 범위를 나누어 다시 시도해주세요.");
  const text = (candidate?.content?.parts ?? []).filter((p) => !p.thought).map((p) => p.text ?? "").join("").trim();
  if (!text) throw new Error("AI가 빈 응답을 반환했습니다. 잠시 후 다시 시도해주세요.");
  return text;
}

// Gemini 3.6 supports minimal for extraction; newer Flash models may only
// accept low. Leave non-Gemini-3 overrides on their own model defaults.
function thinkingConfig(extraction = false) {
  const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;
  if (!model.startsWith("gemini-3") || model.startsWith("gemini-3.1-flash-lite-image")) return {};
  const supportsMinimal = /^gemini-(?:3\.[56]-flash(?:$|-)|3-flash(?:$|-))/.test(model);
  return { thinkingConfig: { thinkingLevel: extraction && supportsMinimal ? "minimal" : "low" } };
}

export interface GroundedResult { text: string; sources: string[] }

export async function generateGroundedText(prompt: string): Promise<GroundedResult> {
  const response = await callGemini({ contents: [{ role: "user", parts: [{ text: prompt }] }], tools: [{ google_search: {} }], generationConfig: thinkingConfig() });
  const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
  const sources = [...new Set(chunks.map((c) => c.web?.uri).filter((uri): uri is string => !!uri && /^https?:\/\//i.test(uri)))];
  return { text: extractText(response), sources };
}

export async function generateStructured<T>(prompt: string, schema: Record<string, unknown>): Promise<T> {
  const response = await callGemini({
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { ...thinkingConfig(true), responseMimeType: "application/json", responseSchema: schema },
  });
  const text = extractText(response).replace(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i, "$1").trim();
  try { return JSON.parse(text) as T; }
  catch { throw new Error("AI 응답을 해석하지 못했습니다."); }
}

export async function generateText(prompt: string): Promise<string> {
  return extractText(await callGemini({ contents: [{ role: "user", parts: [{ text: prompt }] }] }));
}
