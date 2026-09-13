import "server-only";

/**
 * Exchanges a Google service account key for a short-lived access token,
 * signing the JWT with the Web Crypto API rather than a Node OAuth2 library -
 * Workers ship `crypto.subtle` but not Node's `crypto` module internals most
 * Google auth libraries assume, and standard as this flow is, it has not been
 * re-verified end to end against this account (no service account existed to
 * test against while writing this). It follows Google's documented
 * service-account JWT bearer flow exactly:
 * https://developers.google.com/identity/protocols/oauth2/service-account#httprest
 */

interface ServiceAccountKey {
  client_email: string;
  private_key: string;
  project_id: string;
}

interface CachedToken {
  accessToken: string;
  expiresAt: number; // epoch ms
}

// Module scope: a Workers isolate can serve several requests before it is
// recycled, so a token fetched once is reused rather than re-signed and
// re-exchanged on every single call. Worst case - a recycled isolate - this is
// just an empty cache and one extra round trip, not a correctness problem.
let cached: CachedToken | null = null;

function base64UrlEncode(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (const byte of arr) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function encodeJson(value: unknown): string {
  return base64UrlEncode(new TextEncoder().encode(JSON.stringify(value)));
}

/** Strips the PEM header/footer and newlines, leaving raw base64 to decode. */
function pemToDer(pem: string): ArrayBuffer {
  const base64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s+/g, "");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function signJwt(account: ServiceAccountKey): Promise<string> {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claims = {
    iss: account.client_email,
    scope: "https://www.googleapis.com/auth/cloud-platform",
    aud: "https://oauth2.googleapis.com/token",
    iat: nowSeconds,
    exp: nowSeconds + 3600,
  };

  const signingInput = `${encodeJson(header)}.${encodeJson(claims)}`;

  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToDer(account.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(signingInput),
  );

  return `${signingInput}.${base64UrlEncode(signature)}`;
}

export async function getVertexAccessToken(serviceAccountJson: string): Promise<{
  accessToken: string;
  projectId: string;
}> {
  const account = JSON.parse(serviceAccountJson) as ServiceAccountKey;

  // 60s of slack so a token does not expire mid-flight on a slow request.
  if (cached && cached.expiresAt > Date.now() + 60_000) {
    return { accessToken: cached.accessToken, projectId: account.project_id };
  }

  const jwt = await signJwt(account);

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });

  const data = (await response.json().catch(() => null)) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  } | null;

  if (!response.ok || !data?.access_token) {
    console.error("[gemini/vertex-auth] token exchange failed:", response.status, data);
    throw new Error(
      `Vertex AI 인증에 실패했습니다: ${data?.error_description ?? data?.error ?? response.status}`,
    );
  }

  cached = {
    accessToken: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
  };
  return { accessToken: cached.accessToken, projectId: account.project_id };
}
