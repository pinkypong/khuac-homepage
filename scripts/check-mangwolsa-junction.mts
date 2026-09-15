/**
 * Is 망월사 at the 망월사 갈림길, or up a branch from it?
 *
 *   node scripts/check-mangwolsa-junction.mts
 *
 * poi.ts says the two are one place - "망월사 갈림길 answered with 망월사 is the
 * same place described less fully, and the temple really is where that junction
 * is" - and on that reading routing through the temple costs nothing. Treating
 * the name as a turning instead cut the 다락능선 course from 4.93km to 3.33km,
 * which is only right if the temple is not where the junction is.
 */
import { readFileSync } from "node:fs";
import { haversineDistanceMeters } from "../src/lib/gps/haversine.ts";
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
const key = env("SUPABASE_SERVICE_ROLE_KEY");
const mapsKey = env("NEXT_PUBLIC_GOOGLE_MAPS_API_KEY");
const headers = { apikey: key, authorization: `Bearer ${key}` };

async function place(textQuery: string) {
  const response = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "content-type": "application/json", "X-Goog-Api-Key": mapsKey, referer: "https://khuac.com/",
      "X-Goog-FieldMask": "places.displayName,places.location",
    },
    body: JSON.stringify({
      textQuery, languageCode: "ko", regionCode: "KR", maxResultCount: 1,
      locationBias: { circle: { center: { latitude: 37.695, longitude: 127.015 }, radius: 15000 } },
    }),
  });
  const body = await response.json() as { places?: { displayName: { text: string }; location: { latitude: number; longitude: number } }[] };
  const found = body.places?.[0];
  if (!found) throw new Error(`찾지 못함: ${textQuery}`);
  return { name: found.displayName.text, lat: found.location.latitude, lng: found.location.longitude };
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

const 시작 = await place("도봉산 도봉탐방지원센터");
const 광륜사 = await place("도봉산 광륜사");
const 다락능선 = await place("도봉산 다락능선");
const 망월사 = await place("도봉산 망월사");
const 포대 = await place("도봉산 포대정상");
const 신선대 = await place("도봉산 신선대");
for (const [label, p] of [["망월사", 망월사], ["다락능선", 다락능선], ["포대정상", 포대]] as const) {
  console.log(`${label}: ${p.name} (${p.lat.toFixed(5)}, ${p.lng.toFixed(5)})`);
}

const all = [시작, 광륜사, 다락능선, 망월사, 포대, 신선대];
const bounds = {
  south: Math.min(...all.map((p) => p.lat)) - 0.02, north: Math.max(...all.map((p) => p.lat)) + 0.02,
  west: Math.min(...all.map((p) => p.lng)) - 0.02, east: Math.max(...all.map((p) => p.lng)) + 0.02,
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

function draw(points: { lat: number; lng: number }[]): TrackPoint[] | null {
  const prepared = prepareRouteSnap(points, segments);
  if (!prepared) return null;
  const legs = walkPreparedRoute(prepared, points.map((_, i) => i));
  return legs.every((leg) => leg.onTrail) ? legs.flatMap((leg) => leg.points) : null;
}

const without = draw([시작, 광륜사, 다락능선, 포대, 신선대]);
const through = draw([시작, 광륜사, 다락능선, 망월사, 포대, 신선대]);
if (!without || !through) throw new Error("선을 그리지 못했습니다.");

console.log(`\n망월사를 거치지 않는 다락능선:  ${(length(without) / 1000).toFixed(2)}km`);
console.log(`망월사를 경유지로 routing:      ${(length(through) / 1000).toFixed(2)}km`);
console.log(`차이: ${Math.round(length(through) - length(without))}m`);

const templePoint: TrackPoint = [망월사.lat, 망월사.lng];
const closest = without.reduce((best, point) =>
  metres(point, templePoint) < metres(best, templePoint) ? point : best, without[0]);
console.log(`\n능선이 망월사에 가장 가까워지는 거리: ${Math.round(metres(closest, templePoint))}m`);
console.log(`  그 지점 ${closest[0].toFixed(5)}, ${closest[1].toFixed(5)}`);
