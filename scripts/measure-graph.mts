/**
 * Reports how connected the trail graph actually is around a point.
 *
 *   node scripts/measure-graph.mts <lat> <lng> [lat2 lng2]
 *
 * A leg that reports routedM: null did not fail a plausibility check - no path
 * existed at all. That is a statement about the graph, not about the course,
 * and the way to see it is to count the pieces the graph falls into. One big
 * component and a tail of small ones is a healthy mountain; thousands of
 * middling ones means the ways are not being joined where they meet.
 */
import { readFileSync } from "node:fs";
import { buildTrailGraph, projectOntoTrails } from "../src/lib/routes/snap.ts";
import { haversineDistanceMeters } from "../src/lib/gps/haversine.ts";
import { mergeTileSegments, tilesForBounds } from "../src/lib/routes/tiles.ts";
import { splitSurveyGaps, type TrailSegment } from "../src/lib/routes/trails.ts";

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

const [aLat, aLng, bLat, bLng] = process.argv.slice(2).map(Number);
const waypoints = [{ lat: aLat, lng: aLng }];
if (Number.isFinite(bLat)) waypoints.push({ lat: bLat, lng: bLng });

const lats = waypoints.map((p) => p.lat);
const lngs = waypoints.map((p) => p.lng);
const bounds = {
  south: Math.min(...lats) - 0.02,
  west: Math.min(...lngs) - 0.02,
  north: Math.max(...lats) + 0.02,
  east: Math.max(...lngs) + 0.02,
};
const keys = tilesForBounds(bounds);
const [osm, official] = await Promise.all([rows("trail_tiles", keys), rows("official_trails", keys)]);
const osmSegments = mergeTileSegments(osm);
const parkSegments = splitSurveyGaps(mergeTileSegments(official));
console.log(`OSM ${osmSegments.length}개 · 공단 ${parkSegments.length}개`);

const only = process.env.ONLY;
const segments = mergeTileSegments(
  only === "osm" ? [osmSegments] : only === "park" ? [parkSegments] : [osmSegments, parkSegments],
);
if (only) console.log(`(${only}만 사용)`);
const points = waypoints.map((w) => [w.lat, w.lng] as [number, number]);
const projected = projectOntoTrails(points, segments);
const graph = buildTrailGraph(projected.segments);

// Flood fill: every node reachable from one start is one component.
const component = new Int32Array(graph.nodes.length).fill(-1);
const sizes: number[] = [];
for (let start = 0; start < graph.nodes.length; start++) {
  if (component[start] !== -1) continue;
  const id = sizes.length;
  let size = 0;
  const stack = [start];
  component[start] = id;
  while (stack.length > 0) {
    const node = stack.pop()!;
    size++;
    for (const edge of graph.edges.get(node) ?? []) {
      if (component[edge.to] === -1) {
        component[edge.to] = id;
        stack.push(edge.to);
      }
    }
  }
  sizes.push(size);
}

const ranked = [...sizes].sort((a, b) => b - a);
console.log(`노드 ${graph.nodes.length}개 · 덩어리 ${sizes.length}개 · 가장 큰 5개 ${ranked.slice(0, 5).join(", ")}`);
console.log(`가장 큰 덩어리가 전체의 ${((ranked[0] / graph.nodes.length) * 100).toFixed(1)}%`);

for (const [i, point] of projected.projected.entries()) {
  if (!point) {
    console.log(`경유지 ${i + 1}: 스냅 실패`);
    continue;
  }
  // snap.ts keeps its own spatial index private; a linear scan is exact and
  // fast enough for one diagnostic run.
  let node = -1;
  let best = Infinity;
  graph.nodes.forEach((candidate, id) => {
    const gap = haversineDistanceMeters(
      { lat: point[0], lng: point[1] },
      { lat: candidate[0], lng: candidate[1] },
    );
    if (gap < best) {
      best = gap;
      node = id;
    }
  });
  if (node < 0) {
    console.log(`경유지 ${i + 1}: 가까운 노드 없음`);
    continue;
  }
  console.log(`경유지 ${i + 1}: 덩어리 #${component[node]} (크기 ${sizes[component[node]]})`);
}
