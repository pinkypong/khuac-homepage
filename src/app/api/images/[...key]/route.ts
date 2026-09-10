import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getObject, putObject } from "@/lib/r2/client";
import { requireApprovedMember, RoleError } from "@/lib/supabase/require-role";

// Serves a photo, resized on demand and then cached back into R2.
//
// Objects are read through R2's S3 API rather than a Workers binding so this
// behaves the same in `next dev` as on Workers (the binding in dev is a local
// emulation that never sees browser-uploaded objects).
//
// Cloudflare bills image transformations per unique (image, options) pair
// *per calendar month*, so transforming on every request would re-bill the
// whole archive every month someone browses it. Storing the derived file is
// far cheaper: a 400px thumbnail is tens of KB against $0.015/GB-month.
//
// Resizing needs the Cloudflare Images binding, which only exists on Workers.
// Without it the original is served unchanged so local development still
// shows photos - and nothing is cached, since nothing was derived.
const CACHE_CONTROL = "private, max-age=86400";

function derivedKey(storageKey: string, width: number | undefined, quality: number) {
  return `derived/w${width ?? "orig"}q${quality}/${storageKey}.webp`;
}

export async function GET(request: Request, { params }: { params: Promise<{ key: string[] }> }) {
  try {
    await requireApprovedMember();
  } catch (err) {
    if (err instanceof RoleError) {
      return new Response(err.message, { status: err.status });
    }
    throw err;
  }

  const { key } = await params;
  const storageKey = key.join("/");

  const { searchParams } = new URL(request.url);
  const width = Number(searchParams.get("w")) || undefined;
  const quality = Math.min(100, Math.max(1, Number(searchParams.get("q")) || 80));

  const cacheKey = derivedKey(storageKey, width, quality);
  const cached = await getObject(cacheKey);
  if (cached) {
    return new Response(cached.bytes, {
      headers: { "content-type": "image/webp", "cache-control": CACHE_CONTROL },
    });
  }

  const original = await getObject(storageKey);
  if (!original) {
    return new Response("Not found", { status: 404 });
  }

  const { env, ctx } = getCloudflareContext();
  if (!env.IMAGES) {
    return new Response(original.bytes, {
      headers: { "content-type": original.contentType, "cache-control": CACHE_CONTROL },
    });
  }

  const result = await env.IMAGES.input(new Response(original.bytes).body!)
    .transform(width ? { width } : {})
    .output({ format: "image/webp", quality });

  const transformed = await new Response(result.image()).arrayBuffer();

  // Written after the response is on its way; a failed cache write should
  // never turn a working image into an error.
  const cacheWrite = putObject(cacheKey, transformed, "image/webp").catch((err) => {
    console.error("[api/images] cache write failed:", err);
  });
  if (ctx) ctx.waitUntil(cacheWrite);

  return new Response(transformed, {
    headers: { "content-type": "image/webp", "cache-control": CACHE_CONTROL },
  });
}
