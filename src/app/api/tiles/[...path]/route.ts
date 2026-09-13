// Serves Thunderforest Outdoors tiles with our key attached server-side.
//
// Thunderforest offers no way to restrict a key by referrer or domain, so a
// key shipped to the browser is a key anyone can lift and spend our free
// 150,000 tiles/month on. Proxying keeps it here instead.
//
// Deliberately not behind requireApprovedMember: that makes a network call to
// Supabase, and a single map view asks for dozens of tiles. Paying an auth
// round trip per tile would make the map crawl and hammer Supabase for no
// real gain - the key itself is already out of reach, which was the point.
// A referrer check is the speed bump that remains.
/**
 * Where each proxied layer's tiles actually come from.
 *
 * A table rather than one hard-coded host because VWorld is expected to join
 * it. VWorld works in a browser today - its key is locked to our registered
 * domain, which is protection a proxy would only duplicate - but a native iOS
 * app sends no domain and no Referer, so that check will fail there. The fix
 * is to route it through here with `&domain=` set, and the point of this
 * shape is that doing so is a new entry rather than a rewrite:
 *
 *   vworld: { key: "VWORLD_API_KEY", url: ({ z, x, y }, key) =>
 *     `https://api.vworld.kr/req/wmts/1.0.0/${key}/Base/${z}/${y}/${x}.png?domain=https://khuac.com` }
 *
 * Note the y/x swap in that sketch: VWorld orders its WMTS path row-then-
 * column. Incoming paths stay {z}/{x}/{y} whatever the upstream wants, so the
 * reordering belongs to the entry that needs it.
 */
const LAYERS: Record<
  string,
  { key: string; url: (tile: { z: number; x: number; y: number }, key: string) => string }
> = {
  outdoors: {
    key: "THUNDERFOREST_API_KEY",
    url: ({ z, x, y }, key) => `https://api.thunderforest.com/outdoors/${z}/${x}/${y}.png?apikey=${key}`,
  },
};

// Tiles for a given z/x/y never change, so this is the whole defence: the
// edge cache absorbs nearly every request and the Worker rarely runs at all,
// which protects the upstream quota as much as it protects latency.
const CACHE_CONTROL = "public, max-age=604800, immutable";

function isSameOrigin(request: Request): boolean {
  // Sent for same-origin subresource requests under the default referrer
  // policy; Sec-Fetch-Site is the modern belt to that braces.
  if (request.headers.get("sec-fetch-site") === "same-origin") return true;
  const referer = request.headers.get("referer");
  if (!referer) return false;
  try {
    const from = new URL(referer).host;
    return from === new URL(request.url).host || from.startsWith("localhost:");
  } catch {
    return false;
  }
}

export async function GET(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const [layer, z, x, file] = path;

  // The upstream URL is rebuilt from validated numbers rather than by joining
  // whatever arrived, so this route cannot be steered at another host or path.
  const provider = layer ? LAYERS[layer] : undefined;
  if (!provider || path.length !== 4 || !file?.endsWith(".png")) {
    return new Response("Not found", { status: 404 });
  }
  const zoom = Number(z);
  const col = Number(x);
  const row = Number(file.slice(0, -4));
  const inRange =
    Number.isInteger(zoom) && zoom >= 0 && zoom <= 22 &&
    [col, row].every((n) => Number.isInteger(n) && n >= 0 && n < 2 ** zoom);
  if (!inRange) return new Response("Not found", { status: 404 });

  if (!isSameOrigin(request)) return new Response("Forbidden", { status: 403 });

  const key = process.env[provider.key];
  if (!key) {
    console.error(`[api/tiles] ${provider.key} is not configured`);
    return new Response("Tile layer unavailable", { status: 503 });
  }

  const upstream = await fetch(provider.url({ z: zoom, x: col, y: row }, key), {
    // Lets Cloudflare hold the upstream response too, so a tile no browser has
    // cached still usually avoids a trip to Thunderforest.
    cf: { cacheTtl: 604800, cacheEverything: true },
  } as RequestInit);

  if (!upstream.ok) {
    // Never echo the upstream body: a Thunderforest error page can quote the
    // request URL back, key included.
    console.error("[api/tiles] upstream failed", upstream.status, `${zoom}/${col}/${row}`);
    return new Response("Tile unavailable", { status: upstream.status === 404 ? 404 : 502 });
  }

  return new Response(upstream.body, {
    headers: { "content-type": "image/png", "cache-control": CACHE_CONTROL },
  });
}
