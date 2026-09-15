/**
 * Times each phase of drawing one course.
 *
 *   node scripts/profile-snap.mts
 *
 * A course died in production with "Worker exceeded CPU time limit" at 1,665ms
 * while the same work takes a fraction of a second on a laptop, so the question
 * is not whether it is slow but which phase owns the time. Phases are timed
 * here rather than guessed at from the shape of the code.
 */
import { readFileSync } from "node:fs";
import { buildTrailGraph, projectOntoTrails, snapRouteToTrails } from "../src/lib/routes/snap.ts";
import { mergeTileSegments, tilesForBounds } from "../src/lib/routes/tiles.ts";
import { splitSurveyGaps, type TrailSegment } from "../src/lib/routes/trails.ts";
import type { TrackPoint } from "../src/lib/gps/track.ts";

function env(name: string): string {
  const match = readFileSync(".env.local", "utf8").match(new RegExp(`^${name}=(.*)$`, "m"));
  const value = match?.[1]?.trim().replace(/^["']|["']$/g, "");
  if (!value) throw new Error(`${name} is not set in .env.local`);
  return value;
}

const url = env("NEXT_PUBLIC_SUPABASE_URL");
const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
const headers = { apikey: serviceKey, authorization: `Bearer ${serviceKey}` };

/** The 정릉 course, which is the size that failed. */
const waypoints = [
  { lat: 37.61934, lng: 126.99616 },
  { lat: 37.62720, lng: 126.98143 },
  { lat: 37.63319, lng: 126.97713 },
  { lat: 37.63593, lng: 126.98288 },
  { lat: 37.64033, lng: 126.98611 },
  { lat: 37.64370, lng: 126.98322 },
  { lat: 37.65070, lng: 126.98255 },
  { lat: 37.65549, lng: 126.98977 },
];

const lats = waypoints.map((p) => p.lat);
const lngs = waypoints.map((p) => p.lng);
const bounds = {
  south: Math.min(...lats) - 0.02, west: Math.min(...lngs) - 0.02,
  north: Math.max(...lats) + 0.02, east: Math.max(...lngs) + 0.02,
};

async function rows(table: string, keys: string[]): Promise<TrailSegment[][]> {
  const list = keys.map((key) => `"${key}"`).join(",");
  const response = await fetch(
    `${url}/rest/v1/${table}?select=segments&tile_key=in.(${encodeURIComponent(list)})`,
    { headers },
  );
  if (!response.ok) throw new Error(`${table}: ${response.status}`);
  return ((await response.json()) as { segments: TrailSegment[] }[]).map((row) => row.segments ?? []);
}

const keys = tilesForBounds(bounds);
const [osm, official] = await Promise.all([rows("trail_tiles", keys), rows("official_trails", keys)]);
const segments = mergeTileSegments([
  mergeTileSegments(osm),
  splitSurveyGaps(mergeTileSegments(official)),
]);
const vertices = segments.reduce((n, s) => n + s.points.length, 0);
console.log(`타일 ${keys.length}개 · 등산로 ${segments.length}개 · 좌표 ${vertices}개`);

const time = <T>(label: string, run: () => T): T => {
  const started = performance.now();
  const value = run();
  console.log(`  ${label}: ${Math.round(performance.now() - started)}ms`);
  return value;
};

const points: TrackPoint[] = waypoints.map((w) => [w.lat, w.lng]);
const projected = time("projectOntoTrails", () => projectOntoTrails(points, segments));
const graph = time("buildTrailGraph", () => buildTrailGraph(projected.segments));
console.log(`  (노드 ${graph.nodes.length}개)`);
time("snapRouteToTrails 전체", () => snapRouteToTrails(waypoints, segments));
