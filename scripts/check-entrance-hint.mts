/**
 * Does "석굴암입구" land on the turning once it stops being routed through?
 *
 *   node scripts/check-entrance-hint.mts
 *
 * The name is a turning on a road. No gazetteer carries turnings, so Places
 * answers with the temple 649m up the branch, and routing through that walked
 * the branch twice: 4.25km became 5.77km, which is the spur that showed beside
 * 우이령길 on the map.
 *
 * The rule now is to leave it out of the routing and put it on the finished
 * line, wherever that line passes closest to the temple. This checks the two
 * things that has to get right: the course is the length it was before the
 * temple was ever a waypoint, and the marker stands on the junction rather
 * than beside it.
 */
import { readFileSync } from "node:fs";
import { placeHints, prepareRouteSnap, walkPreparedRoute, type HintablePoint } from "../src/lib/routes/snap.ts";
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

/** As Places resolves them; see check-sokguram-spur.mts for the lookups. */
const 교현 = { lat: 37.69926, lng: 126.97532 };
const 우이령 = { lat: 37.68360, lng: 126.99850 };
const 오봉전망대 = { lat: 37.68740, lng: 127.00190 };
const 우이 = { lat: 37.67773, lng: 127.00330 };
/** What Places answers for 석굴암입구: the temple itself. */
const 석굴암 = { lat: 37.69534, lng: 126.99466 };
/** The junction, worked out by hand from the same geometry. */
const 갈림길 = { lat: 37.68981, lng: 126.99229 };

async function rows(table: string, keys: string[]): Promise<TrailSegment[][]> {
  const out: TrailSegment[][] = [];
  for (let i = 0; i < keys.length; i += 40) {
    const list = keys.slice(i, i + 40).map((k) => `"${k}"`).join(",");
    const response = await fetch(
      `${supabaseUrl}/rest/v1/${table}?select=segments&tile_key=in.(${encodeURIComponent(list)})`,
      { headers },
    );
    if (!response.ok) throw new Error(`${table}: ${response.status}`);
    for (const row of (await response.json()) as { segments: TrailSegment[] }[]) out.push(row.segments ?? []);
  }
  return out;
}

const route = [교현, 우이령, 오봉전망대, 우이];
const lats = [...route, 석굴암].map((p) => p.lat);
const lngs = [...route, 석굴암].map((p) => p.lng);
const bounds = {
  south: Math.min(...lats) - 0.02, north: Math.max(...lats) + 0.02,
  west: Math.min(...lngs) - 0.02, east: Math.max(...lngs) + 0.02,
};
const [osm, official] = await Promise.all([
  rows("trail_tiles", tilesForBounds(bounds)),
  rows("official_trails", tilesForBounds(bounds)),
]);
const segments = mergeTileSegments([
  mergeTileSegments(osm),
  splitSurveyGaps(mergeTileSegments(official)),
]);

const metres = (a: TrackPoint, b: TrackPoint) =>
  haversineDistanceMeters({ lat: a[0], lng: a[1] }, { lat: b[0], lng: b[1] });
const length = (points: TrackPoint[]) =>
  points.slice(1).reduce((total, point, i) => total + metres(points[i], point), 0);

// Routed without the temple, exactly as the course now is.
const prepared = prepareRouteSnap(route, segments);
if (!prepared) throw new Error("준비 실패");
const legs = walkPreparedRoute(prepared, route.map((_, i) => i));
const points: HintablePoint[] = route.map((point, index) => ({ ...point, index, derived: false }));
const before = length(legs.flatMap((leg) => leg.points));

const after = placeHints({ legs, points }, [{ index: 99, ...석굴암 }]);
const turning = after.points.find((point) => point.derived);
const drawn = length(after.legs.flatMap((leg) => leg.points));

// The same course as it was drawn before: the temple routed through, in the
// position the answer wrote it.
const asBefore = [교현, 석굴암, 우이령, 오봉전망대, 우이];
const preparedBefore = prepareRouteSnap(asBefore, segments);
const legsBefore = preparedBefore ? walkPreparedRoute(preparedBefore, asBefore.map((_, i) => i)) : [];
const throughTemple = length(legsBefore.flatMap((leg) => leg.points));

console.log(`등산로 ${segments.length}개`);
console.log(`\n석굴암을 경유지로 routing (이전): ${(throughTemple / 1000).toFixed(2)}km`);
console.log(`석굴암입구를 선 위에 놓음 (지금):  ${(drawn / 1000).toFixed(2)}km`);
console.log(`  사라진 왕복: ${Math.round(throughTemple - drawn)}m`);
console.log(`  (힌트를 놓기 전의 같은 선 ${(before / 1000).toFixed(2)}km — 힌트가 선을 바꾸지 않아야 맞습니다)`);

if (!turning) {
  console.log("\n입구를 선 위에 놓지 못했습니다.");
} else {
  console.log(`\n입구를 놓은 지점: ${turning.lat.toFixed(5)}, ${turning.lng.toFixed(5)}`);
  console.log(`  손으로 계산한 갈림길까지: ${Math.round(haversineDistanceMeters(turning, 갈림길))}m`);
  console.log(`  석굴암(Places가 준 점)까지: ${Math.round(haversineDistanceMeters(turning, 석굴암))}m`);
  console.log(`  구간 ${after.legs.length}개 · 경유지 ${after.points.length}개 (경유지가 하나 많아야 맞습니다)`);
}
