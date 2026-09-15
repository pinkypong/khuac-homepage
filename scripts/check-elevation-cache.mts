/**
 * Exercises the elevation cache the way a course profile does.
 *
 *   node scripts/check-elevation-cache.mts
 *
 * The profile under the map is worth a second of somebody else's network the
 * first time and nothing every time after, which is the whole reason the
 * heights are stored per cell rather than per course. That only holds if the
 * cell key a point is written under is the one it is later read back by, and a
 * rounding that disagrees with itself would look exactly like a cache that
 * never warms: correct pictures, a second of waiting, every time.
 *
 * So it is run twice and the second run is timed.
 */
import { readFileSync } from "node:fs";
import {
  buildProfile, cellCentre, cellKey, gradientBands, sampleAlongTrack, sectionsOf, stackLabels, waypointsAlong,
} from "../src/lib/routes/elevation.ts";
import { prepareRouteSnap, walkPreparedRoute } from "../src/lib/routes/snap.ts";
import { mergeTileSegments, tilesForBounds } from "../src/lib/routes/tiles.ts";
import { splitSurveyGaps, type TrailSegment } from "../src/lib/routes/trails.ts";
import type { TrackPoint } from "../src/lib/gps/track.ts";

function env(name: string): string {
  const match = readFileSync(".env.local", "utf8").match(new RegExp(`^${name}=(.*)$`, "m"));
  const value = match?.[1]?.trim().replace(/^["']|["']$/g, "");
  if (!value) throw new Error(`${name} is not set in .env.local`);
  return value;
}
const supabaseUrl = env("NEXT_PUBLIC_SUPABASE_URL");
const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
const mapsKey = env("NEXT_PUBLIC_GOOGLE_MAPS_API_KEY");
const headers = { apikey: serviceKey, authorization: `Bearer ${serviceKey}` };

async function place(textQuery: string) {
  const response = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "content-type": "application/json", "X-Goog-Api-Key": mapsKey, referer: "https://khuac.com/",
      "X-Goog-FieldMask": "places.location",
    },
    body: JSON.stringify({
      textQuery, languageCode: "ko", regionCode: "KR", maxResultCount: 1,
      locationBias: { circle: { center: { latitude: 37.64, longitude: 126.98 }, radius: 20000 } },
    }),
  });
  const body = await response.json() as { places?: { location: { latitude: number; longitude: number } }[] };
  const found = body.places?.[0];
  if (!found) throw new Error(`찾지 못함: ${textQuery}`);
  return { lat: found.location.latitude, lng: found.location.longitude };
}

