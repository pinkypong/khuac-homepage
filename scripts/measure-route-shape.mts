/**
 * Measures how closely a drawn course follows real trail, rather than whether
 * it drew at all.
 *
 *   node scripts/measure-route-shape.mts
 *
 * "It is a solid line now" was never the question the club was asking. A leg
 * can be solid and still be four straight sticks, which is what a ridge looks
 * like after its geometry has been thinned to a fixed point budget. So the
 * number that matters is the longest gap between consecutive drawn points: a
 * real Korean trail is mapped every 10-15m, and anything over about 200m is a
 * straight jump somebody will notice on the map.
 */
import { readFileSync } from "node:fs";
import { snapRouteToTrails, type SnapDiagnostics } from "../src/lib/routes/snap.ts";
import { mergeTileSegments, tilesForBounds } from "../src/lib/routes/tiles.ts";
import { splitSurveyGaps, type TrailSegment } from "../src/lib/routes/trails.ts";
import { haversineDistanceMeters } from "../src/lib/gps/haversine.ts";

function env(name: string): string {
  const match = readFileSync(".env.local", "utf8").match(new RegExp(`^${name}=(.*)$`, "m"));
  const value = match?.[1]?.trim().replace(/^["']|["']$/g, "");
  if (!value) throw new Error(`${name} is not set in .env.local`);
  return value;
}

const url = env("NEXT_PUBLIC_SUPABASE_URL");
const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
const headers = { apikey: serviceKey, authorization: `Bearer ${serviceKey}` };

async function rows(table: string, keys: string[]): Promise<TrailSegment[][]> {
  const list = keys.map((key) => `"${key}"`).join(",");
  const response = await fetch(
    `${url}/rest/v1/${table}?select=segments&tile_key=in.(${encodeURIComponent(list)})`,
    { headers },
  );
  if (!response.ok) throw new Error(`${table}: ${response.status}`);
  return ((await response.json()) as { segments: TrailSegment[] }[]).map((row) => row.segments ?? []);
}

/** The same box the server action builds around a course. */
function boundsOf(points: { lat: number; lng: number }[]) {
  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  const margin = 0.02;
  return {
    south: Math.min(...lats) - margin,
    west: Math.min(...lngs) - margin,
    north: Math.max(...lats) + margin,
    east: Math.max(...lngs) + margin,
  };
}

const courses: { name: string; points: { lat: number; lng: number }[] }[] = [
  {
    name: "구기계곡 → 대남문",
    points: [
      { lat: 37.6209965, lng: 126.9642932 },
      { lat: 37.6298783, lng: 126.9728325 },
      { lat: 37.6333382, lng: 126.977101 },
    ],
  },
  {
    name: "북한산성 주능선 (위문 → 대동문 → 대남문)",
    points: [
      { lat: 37.6577384, lng: 126.9782184 },
      { lat: 37.6404373, lng: 126.9858971 },
      { lat: 37.6333382, lng: 126.977101 },
    ],
  },
  {
    name: "정릉탐방지원센터 → 보국문",
    points: [
      { lat: 37.61934, lng: 126.99616 },
      { lat: 37.63593, lng: 126.98288 },
    ],
  },
];

for (const course of courses) {
  const keys = tilesForBounds(boundsOf(course.points));
  const [osm, official] = await Promise.all([
    rows("trail_tiles", keys),
    rows("official_trails", keys),
  ]);
  const segments = mergeTileSegments([
    ...osm,
    splitSurveyGaps(mergeTileSegments(official)),
  ]);

  const diagnostics: SnapDiagnostics = { snapDistances: [], legs: [] };
  const started = performance.now();
  const legs = snapRouteToTrails(course.points, segments, diagnostics);
  const ms = Math.round(performance.now() - started);

  console.log(`\n${course.name}  (등산로 ${segments.length}개 · ${ms}ms · 스냅 ${diagnostics.snapDistances.join("/")}m)`);
  legs.forEach((leg, i) => {
    if (!leg.onTrail) {
      console.log(`  ${i + 1}구간: 경로 없음 (점선) · ${JSON.stringify(diagnostics.legs[i])}`);
      return;
    }
    const gaps: number[] = [];
    for (let j = 1; j < leg.points.length; j++) {
      gaps.push(haversineDistanceMeters(
        { lat: leg.points[j - 1][0], lng: leg.points[j - 1][1] },
        { lat: leg.points[j][0], lng: leg.points[j][1] },
      ));
    }
    const total = gaps.reduce((a, b) => a + b, 0);
    const sorted = [...gaps].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
    const longest = Math.max(...gaps);
    const over200 = gaps.filter((g) => g > 200).length;
    console.log(
      `  ${i + 1}구간: ${leg.points.length}점 · ${(total / 1000).toFixed(2)}km` +
      ` · 점 간격 중앙값 ${median.toFixed(0)}m · 최대 ${longest.toFixed(0)}m` +
      ` · 200m 넘는 직선 ${over200}개`,
    );
  });
}
