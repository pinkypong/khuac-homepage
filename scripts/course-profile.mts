/**
 * The elevation profile of a course, and which stretch of it is the work.
 *
 *   node scripts/course-profile.mts
 *
 * The national park draws its courses side-on: height against distance, with
 * the named points along the bottom and the steep parts marked, so a reader can
 * see where the climbing is before deciding to do it. A course card here says
 * "약 7.1km, 약 4시간" and nothing about whether that is a walk or a ladder.
 *
 * Everything needed is already to hand. The line is drawn onto real paths, the
 * waypoints are positioned on it, and elevation comes from Copernicus DEM
 * GLO-90 through Open-Meteo, free and without a key. This prints what the data
 * supports, before any of it is turned into a picture.
 *
 * Sampled at 90m, the model's own resolution. Asking it every ten metres does
 * not find finer ground, it finds the model's noise, and each bump of that
 * noise is counted as a climb.
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
const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
const mapsKey = env("NEXT_PUBLIC_GOOGLE_MAPS_API_KEY");
const headers = { apikey: serviceKey, authorization: `Bearer ${serviceKey}` };

async function place(textQuery: string, centre: { latitude: number; longitude: number }) {
  const response = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "content-type": "application/json", "X-Goog-Api-Key": mapsKey, referer: "https://khuac.com/",
      "X-Goog-FieldMask": "places.location",
    },
    body: JSON.stringify({
      textQuery, languageCode: "ko", regionCode: "KR", maxResultCount: 1,
      locationBias: { circle: { center: centre, radius: 20000 } },
    }),
  });
  const body = await response.json() as { places?: { location: { latitude: number; longitude: number } }[] };
  const found = body.places?.[0];
  if (!found) throw new Error(`찾지 못함: ${textQuery}`);
  return { lat: found.location.latitude, lng: found.location.longitude };
}

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

const metres = (a: TrackPoint, b: TrackPoint) =>
  haversineDistanceMeters({ lat: a[0], lng: a[1] }, { lat: b[0], lng: b[1] });

/** One point every `spacing` metres along the line, with distance carried. */
function sampleAlong(points: TrackPoint[], spacing: number) {
  const out: { point: TrackPoint; along: number }[] = [{ point: points[0], along: 0 }];
  let along = 0;
  let carried = 0;
  for (let i = 1; i < points.length; i++) {
    const run = metres(points[i - 1], points[i]);
    along += run;
    carried += run;
    if (carried >= spacing) {
      out.push({ point: points[i], along });
      carried = 0;
    }
  }
  if (out[out.length - 1].point !== points[points.length - 1]) {
    out.push({ point: points[points.length - 1], along });
  }
  return out;
}