async function tiles(table: string, keys: string[]): Promise<TrailSegment[][]> {
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

const NAMES = ["북한산성탐방지원센터", "대서문", "백운봉암문", "백운대", "하루재", "백운대탐방지원센터"];
const waypoints = [];
for (const name of NAMES) waypoints.push(await place(name));

const lats = waypoints.map((p) => p.lat);
const lngs = waypoints.map((p) => p.lng);
const [osm, official] = await Promise.all([
  tiles("trail_tiles", tilesForBounds({
    south: Math.min(...lats) - 0.02, north: Math.max(...lats) + 0.02,
    west: Math.min(...lngs) - 0.02, east: Math.max(...lngs) + 0.02,
  })),
  tiles("official_trails", tilesForBounds({
    south: Math.min(...lats) - 0.02, north: Math.max(...lats) + 0.02,
    west: Math.min(...lngs) - 0.02, east: Math.max(...lngs) + 0.02,
  })),
]);
const segments = mergeTileSegments([mergeTileSegments(osm), splitSurveyGaps(mergeTileSegments(official))]);
const prepared = prepareRouteSnap(waypoints, segments);
if (!prepared) throw new Error("준비 실패");
const legs = walkPreparedRoute(prepared, waypoints.map((_, i) => i));
const line: TrackPoint[] = legs.flatMap((leg) => leg.points);

/** The same steps the server action takes, against the same table. */
async function profileOnce() {
  const started = Date.now();
  const sampled = sampleAlongTrack(line);
  const keys = [...new Set(sampled.map(({ point }) => cellKey(point[0], point[1])))];

  const known = new Map<string, number>();
  const list = keys.map((k) => `"${k}"`).join(",");
  const held = await fetch(
    `${supabaseUrl}/rest/v1/elevation_cells?select=cell_key,elevation&cell_key=in.(${encodeURIComponent(list)})`,
    { headers },
  );
  if (!held.ok) throw new Error(`elevation_cells: ${held.status} ${(await held.text()).slice(0, 200)}`);
  for (const row of (await held.json()) as { cell_key: string; elevation: number }[]) {
    known.set(row.cell_key, row.elevation);
  }
  const hit = known.size;

  const missing = keys.filter((key) => !known.has(key));
  if (missing.length > 0) {
    const centres = missing.map(cellCentre);
    const url = "https://api.open-meteo.com/v1/elevation"
      + `?latitude=${centres.map((c) => c.lat.toFixed(5)).join(",")}`
      + `&longitude=${centres.map((c) => c.lng.toFixed(5)).join(",")}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`elevation: ${response.status}`);
    const { elevation } = await response.json() as { elevation: number[] };
    missing.forEach((key, at) => known.set(key, elevation[at]));

    const write = await fetch(`${supabaseUrl}/rest/v1/elevation_cells?on_conflict=cell_key`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json", prefer: "resolution=merge-duplicates" },
      body: JSON.stringify(missing.map((key) => ({ cell_key: key, elevation: Math.round(known.get(key)!) }))),
    });
    if (!write.ok) throw new Error(`저장 실패 ${write.status}: ${(await write.text()).slice(0, 200)}`);
  }

  const heights = sampled.map(({ point }) => known.get(cellKey(point[0], point[1]))!);
  const profile = buildProfile(line, sampled, heights)!;
  const along = waypointsAlong(line, waypoints);
  const sections = sectionsOf(profile, NAMES, along);
  return { profile, sections, keys: keys.length, hit, ms: Date.now() - started };
}

const first = await profileOnce();
console.log(`1회차: 셀 ${first.keys}개 중 캐시 적중 ${first.hit}개 · ${first.ms}ms`);
const second = await profileOnce();
console.log(`2회차: 셀 ${second.keys}개 중 캐시 적중 ${second.hit}개 · ${second.ms}ms`);

const { profile } = second;
console.log(`\n평면 ${(profile.distanceM / 1000).toFixed(2)}km · 표면 ${(profile.surfaceM / 1000).toFixed(2)}km`
  + ` · 상승 ${Math.round(profile.ascentM)}m · 하강 ${Math.round(profile.descentM)}m`
  + ` · ${Math.round(profile.lowM)}~${Math.round(profile.highM)}m`);
for (const section of second.sections) {
  console.log(`  ${section.from} → ${section.to}: ${(section.distanceM / 1000).toFixed(2)}km`
    + ` · ${section.riseM >= 0 ? "+" : ""}${Math.round(section.riseM)}m`
    + ` · ${Math.round(section.gradient * 100)}% · ${section.steepness}${section.downhill ? " (내리막)" : ""}`);
}

const rows = await fetch(`${supabaseUrl}/rest/v1/elevation_cells?select=cell_key`, {
  headers: { ...headers, prefer: "count=exact", range: "0-0" },
});
console.log(`\n저장된 셀: ${rows.headers.get("content-range")}`);

// What the chart will actually draw: the coloured bands, and which row each
// name lands on now that close ones are staggered instead of overlapping.
const along = waypointsAlong(line, waypoints);
console.log("");
console.log("=== 난이도 구간 (색이 칠해질 단위) ===");
for (const band of gradientBands(second.profile)) {
  const pct = Math.round(band.gradient * 100);
  console.log(`  ${(band.fromAlong / 1000).toFixed(2)}~${(band.toAlong / 1000).toFixed(2)}km`
    + ` · ${String(pct).padStart(4)}% · ${band.steepness}`);
}
console.log("");
console.log("=== 이름표 배치 ===");
const labelRows = stackLabels(along.map((a) => a / second.profile.distanceM));
along.forEach((a, i) => {
  const at = ((a / second.profile.distanceM) * 100).toFixed(1);
  console.log(`  ${NAMES[i].padEnd(14)} ${at.padStart(5)}% → ${labelRows[i] === null ? "표시 안 함" : labelRows[i] + "번째 줄"}`);
});
