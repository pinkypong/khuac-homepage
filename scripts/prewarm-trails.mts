/**
 * Fills trail_tiles for the mountains the club actually goes to.
 *
 *   node scripts/prewarm-trails.mts [산이름 ...]
 *
 * Overpass is the reason course previews were slow and unreliable: asked
 * live, it took 51 seconds for one course and returned nothing at all twice
 * in a day. It is a volunteer service and that is not a fault to fix in it.
 *
 * The fix is to stop asking at request time. Trails do not move, so the areas
 * the club visits are fetched once, here, and every later preview reads them
 * from our own tables in under two seconds. Overpass stays only as the
 * fallback for somewhere nobody has looked at yet.
 *
 * Safe to re-run: tiles are upserted, so this tops up whatever is missing.
 */
import { readFileSync } from "node:fs";
import { fetchTrailsInBounds, type TrailBounds } from "../src/lib/routes/overpass-core.ts";
import { groupSegmentsByTile, tilesFullyInside, TILE_DEG } from "../src/lib/routes/tiles.ts";

/**
 * Centre and half-width for each area, in degrees. Boxes rather than radii
 * because that is what the fetch takes, and they are drawn generously: a
 * course that leaves its mountain's box is a course that comes back dashed.
 */
const AREAS: Record<string, { lat: number; lng: number; span: number }> = {
  북한산: { lat: 37.658, lng: 126.985, span: 0.055 },
  도봉산: { lat: 37.695, lng: 127.015, span: 0.035 },
  관악산: { lat: 37.445, lng: 126.964, span: 0.04 },
  불암산: { lat: 37.648, lng: 127.09, span: 0.03 },
  수락산: { lat: 37.69, lng: 127.08, span: 0.03 },
  청계산: { lat: 37.428, lng: 127.052, span: 0.035 },
  인왕산: { lat: 37.588, lng: 126.958, span: 0.02 },
  아차산: { lat: 37.567, lng: 127.106, span: 0.025 },
};

function env(name: string): string {
  const match = readFileSync(".env.local", "utf8").match(new RegExp(`^${name}=(.*)$`, "m"));
  const value = match?.[1]?.trim().replace(/^["']|["']$/g, "");
  if (!value) throw new Error(`${name} is not set in .env.local`);
  return value;
}

const url = env("NEXT_PUBLIC_SUPABASE_URL");
const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");

const wanted = process.argv.slice(2);
const areas = Object.entries(AREAS).filter(([name]) => wanted.length === 0 || wanted.includes(name));
if (areas.length === 0) throw new Error(`알 수 없는 산: ${wanted.join(", ")}`);

/**
 * A whole massif in one query is refused: 북한산 as a single 12km box came
 * back 504 while the smaller 관악산 box succeeded. Overpass is sized for
 * modest questions, so the area is asked for a piece at a time.
 *
 * Each piece is a whole number of tiles, aligned to the tile grid. That
 * alignment is the point: only tiles a fetch fully contains are stored, and an
 * unaligned 0.03° chunk contains none of the 0.02° grid - 북한산 fetched 1,604
 * trails and saved two tiles before this.
 */
const CHUNK_TILES = 2;
const CHUNK_DEG = TILE_DEG * CHUNK_TILES;

const snapDown = (value: number) => Math.floor(value / TILE_DEG) * TILE_DEG;
const snapUp = (value: number) => Math.ceil(value / TILE_DEG) * TILE_DEG;

function chunksOf(bounds: TrailBounds): TrailBounds[] {
  const out: TrailBounds[] = [];
  const south0 = snapDown(bounds.south);
  const west0 = snapDown(bounds.west);
  const north = snapUp(bounds.north);
  const east = snapUp(bounds.east);
  for (let south = south0; south < north - 1e-9; south += CHUNK_DEG) {
    for (let west = west0; west < east - 1e-9; west += CHUNK_DEG) {
      out.push({ south, west, north: south + CHUNK_DEG, east: west + CHUNK_DEG });
    }
  }
  return out;
}

for (const [name, area] of areas) {
  const bounds: TrailBounds = {
    south: area.lat - area.span,
    west: area.lng - area.span,
    north: area.lat + area.span,
    east: area.lng + area.span,
  };

  const rows: { tile_key: string; segments: unknown; fetched_at: string }[] = [];
  let fetched = 0;
  let failed = 0;

  for (const chunk of chunksOf(bounds)) {
    let segments;
    try {
      // Ninety seconds: still a fair-sized query, and nothing is waiting on it.
      segments = await fetchTrailsInBounds(chunk, 90_000);
    } catch {
      // One piece failing leaves a gap the next run tops up, which is better
      // than abandoning the mountain - and far better than abandoning the rest.
      failed++;
      continue;
    }
    fetched += segments.length;
    const byTile = groupSegmentsByTile(segments);
    // Same rule the request path uses: a tile the box only clipped would be
    // stored with the ways that fell inside and none continuing past the edge.
    const complete = tilesFullyInside(chunk);
    for (const [tile_key, tileSegments] of byTile) {
      if (complete.has(tile_key)) {
        rows.push({ tile_key, segments: tileSegments, fetched_at: new Date().toISOString() });
      }
    }
    // Overpass asks callers to behave; a pause between pieces is that.
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }

  if (rows.length === 0) {
    console.error(`${name}: 저장할 타일 없음 (조각 ${failed}개 실패)`);
    continue;
  }

  for (let i = 0; i < rows.length; i += 10) {
    const response = await fetch(`${url}/rest/v1/trail_tiles?on_conflict=tile_key`, {
      method: "POST",
      headers: {
        apikey: serviceKey,
        authorization: `Bearer ${serviceKey}`,
        "content-type": "application/json",
        prefer: "resolution=merge-duplicates",
      },
      body: JSON.stringify(rows.slice(i, i + 10)),
    });
    if (!response.ok) {
      throw new Error(`${name} 업로드 실패 (${response.status}): ${(await response.text()).slice(0, 200)}`);
    }
  }
  console.log(`${name}: 등산로 ${fetched}개 · 타일 ${rows.length}개 저장${failed ? ` (조각 ${failed}개 실패)` : ""}`);
}
console.log("완료");
