/**
 * How big the body of "코스로 앨범 만들기" actually is.
 *
 *   node scripts/measure-album-payload.mts
 *
 * The button returned 500 and the insert it performs succeeds when run
 * directly, so the suspect is the trip rather than the destination: a server
 * action body over Next's 1MB limit is rejected before the action runs, which
 * is a 500 with nothing in it that points at this code.
 *
 * The drawn line is the only part of that body that scales with the course -
 * it is full-resolution OSM geometry, not the handful of waypoints - so it is
 * the part worth measuring.
 */
import { readFileSync } from "node:fs";
import { snapRouteToTrails } from "../src/lib/routes/snap.ts";
import { mergeTileSegments, tilesForBounds } from "../src/lib/routes/tiles.ts";
import { splitSurveyGaps, type TrailSegment } from "../src/lib/routes/trails.ts";
import { downsampleTrack } from "../src/lib/gps/track.ts";

function env(name: string): string {
  const match = readFileSync(".env.local", "utf8").match(new RegExp(`^${name}=(.*)$`, "m"));
  const value = match?.[1]?.trim().replace(/^["']|["']$/g, "");
  if (!value) throw new Error(`${name} is not set in .env.local`);
  return value;
}
const supabaseUrl = env("NEXT_PUBLIC_SUPABASE_URL");
const headers = { apikey: env("SUPABASE_SERVICE_ROLE_KEY"), authorization: `Bearer ${env("SUPABASE_SERVICE_ROLE_KEY")}` };

/** 정릉 → 도선사, the longest course the assistant has offered (7.74km). */
const kept = [
  { name: "정릉탐방지원센터", lat: 37.6096, lng: 127.0004 },
  { name: "대성문", lat: 37.6218, lng: 126.9808 },
  { name: "보국문", lat: 37.6255, lng: 126.9838 },
  { name: "대동문", lat: 37.6296, lng: 126.9877 },
  { name: "용암문", lat: 37.6356, lng: 126.9857 },
  { name: "도선사", lat: 37.6473, lng: 127.0083 },
];

async function rows(table: string, keys: string[]): Promise<TrailSegment[][]> {
  const list = keys.map((key) => `"${key}"`).join(",");
  const response = await fetch(
    `${supabaseUrl}/rest/v1/${table}?select=segments&tile_key=in.(${encodeURIComponent(list)})`,
    { headers },
  );
  if (!response.ok) throw new Error(`${table}: ${response.status}`);
  return ((await response.json()) as { segments: TrailSegment[] }[]).map((row) => row.segments ?? []);
}

const lats = kept.map((p) => p.lat);
const lngs = kept.map((p) => p.lng);
const bounds = {
  south: Math.min(...lats) - 0.02, west: Math.min(...lngs) - 0.02,
  north: Math.max(...lats) + 0.02, east: Math.max(...lngs) + 0.02,
};
const [osm, official] = await Promise.all([
  rows("trail_tiles", tilesForBounds(bounds)),
  rows("official_trails", tilesForBounds(bounds)),
]);
const segments = mergeTileSegments([
  mergeTileSegments(osm),
  splitSurveyGaps(mergeTileSegments(official)),
]);

const legs = snapRouteToTrails(kept, segments);
const track = legs.flatMap((leg) => leg.points);
const body = JSON.stringify({
  routeName: "정릉 → 도선사 능선 종주",
  placeName: "북한산",
  waypoints: kept,
  track,
  distanceText: "약 7.7km",
  notes: null,
});
console.log(`점 ${track.length.toLocaleString()}개`);
console.log(`보내는 본문 ${(new TextEncoder().encode(body).length / 1024).toFixed(1)}KB (한도 1024KB)`);
console.log(`저장 시 downsample 후 ${downsampleTrack(track).length.toLocaleString()}개`);
