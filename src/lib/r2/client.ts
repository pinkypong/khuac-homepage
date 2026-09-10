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

function objectUrl(storageKey: string) {
  const accountId = requireEnv("R2_ACCOUNT_ID");
  const bucket = requireEnv("R2_BUCKET_NAME");
  return `https://${accountId}.r2.cloudflarestorage.com/${bucket}/${storageKey}`;
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
