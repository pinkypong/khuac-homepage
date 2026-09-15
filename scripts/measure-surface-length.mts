/**
 * How much of the gap between a stated course length and ours is the hill?
 *
 *   node scripts/measure-surface-length.mts
 *
 * Course lengths here are measured flat: the sum of the horizontal distances
 * between the points of the drawn line. A trail climbs, so the distance walked
 * is longer than the distance covered on a map, and 우이령길 measuring 4.25km
 * against a published 6.8km was read as the stated figure being loose. That
 * reading was never checked, and the check is the point of this: if the hill
 * accounts for the gap, a stated length is a good number after all and can be
 * used to work out where a course must have started.
 *
 * Elevation from Open-Meteo's free endpoint, which serves Copernicus DEM
 * GLO-90 - ninety metres to a sample. That resolution is why the line is
 * resampled before the surface length is taken, and why it is taken at more
 * than one spacing: sampling a 90m model every ten metres does not find finer
 * ground, it finds the model's own noise, and every bump of that noise is
 * added to the length as if it were a climb.
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
      "X-Goog-FieldMask": "places.displayName,places.location",
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
const flatLength = (points: TrackPoint[]) =>
  points.slice(1).reduce((total, point, i) => total + metres(points[i], point), 0);

/** The line, thinned to one point every `spacing` metres along it. */
function resample(points: TrackPoint[], spacing: number): TrackPoint[] {
  const out: TrackPoint[] = [points[0]];
  let carried = 0;
  for (let i = 1; i < points.length; i++) {
    carried += metres(points[i - 1], points[i]);
    if (carried >= spacing) {
      out.push(points[i]);
      carried = 0;
    }
  }
  const last = points[points.length - 1];
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}

/** Copernicus DEM GLO-90, free and without a key. 100 points per request. */
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
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return out;
}

const CASES: { label: string; centre: { latitude: number; longitude: number }; names: string[]; statedKm: number }[] = [
  {
    label: "우이령길", centre: { latitude: 37.685, longitude: 126.995 }, statedKm: 6.8,
    names: ["북한산국립공원 교현탐방지원센터", "우이령", "북한산국립공원 우이령탐방지원센터"],
  },
  {
    label: "북한산성-백운대-도선사", centre: { latitude: 37.64, longitude: 126.98 }, statedKm: 7.1,
    names: ["북한산성탐방지원센터", "대서문", "백운봉암문", "백운대", "하루재", "백운대탐방지원센터"],
  },
  {
    label: "정릉-보국문-도선사", centre: { latitude: 37.64, longitude: 126.98 }, statedKm: 6.7,
    names: ["정릉탐방지원센터", "대성문", "보국문", "대동문", "용암문", "도선사"],
  },
  {
    label: "도봉 다락능선", centre: { latitude: 37.695, longitude: 127.015 }, statedKm: 5.0,
    names: ["도봉탐방지원센터", "광륜사", "다락능선", "포대정상", "도봉산 신선대"],
  },
];

for (const { label, centre, names, statedKm } of CASES) {
  const points = [];
  for (const name of names) points.push(await place(name, centre));

  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
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

  const prepared = prepareRouteSnap(points, segments);
  if (!prepared) { console.log(`${label}: 준비 실패`); continue; }
  const legs = walkPreparedRoute(prepared, points.map((_, i) => i));
  if (!legs.every((leg) => leg.onTrail)) { console.log(`${label}: 선이 끊겼습니다`); continue; }
  const line = legs.flatMap((leg) => leg.points);
  const flat = flatLength(line);

  console.log(`\n=== ${label}`);
  console.log(`  공식/답변 거리: ${statedKm.toFixed(2)}km`);
  console.log(`  우리 평면거리:  ${(flat / 1000).toFixed(2)}km  (${Math.round((flat / 1000 / statedKm - 1) * 100)}%)`);

  // The horizontal line is left exactly as drawn. Only the heights are sampled
  // coarsely, then read back onto every point of the full-resolution line by
  // interpolation. Resampling the line itself was tried first and was wrong:
  // thinning a switchbacking path to one point every 90m cuts its corners, so
  // the "surface" length came out shorter than the flat one, which says
  // something about the thinning and nothing about the hill.
  for (const spacing of [90, 30]) {
    const anchors = resample(line, spacing);
    const anchorHeight = await elevations(anchors);
    // Distance along the line to each anchor, so a height can be found for any
    // point by walking the same measure.
    const anchorAt: number[] = [0];
    for (let i = 1; i < anchors.length; i++) {
      anchorAt.push(anchorAt[i - 1] + metres(anchors[i - 1], anchors[i]));
    }
    const heightAt = (along: number) => {
      let i = 1;
      while (i < anchorAt.length - 1 && anchorAt[i] < along) i++;
      const span = anchorAt[i] - anchorAt[i - 1];
      const t = span > 0 ? Math.min(1, Math.max(0, (along - anchorAt[i - 1]) / span)) : 0;
      return anchorHeight[i - 1] + t * (anchorHeight[i] - anchorHeight[i - 1]);
    };

    let surface = 0;
    let ascent = 0;
    let along = 0;
    let height = heightAt(0);
    for (let i = 1; i < line.length; i++) {
      const run = metres(line[i - 1], line[i]);
      along += run;
      const next = heightAt(along);
      const rise = next - height;
      surface += Math.hypot(run, rise);
      if (rise > 0) ascent += rise;
      height = next;
    }
    console.log(`  고도 ${String(spacing).padStart(3)}m 간격 · 표면거리 ${(surface / 1000).toFixed(2)}km`
      + ` · 누적 상승 ${Math.round(ascent)}m · 평면 대비 +${((surface / flat - 1) * 100).toFixed(2)}%`
      + ` (고도 표본 ${anchors.length}개)`);
    console.log(`    이 표면거리로도 공식값과는 ${Math.round((surface / 1000 / statedKm - 1) * 100)}%`);
  }
}
