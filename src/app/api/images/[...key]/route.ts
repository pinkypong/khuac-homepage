import { getCloudflareContext } from "@opennextjs/cloudflare";
import { requireApprovedMember, RoleError } from "@/lib/supabase/require-role";

// Resizes on the fly via the Cloudflare Images binding (env.IMAGES) instead
// of sharp (unavailable on Workers) or pre-generated thumbnail/preview
// objects (photos only stores the original - see supabase/migrations
// 20260907143635_initial_schema.sql).
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

  const { env } = getCloudflareContext();
  const object = await env.PHOTOS_BUCKET.get(storageKey);
  if (!object?.body) {
    return new Response("Not found", { status: 404 });
  }

  // Declared in wrangler.jsonc ("images": { "binding": "IMAGES" }), so this
  // is only ever missing if that binding config was removed.
  if (!env.IMAGES) {
    return new Response("Images binding not configured", { status: 500 });
  }

  const result = await env.IMAGES.input(object.body)
    .transform(width ? { width } : {})
    .output({ format: "image/webp", quality });

  // "private": these are membership-gated photos, not something Cloudflare's
  // shared edge cache should serve to a request that skipped the check above.
  return result.response({ headers: { "cache-control": "private, max-age=86400" } });
}