async function elevations(points: TrackPoint[]): Promise<number[]> {
  const out: number[] = [];
  for (let i = 0; i < points.length; i += 100) {
    const batch = points.slice(i, i + 100);
    const url = "https://api.open-meteo.com/v1/elevation"
      + `?latitude=${batch.map((p) => p[0].toFixed(5)).join(",")}`
      + `&longitude=${batch.map((p) => p[1].toFixed(5)).join(",")}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`elevation: ${response.status}`);
    out.push(...(await response.json() as { elevation: number[] }).elevation);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return out;
}

/**
 * What a stretch feels like underfoot, in the words a course card would use.
 *
 * Read off the average gradient, not the steepest step in it. The model is 90m
 * to a sample, so a single step of it is as likely to be the model's noise as a
 * cliff - grading by the steepest step marked the descent from 백운대 as
 * "가파름" on the strength of one 18% rise inside a 300m drop.
 *
 * Downhill is graded on the same numbers and named separately, because they are
 * not the same work: 24% down off 백운대 is hard on the knees and easy on the
 * lungs, and a course card that calls both "가파름" tells a reader nothing about
 * which way round to walk it.
 */
function grade(slope: number): { label: string; mark: string } {
  const up = Math.abs(slope);
  const way = slope >= 0 ? "오르막" : "내리막";
  if (up < 0.05) return { label: "평탄", mark: "·" };
  if (up < 0.12) return { label: `완만한 ${way}`, mark: "▁" };
  if (up < 0.22) return { label: `${way}`, mark: "▄" };
  return { label: `가파른 ${way}`, mark: "█" };
}

/**
 * The steepest 200m of a stretch - long enough that one bad sample cannot own
 * it. Null for a stretch shorter than the window, where there is no such run to
 * find and a zero would read as flat ground.
 */
function steepestRun(within: { along: number; height: number }[], window = 200): number | null {
  let worst: number | null = null;
  for (let i = 0; i < within.length; i++) {
    for (let j = i + 1; j < within.length; j++) {
      const run = within[j].along - within[i].along;
      if (run < window) continue;
      const slope = Math.abs(within[j].height - within[i].height) / run;
      worst = worst === null ? slope : Math.max(worst, slope);
      break;
    }
  }
  return worst;
}

const CASES: { label: string; centre: { latitude: number; longitude: number }; names: string[] }[] = [
  {
    label: "북한산성 → 백운대 → 도선사", centre: { latitude: 37.64, longitude: 126.98 },
    names: ["북한산성탐방지원센터", "대서문", "백운봉암문", "백운대", "하루재", "백운대탐방지원센터"],
  },
  {
    label: "우이령길", centre: { latitude: 37.685, longitude: 126.995 },
    names: ["북한산국립공원 교현탐방지원센터", "우이령", "북한산국립공원 우이령탐방지원센터"],
  },
];

for (const { label, centre, names } of CASES) {
  const started = Date.now();
  const waypoints = [];
  for (const name of names) waypoints.push(await place(name, centre));

  const lats = waypoints.map((p) => p.lat);
  const lngs = waypoints.map((p) => p.lng);
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

  const prepared = prepareRouteSnap(waypoints, segments);
  if (!prepared) { console.log(`${label}: 준비 실패`); continue; }
  const legs = walkPreparedRoute(prepared, waypoints.map((_, i) => i));
  if (!legs.every((leg) => leg.onTrail)) { console.log(`${label}: 선이 끊겼습니다`); continue; }
  const line = legs.flatMap((leg) => leg.points);

  // Where each waypoint falls along the line, so the profile can be labelled.
  const legEnds: number[] = [0];
  for (const leg of legs) {
    let run = 0;
    for (let i = 1; i < leg.points.length; i++) run += metres(leg.points[i - 1], leg.points[i]);
    legEnds.push(legEnds[legEnds.length - 1] + run);
  }

  const asked = Date.now();
  const sampled = sampleAlong(line, 90);
  const height = await elevations(sampled.map((s) => s.point));
  const elevationMs = Date.now() - asked;

  const total = sampled[sampled.length - 1].along;
  const high = Math.max(...height);
  const low = Math.min(...height);
  let ascent = 0;
  let descent = 0;
  for (let i = 1; i < height.length; i++) {
    const rise = height[i] - height[i - 1];
    if (rise > 0) ascent += rise; else descent -= rise;
  }

  console.log(`\n=== ${label}`);
  console.log(`  ${(total / 1000).toFixed(2)}km · 최저 ${Math.round(low)}m · 최고 ${Math.round(high)}m`
    + ` · 상승 ${Math.round(ascent)}m · 하강 ${Math.round(descent)}m`);
  console.log(`  표본 ${sampled.length}개 · 고도 조회 ${elevationMs}ms · 전체 ${Date.now() - started}ms`);

  // A side view, twenty rows tall, the way the park draws it.
  const ROWS = 12;
  const COLS = Math.min(72, sampled.length);
  const grid = Array.from({ length: ROWS }, () => Array(COLS).fill(" "));
  for (let c = 0; c < COLS; c++) {
    const at = Math.round(c * (sampled.length - 1) / (COLS - 1));
    const share = high === low ? 0 : (height[at] - low) / (high - low);
    const row = ROWS - 1 - Math.round(share * (ROWS - 1));
    for (let r = row; r < ROWS; r++) grid[r][c] = "█";
  }
  console.log();
  for (const [r, row] of grid.entries()) {
    const at = Math.round(low + (high - low) * (ROWS - 1 - r) / (ROWS - 1));
    console.log(`  ${String(at).padStart(4)}m │${row.join("")}`);
  }
  console.log(`        └${"─".repeat(COLS)}`);
  console.log(`         0km${" ".repeat(Math.max(0, COLS - 12))}${(total / 1000).toFixed(1)}km`);

  // The sections between named points, and how hard each one is.
  console.log();
  for (let i = 1; i < legEnds.length; i++) {
    const from = legEnds[i - 1];
    const to = legEnds[i];
    const within = sampled
      .map((s, at) => ({ along: s.along, height: height[at] }))
      .filter((s) => s.along >= from && s.along <= to);
    if (within.length < 2) continue;
    const rise = within[within.length - 1].height - within[0].height;
    const run = to - from;
    const slope = run > 0 ? rise / run : 0;
    let climbed = 0;
    for (let k = 1; k < within.length; k++) {
      const step = within[k].height - within[k - 1].height;
      if (step > 0) climbed += step;
    }
    const hardest = steepestRun(within);
    const { label: feel, mark } = grade(slope);
    console.log(`  ${mark} ${names[i - 1]} → ${names[i]}  ${feel}`);
    console.log(`     ${(run / 1000).toFixed(2)}km · 고도차 ${rise >= 0 ? "+" : ""}${Math.round(rise)}m`
      + ` · 상승 ${Math.round(climbed)}m · 평균 ${(slope * 100).toFixed(0)}%`
      + (hardest === null ? "" : ` · 가장 가파른 200m ${(hardest * 100).toFixed(0)}%`));
  }
}
