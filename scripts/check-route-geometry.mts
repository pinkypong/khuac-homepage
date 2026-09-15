/** Read-only comparison of stored vs full OSM geometry on a real mountain. */
import { createClient } from "@supabase/supabase-js";
import { fetchTrailsInBounds } from "../src/lib/routes/overpass-core";
import { snapRouteToTrails, type SnapDiagnostics } from "../src/lib/routes/snap";
import { mergeTileSegments, tilesForBounds } from "../src/lib/routes/tiles";
import type { TrailSegment } from "../src/lib/routes/trails";
import { splitSurveyGaps } from "../src/lib/routes/trails";
import { execFileSync } from "node:child_process";
import { build } from "esbuild";
import { resolve } from "node:path";

const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } });
const bounds = { south: 37.60, west: 126.94, north: 37.68, east: 127.02 };
const keys = tilesForBounds(bounds);
const [pois, cached, official] = await Promise.all([
  client.from("route_pois").select("name,lat,lng").gte("lat", bounds.south).lte("lat", bounds.north).gte("lng", bounds.west).lte("lng", bounds.east),
  client.from("trail_tiles").select("segments").in("tile_key", keys.map(key => key.replace(/^v3:/, "v2:"))),
  client.from("official_trails").select("segments").in("tile_key", [...keys, ...keys.map(key => key.replace(/^v3:/, "v2:"))]),
]);
for (const result of [pois, cached, official]) if (result.error) throw new Error(result.error.message);
console.log("Available mountain landmarks:", pois.data?.map(p => p.name).join(", "));
const old = mergeTileSegments((cached.data ?? []).map(row => row.segments as TrailSegment[]));
const surveyed = splitSurveyGaps(mergeTileSegments((official.data ?? []).map(row => row.segments as TrailSegment[])));
console.log("Stored OSM ways:", old.length, "Surveyed ways:", surveyed.length);
const fixtures = [
  { name: "북한산성 주능선 구간: 위문 인근 → 대동문 → 대남문", points: [
    { lat: 37.6577384, lng: 126.9782184 }, { lat: 37.6404373, lng: 126.9858971 }, { lat: 37.63333819, lng: 126.977101 },
  ] },
  { name: "구기계곡 길 → 대남문", points: [
    { lat: 37.6209965, lng: 126.9642932 }, { lat: 37.6298783, lng: 126.9728325 }, { lat: 37.63333819, lng: 126.977101 },
  ] },
];
const baselineRef = process.env.ROUTE_BASELINE_REF ?? "fde9e5f5e0f90d01d133cd2ce7f22d815f78209a";
const baseline = await build({ stdin: { contents: execFileSync("git", ["show", `${baselineRef}:src/lib/routes/snap.ts`], { encoding: "utf8" }), resolveDir: resolve("src/lib/routes"), loader: "ts" }, bundle: true, format: "esm", platform: "node", write: false });
const previous = await import(`data:text/javascript;base64,${Buffer.from(baseline.outputFiles[0].text).toString("base64")}`);
for (const fixture of fixtures) {
  for (const [label, snap] of [["before", previous.snapRouteToTrails], ["after", snapRouteToTrails]] as const) {
    const diagnostics: SnapDiagnostics = { snapDistances: [], legs: [] };
    const start = performance.now();
    const legs = snap(fixture.points, mergeTileSegments([old, surveyed]), diagnostics);
    console.log(JSON.stringify({ course: fixture.name, version: label, ms: Math.round(performance.now() - start), diagnostics, pointCounts: legs.map((leg: { points: unknown[] }) => leg.points.length) }));
  }
}
if (!process.argv.includes("--fetch")) process.exit(0);
console.log("Fetching full geometry and pedestrian approaches...");
const fresh = await fetchTrailsInBounds(bounds, 20000);
const full = mergeTileSegments([fresh, surveyed]);
console.log("Fresh OSM ways:", fresh.length, "Vertices:", fresh.reduce((n, way) => n + way.points.length, 0));
// Use recorded landmarks when present, otherwise check real OSM way endpoints.
const byName = new Map((pois.data ?? []).map(p => [p.name, p]));
const names = ["밤골", "해골바위", "백운대", "도선사"];
const known = names.flatMap(name => byName.has(name) ? [byName.get(name)!] : []);
if (known.length >= 2) {
  for (const [label, geometry] of [["stored", mergeTileSegments([old, surveyed])], ["full", full]] as const) {
    const diagnostics: SnapDiagnostics = { snapDistances: [], legs: [] };
    const start = performance.now();
    const result = snapRouteToTrails(known, geometry, diagnostics);
    console.log(label, JSON.stringify({ names: known.map(p => p.name), milliseconds: Math.round(performance.now() - start), diagnostics, points: result.map(leg => leg.points.length) }));
  }
} else {
  console.log("No complete named fixture; checking the 10 longest mapped trails.");
  for (const way of fresh.slice(0, 10)) {
    const [a, b] = [way.points[0], way.points.at(-1)!];
    const result = snapRouteToTrails([{ lat: a[0], lng: a[1] }, { lat: b[0], lng: b[1] }], [way]);
    console.log(JSON.stringify({ way: way.id, name: way.name, mapped: result[0]?.onTrail, points: result[0]?.points.length }));
  }
}
