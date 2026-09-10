import "server-only";
import { AwsClient } from "aws4fetch";
import { requireEnv } from "@/lib/env";

// aws4fetch (not @aws-sdk/client-s3) - it's a ~5KB, zero-Node-dependency SigV4
// signer built for edge runtimes, which is what Cloudflare's own R2 presigned
// URL docs use. The full AWS SDK works under nodejs_compat too, but drags in
// a much larger dependency tree for the same result here.
function r2Client() {
  return new AwsClient({
    accessKeyId: requireEnv("R2_ACCESS_KEY_ID"),
    secretAccessKey: requireEnv("R2_SECRET_ACCESS_KEY"),
    service: "s3",
    region: "auto",
  });
}

function bucketUrl() {
  const accountId = requireEnv("R2_ACCOUNT_ID");
  const bucket = requireEnv("R2_BUCKET_NAME");
  return `https://${accountId}.r2.cloudflarestorage.com/${bucket}`;
}

function objectUrl(storageKey: string) {
  return `${bucketUrl()}/${storageKey}`;
}

// storageKey, not the presign call, is what the client PUTs to and what gets
// stored in photos.storage_key_original - keep filenames out of the key
// itself beyond the extension so nothing user-controlled ends up parsed as a
// path segment.
export function buildStorageKey(originalFilename: string): string {
  const extMatch = /\.[a-zA-Z0-9]{1,8}$/.exec(originalFilename);
  const ext = extMatch ? extMatch[0].toLowerCase() : "";
  return `photos/${crypto.randomUUID()}${ext}`;
}

export async function presignPutUrl(storageKey: string, expiresInSeconds = 300): Promise<string> {
  const client = r2Client();
  const url = new URL(objectUrl(storageKey));
  url.searchParams.set("X-Amz-Expires", String(expiresInSeconds));
  // Content-Type is deliberately left unsigned so the client's actual PUT
  // header doesn't have to match byte-for-byte what was signed here.
  const signed = await client.sign(url.toString(), {
    method: "PUT",
    aws: { signQuery: true },
  });
  return signed.url;
}

export async function presignGetUrl(storageKey: string, expiresInSeconds = 300): Promise<string> {
  const client = r2Client();
  const url = new URL(objectUrl(storageKey));
  url.searchParams.set("X-Amz-Expires", String(expiresInSeconds));
  const signed = await client.sign(url.toString(), {
    method: "GET",
    aws: { signQuery: true },
  });
  return signed.url;
}

export interface R2Object {
  bytes: ArrayBuffer;
  contentType: string;
}

/**
 * Reads an object back through R2's S3 API rather than the Workers binding.
 * The browser uploads straight to real R2 via a presigned URL, but in
 * `next dev` the binding is Miniflare's *local* bucket - it would never see
 * that object. Going through S3 keeps dev and production on one path.
 */
export async function getObject(storageKey: string): Promise<R2Object | null> {
  const client = r2Client();
  const response = await client.fetch(objectUrl(storageKey), { method: "GET" });

  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`R2 GET failed for ${storageKey}: ${response.status}`);
  }

  return {
    bytes: await response.arrayBuffer(),
    contentType: response.headers.get("content-type") ?? "application/octet-stream",
  };
}

export async function putObject(
  storageKey: string,
  bytes: ArrayBuffer,
  contentType: string,
): Promise<void> {
  const client = r2Client();
  // Sent as a Blob so fetch sets Content-Length: R2 rejects a length-less PUT
  // with 411, and content-length is a forbidden header to set by hand.
  const response = await client.fetch(objectUrl(storageKey), {
    method: "PUT",
    body: new Blob([bytes], { type: contentType }),
    headers: { "content-type": contentType },
  });
  if (!response.ok) {
    throw new Error(`R2 PUT failed for ${storageKey}: ${response.status}`);
  }
}

export async function deleteObject(storageKey: string): Promise<void> {
  const client = r2Client();
  const response = await client.fetch(objectUrl(storageKey), { method: "DELETE" });
  // 404 is fine: the goal is "not there any more".
  if (!response.ok && response.status !== 404) {
    throw new Error(`R2 DELETE failed for ${storageKey}: ${response.status}`);
  }
}

export interface R2Listing {
  keys: string[];
  /** Directory-style prefixes; only populated when a delimiter is given. */
  prefixes: string[];
}

function decodeXmlText(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/**
 * ListObjectsV2 over R2's S3 API. The response is XML and Workers ships no
 * XML parser, so the (machine-generated, entirely predictable) body is picked
 * apart with regexes rather than a DOM - same reason GPX parsing happens in
 * the browser.
 *
 * Passing a delimiter returns folder-style `prefixes` instead of descending
 * into them, which is how the derived-thumbnail variant folders are found
 * without listing every cached file in the bucket.
 */
export async function listObjects(prefix: string, delimiter?: string): Promise<R2Listing> {
  const client = r2Client();
  const keys: string[] = [];
  const prefixes: string[] = [];
  let continuationToken: string | undefined;

  // A listing is capped at 1000 entries, so follow the cursor to the end.
  do {
    const url = new URL(bucketUrl());
    url.searchParams.set("list-type", "2");
    url.searchParams.set("prefix", prefix);
    if (delimiter) url.searchParams.set("delimiter", delimiter);
    if (continuationToken) url.searchParams.set("continuation-token", continuationToken);

    const response = await client.fetch(url.toString(), { method: "GET" });
    if (!response.ok) {
      throw new Error(`R2 LIST failed for ${prefix}: ${response.status}`);
    }
    const xml = await response.text();

    for (const match of xml.matchAll(/<Key>([^<]*)<\/Key>/g)) {
      keys.push(decodeXmlText(match[1]));
    }
    // <Prefix> also appears at the top level echoing the request, so only the
    // ones nested inside <CommonPrefixes> are real results.
    for (const match of xml.matchAll(
      /<CommonPrefixes>\s*<Prefix>([^<]*)<\/Prefix>\s*<\/CommonPrefixes>/g,
    )) {
      prefixes.push(decodeXmlText(match[1]));
    }

    const next = /<NextContinuationToken>([^<]*)<\/NextContinuationToken>/.exec(xml);
    continuationToken =
      /<IsTruncated>true<\/IsTruncated>/.test(xml) && next ? decodeXmlText(next[1]) : undefined;
  } while (continuationToken);

  return { keys, prefixes };
}
