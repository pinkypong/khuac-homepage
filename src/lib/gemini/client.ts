import "server-only";
import { requireEnv } from "@/lib/env";

const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

// Overridable so a future model rename doesn't need a code change - this field
// moves fast (three renames in the time this project has been running).
// Confirmed live against this key on 2026-09-13: gemini-2.5-flash and older
// answer 404 "no longer available to new users", gemini-3.6-flash is the
// current stable Flash model.
const DEFAULT_MODEL = "gemini-3.6-flash";

const TIMEOUT_MS = 30_000;

function model(): string {
  return process.env.GEMINI_MODEL || DEFAULT_MODEL;
}

interface GeminiPart {
  text?: string;
}

interface GeminiCandidate {
  content?: { parts?: GeminiPart[] };
  // groundingChunks/groundingSupports is the shape this project has seen
  // documented and referenced elsewhere (google-genai's grounding_chunks), but
  // it has not been confirmed against a live response from this account -
  // billing was exhausted before a grounded call could complete. Extraction
  // below is written to degrade to an empty source list rather than throw if
  // the real shape turns out to differ; verify this the first time a grounded
  // call actually succeeds.
  groundingMetadata?: {
    groundingChunks?: { web?: { uri?: string; title?: string } }[];
  };
}

interface GeminiResponse {
  candidates?: GeminiCandidate[];
  error?: { status?: string; message?: string; code?: number };
}

async function callGemini(body: Record<string, unknown>): Promise<GeminiResponse> {
  const key = requireEnv("GEMINI_API_KEY");
  const response = await fetch(`${API_BASE}/${model()}:generateContent?key=${key}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  const data = (await response.json().catch(() => null)) as GeminiResponse | null;

  if (!response.ok || !data) {
    throw new Error(mapGeminiError(data, response.status));
  }
  return data;
}

/**
 * Every message here is one actually seen from this API while building this
 * feature (see the RESOURCE_EXHAUSTED and NOT_FOUND cases), except the
 * generic fallback.
 */
function mapGeminiError(data: GeminiResponse | null, status: number): string {
  const message = data?.error?.message ?? "";

  if (/prepayment credits are depleted/i.test(message)) {
    return "AI 기능의 결제 크레딧이 소진되었습니다. 관리자에게 알려주세요.";
  }
  if (/no longer available to new users/i.test(message)) {
    return "AI 모델 설정이 오래되었습니다. 관리자에게 알려주세요.";
  }
  if (status === 429) {
    return "AI 요청이 너무 많습니다. 잠시 후 다시 시도해주세요.";
  }
  if (status === 400) {
    return "AI에게 보낸 요청 형식에 문제가 있습니다.";
  }
  return "AI 응답을 가져오지 못했습니다.";
}

function extractText(response: GeminiResponse): string {
  const parts = response.candidates?.[0]?.content?.parts ?? [];
  return parts
    .map((p) => p.text ?? "")
    .join("")
    .trim();
}

export interface GroundedResult {
  text: string;
  sources: string[];
}

/**
 * A plain-text answer with Google Search behind it, for anything only the
 * live web can answer - a specific climb's current reputation, a trip report
 * from last month. No responseSchema here on purpose: combining structured
 * output with the search tool is documented as unstable on Gemini 3
 * (grounding metadata reported empty, and some requests are refused outright
 * with "controlled generation is not supported with google_search tool").
 * Extraction into a fixed shape happens as a second, ungrounded call instead -
 * see extractStructured.
 */
export async function generateGroundedText(prompt: string): Promise<GroundedResult> {
  const response = await callGemini({
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    tools: [{ google_search: {} }],
  });

  const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
  const sources = [
    ...new Set(chunks.map((c) => c.web?.uri).filter((uri): uri is string => !!uri)),
  ];

  return { text: extractText(response), sources };
}

/**
 * Turns free text into a fixed shape, via a plain call with no tools attached -
 * the pairing that is documented as reliable. Used to structure the output of
 * generateGroundedText rather than asking one call to both search and format,
 * and equally usable for parsing a member's question into an intent.
 */
export async function generateStructured<T>(
  prompt: string,
  schema: Record<string, unknown>,
): Promise<T> {
  const response = await callGemini({
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: schema,
    },
  });

  const text = extractText(response);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error("AI 응답을 해석하지 못했습니다.");
  }
}

/** A plain narrative call: no tools, no schema, just an answer in prose. */
export async function generateText(prompt: string): Promise<string> {
  const response = await callGemini({
    contents: [{ role: "user", parts: [{ text: prompt }] }],
  });
  return extractText(response);
}
