import "server-only";
import { requireEnv } from "@/lib/env";
import { getVertexAccessToken } from "./vertex-auth";

const DEVELOPER_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

// Overridable so a future model rename doesn't need a code change - this field
// moves fast (three renames in the time this project has been running).
// Confirmed live against this key on 2026-09-13: gemini-2.5-flash and older
// answer 404 "no longer available to new users", gemini-3.6-flash is the
// current stable Flash model. Vertex's publisher-model catalogue may not track
// the Developer API's naming exactly; GEMINI_MODEL can be pointed at whatever
// Vertex actually serves without a code change if this default 404s there.
const DEFAULT_MODEL = "gemini-3.6-flash";

const TIMEOUT_MS = 30_000;

function model(): string {
  return process.env.GEMINI_MODEL || DEFAULT_MODEL;
}

interface RequestTarget {
  url: string;
  headers: Record<string, string>;
}

/**
 * Vertex AI when a service account is configured, the Developer API key
 * otherwise. The two differ only in how a request authenticates and which
 * host it goes to - the request and response bodies are the same Gemini
 * schema on both (confirmed for the tools/google_search shape against
 * Google's own Vertex grounding examples).
 *
 * Vertex is what this project actually needs in production: the Developer
 * API geo-gates by the calling IP, and Cloudflare Workers scatter outbound
 * fetches across colos the developer does not choose, so the same key from
 * the same Worker was rejected as "User location is not supported" on one
 * invocation and accepted on the next. Vertex bills through a Cloud project
 * rather than gating by request IP and is not subject to that.
 *
 * The API-key path stays as the local-dev fallback: `npm run dev` runs from a
 * developer's own machine, not a Worker colo, and was never the one hitting
 * this restriction - setting up a service account is not worth asking of
 * every contributor just to run the app locally.
 */
async function resolveTarget(): Promise<RequestTarget> {
  const serviceAccountJson = process.env.GEMINI_VERTEX_SERVICE_ACCOUNT;
  if (serviceAccountJson) {
    const { accessToken, projectId } = await getVertexAccessToken(serviceAccountJson);
    // "global" routes to wherever Google has capacity rather than one fixed
    // region, which its own docs describe as raising availability and cutting
    // 429s - the same property Vertex is being adopted here for, so it is the
    // default rather than a specific region picked to save a Korea-to-region
    // hop that has not been measured.
    const region = process.env.VERTEX_REGION || "global";
    const host = region === "global" ? "aiplatform.googleapis.com" : `${region}-aiplatform.googleapis.com`;
    return {
      url: `https://${host}/v1/projects/${projectId}/locations/${region}/publishers/google/models/${model()}:generateContent`,
      headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` },
    };
  }

  const key = requireEnv("GEMINI_API_KEY");
  return {
    url: `${DEVELOPER_API_BASE}/${model()}:generateContent?key=${key}`,
    headers: { "content-type": "application/json" },
  };
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

// Only matters on the local-dev fallback path now that production runs
// through Vertex (see resolveTarget): the Developer API geo-gates by the
// calling IP, and Cloudflare Workers scatter outbound fetches across colos the
// developer does not choose, so one invocation could be rejected as "User
// location is not supported" while the next, from the same Worker and key,
// went through cleanly - confirmed directly on this deployment before the
// Vertex move (a request failed at 13:45, an equivalent one succeeded at
// 13:51, though a same-invocation retry was separately observed doing nothing
// - the colo a retry lands on is not something this code controls either
// way). Left in place since it costs nothing when it never fires.
const LOCATION_RETRY_ATTEMPTS = 2;

function isLocationRestriction(data: GeminiResponse | null): boolean {
  return /User location is not supported/i.test(data?.error?.message ?? "");
}

async function callGemini(body: Record<string, unknown>): Promise<GeminiResponse> {
  const target = await resolveTarget();

  let lastFailure: { data: GeminiResponse | null; status: number } | null = null;

  for (let attempt = 0; attempt <= LOCATION_RETRY_ATTEMPTS; attempt++) {
    const response = await fetch(target.url, {
      method: "POST",
      headers: target.headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    const data = (await response.json().catch(() => null)) as GeminiResponse | null;
    if (response.ok && data) return data;

    lastFailure = { data, status: response.status };
    if (!isLocationRestriction(data) || attempt === LOCATION_RETRY_ATTEMPTS) break;
    console.error(`[gemini/client] location-restricted, retrying (attempt ${attempt + 1})`);
  }

  // The member sees a short Korean sentence; whoever reads `wrangler tail`
  // sees what Gemini actually said. mapGeminiError only recognises a handful
  // of messages by name (see its own comment) - everything else would
  // otherwise vanish behind a generic line with no way to diagnose it short of
  // reproducing the exact request by hand, which is what happened once
  // already (an invalid Worker secret surfaced only as "요청 형식에 문제가
  // 있습니다" until this line existed).
  console.error(
    "[gemini/client] request failed:",
    lastFailure?.status,
    lastFailure?.data?.error ?? lastFailure?.data,
  );
  throw new Error(mapGeminiError(lastFailure?.data ?? null, lastFailure?.status ?? 0));
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
  if (/User location is not supported/i.test(message)) {
    return "AI 서버 접속이 일시적으로 제한되었습니다. 잠시 후 다시 시도해주세요.";
  }
  if (/PERMISSION_DENIED/i.test(data?.error?.status ?? "") || status === 403) {
    // The token exchange itself throws its own message before this is ever
    // reached (see vertex-auth.ts) - a 403 arriving here means the token was
    // valid but the service account lacks the aiplatform.user role, or the
    // Vertex AI API is not enabled on the project. A setup gap, not a runtime
    // fluke, so it is worth naming rather than folding into the generic
    // 4xx line below.
    return "AI 서비스 접근 권한이 없습니다. 관리자에게 알려주세요.";
  }
  if (/API key not valid/i.test(message)) {
    // Seen once already: a secret set via `wrangler secret put <name>` piped
    // through `printf` over Git Bash on Windows silently corrupted the value,
    // and this was the only symptom - Gemini rejects a mangled key as a plain
    // 400, indistinguishable from a malformed request without reading the
    // message text specifically. `wrangler secret bulk` with a JSON file, the
    // same method used for every other secret in this project, did not
    // reproduce it.
    return "AI 키 설정에 문제가 있습니다. 관리자에게 알려주세요.";
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
