/**
 * How far out of the way 석굴암 is on 우이령길.
 *
 *   node scripts/measure-sokguram-detour.mts
 *
 * The course names 석굴암입구, the turning; Places answers with the temple. If
 * the temple sits on the road the two are the same place and there is nothing
 * to fix. If it sits up a branch, routing through it walks that branch twice,
 * and the length of the branch is the size of the mistake.
 *
 * Measured on the same trail geometry the map draws from, so the number is the
 * one a member would see rather than an estimate off a straight line.
 */
import { readFileSync } from "node:fs";
import { prepareRouteSnap, walkPreparedRoute } from "../src/lib/routes/snap.ts";
import { mergeTileSegments, tilesForBounds } from "../src/lib/routes/tiles.ts";
import { splitSurveyGaps, type TrailSegment } from "../src/lib/routes/trails.ts";
import { haversineDistanceMeters } from "../src/lib/gps/haversine.ts";
import type { TrackPoint } from "../src/lib/gps/track.ts";

function env(name: string): string {
  const match = readFileSync(".env.local", "utf8").match(new RegExp(`^${name}=(.*)$`, "m"));
  const value = match?.[1]?.trim().replace(/^["']|["']$/g, "");
  if (!value) throw new Error(`${name} is not set in .env.local`);
  return value;
}
const supabaseUrl = env("NEXT_PUBLIC_SUPABASE_URL");
const key = env("SUPABASE_SERVICE_ROLE_KEY");
const headers = { apikey: key, authorization: `Bearer ${key}` };

/** As Places resolves them; see check-sokguram-spur.mts. */
const 교현 = { name: "교현탐방지원센터", lat: 37.69926, lng: 126.97532 };
const 우이 = { name: "우이탐방지원센터", lat: 37.67773, lng: 127.00330 };
const 석굴암 = { name: "석굴암(Places가 준 점)", lat: 37.69534, lng: 126.99466 };

async function rows(table: string, keys: string[]): Promise<TrailSegment[][]> {
  const list = keys.map((k) => `"${k}"`).join(",");
  const response = await fetch(
    `${supabaseUrl}/rest/v1/${table}?select=segments&tile_key=in.(${encodeURIComponent(list)})`,
    { headers },
  );
  if (!response.ok) throw new Error(`${table}: ${response.status}`);
  return ((await response.json()) as { segments: TrailSegment[] }[]).map((r) => r.segments ?? []);
}

const pts = [교현, 우이, 석굴암];
const bounds = {
  south: Math.min(...pts.map((p) => p.lat)) - 0.02, north: Math.max(...pts.map((p) => p.lat)) + 0.02,
  west: Math.min(...pts.map((p) => p.lng)) - 0.02, east: Math.max(...pts.map((p) => p.lng)) + 0.02,
};
const [osm, official] = await Promise.all([
  rows("trail_tiles", tilesForBounds(bounds)),
  rows("official_trails", tilesForBounds(bounds)),
]);
const segments = mergeTileSegments([
  mergeTileSegments(osm),
  splitSurveyGaps(mergeTileSegments(official)),
]);
console.log(`등산로 ${segments.length}개`);

const metres = (a: TrackPoint, b: TrackPoint) =>
  haversineDistanceMeters({ lat: a[0], lng: a[1] }, { lat: b[0], lng: b[1] });
const length = (points: TrackPoint[]) =>
  points.slice(1).reduce((total, point, i) => total + metres(points[i], point), 0);

function draw(points: { lat: number; lng: number }[]): TrackPoint[] | null {
  const prepared = prepareRouteSnap(points, segments);
  if (!prepared) return null;
  const legs = walkPreparedRoute(prepared, points.map((_, i) => i));
  return legs.every((leg) => leg.onTrail) ? legs.flatMap((leg) => leg.points) : null;
}

const direct = draw([교현, 우이]);
const viaTemple = draw([교현, 석굴암, 우이]);
if (!direct || !viaTemple) throw new Error("선을 그리지 못했습니다.");

console.log(`\n교현 → 우이, 그대로:        ${(length(direct) / 1000).toFixed(2)}km`);
console.log(`교현 → 석굴암 → 우이:       ${(length(viaTemple) / 1000).toFixed(2)}km`);
console.log(`절을 거치느라 늘어난 길이:  ${Math.round(length(viaTemple) - length(direct))}m`);

// Where the road passes closest to the temple, and how far up the branch it is.
const templePoint: TrackPoint = [석굴암.lat, 석굴암.lng];
const nearest = direct.reduce((best, point) =>
  metres(point, templePoint) < metres(best, templePoint) ? point : best, direct[0]);
console.log(`
본길이 절에 가장 가까워지는 곳까지: ${Math.round(metres(nearest, templePoint))}m`);

// The turning itself. The drawn course runs 교현 … junction … temple …
// junction … 우이, so the junction is the last point still on the road before
// the line leaves it for the temple. That is what "석굴암입구" names, and it is
// the point the club's own gazetteer would hold.
const onRoad = (point: TrackPoint) => direct.some((r) => metres(r, point) <= 20);
let atTemple = 0;
for (let i = 1; i < viaTemple.length; i++) {
  if (metres(viaTemple[i], templePoint) < metres(viaTemple[atTemple], templePoint)) atTemple = i;
}
let junction = -1;
for (let i = atTemple; i >= 0; i--) {
  if (onRoad(viaTemple[i])) { junction = i; break; }
}
if (junction >= 0) {
  const point = viaTemple[junction];
  const upBranch = length(viaTemple.slice(junction, atTemple + 1));
  console.log(`
갈림길(석굴암입구)로 보이는 지점: ${point[0].toFixed(5)}, ${point[1].toFixed(5)}`);
  console.log(`  거기서 절까지 가지 길이: ${Math.round(upBranch)}m (왕복 ${Math.round(upBranch * 2)}m)`);
  console.log(`  Places가 준 점과의 거리: ${Math.round(metres(point, templePoint))}m`);
} else {
  console.log("갈림길을 찾지 못했습니다.");
}
