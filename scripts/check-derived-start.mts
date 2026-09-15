/**
 * Does back-calculating a missing start actually land on the trailhead?
 *
 *   node scripts/check-derived-start.mts
 *
 * The rule is: when a course's first name resolves to nothing, walk outward
 * along the paths from the first waypoint that did resolve, as far as the
 * course's stated length does not already account for, and take the trailhead
 * at that distance. Whether that is any good is a question about the ground.
 *
 * So it is asked of courses whose start we do know. The start is hidden, the
 * point is derived, and the two are compared. A derived start is shown to the
 * member as an estimate; this says how big an estimate.
 */
import { readFileSync } from "node:fs";
import { deriveWaypointFromLength, prepareRouteSnap, walkPreparedRoute } from "../src/lib/routes/snap.ts";
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
  const body = await response.json() as { places?: { displayName: { text: string }; location: { latitude: number; longitude: number } }[] };
  const found = body.places?.[0];
  if (!found) throw new Error(`찾지 못함: ${textQuery}`);
  return { name: found.displayName.text, lat: found.location.latitude, lng: found.location.longitude };
}

async function rows(table: string, keys: string[]): Promise<TrailSegment[][]> {
  const out: TrailSegment[][] = [];
  // In pages: a wide box names enough tiles that the query outgrows the URI
  // length the server will accept, which comes back as a bare 414.
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

/** Courses whose start we know, with the length the answer stated for each. */
const CASES: { label: string; centre: { latitude: number; longitude: number }; names: string[]; statedKm: number }[] = [
  {
    label: "우이령길", centre: { latitude: 37.685, longitude: 126.995 }, statedKm: 6.8,
    names: ["북한산국립공원 교현탐방지원센터", "우이령", "오봉 조망대", "북한산국립공원 우이령탐방지원센터"],
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

const metres = (a: TrackPoint, b: TrackPoint) =>
  haversineDistanceMeters({ lat: a[0], lng: a[1] }, { lat: b[0], lng: b[1] });
const legLength = (points: TrackPoint[]) =>
  points.slice(1).reduce((total, point, i) => total + metres(points[i], point), 0);

for (const { label, centre, names, statedKm } of CASES) {
  const points = [];
  for (const name of names) points.push(await place(name, centre));

  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  const bounds = {
    south: Math.min(...lats) - 0.03, north: Math.max(...lats) + 0.03,
    west: Math.min(...lngs) - 0.03, east: Math.max(...lngs) + 0.03,
  };
  const [osm, official] = await Promise.all([
    rows("trail_tiles", tilesForBounds(bounds)),
    rows("official_trails", tilesForBounds(bounds)),
  ]);
  const segments = mergeTileSegments([
    mergeTileSegments(osm),
    splitSurveyGaps(mergeTileSegments(official)),
  ]);

  // Exactly what the server does when the first name resolves to nothing:
  // prepare on the waypoints that did, see what they account for, and give the
  // remainder of the stated length to the missing end.
  const known = points.slice(1);
  const prepared = prepareRouteSnap(known, segments);
  const real = points[0];
  if (!prepared) {
    console.log(`${label}: 준비 실패`);
    continue;
  }
  const legs = walkPreparedRoute(prepared, known.map((_, i) => i));
  const accounted = legs.reduce((total, leg) => total + legLength(leg.points), 0);
  const missing = statedKm * 1000 - accounted;
  const from = prepared.snapped[0];
  const drawn = legs.flatMap((leg) => leg.points);
  const found = from === null || missing < 500
    ? null
    : deriveWaypointFromLength(prepared, from, missing, prepared.points[1] ?? null, drawn);

  console.log(`\n=== ${label} (${names[0]} 숨김, 코스 ${statedKm}km)`);
  console.log(`  나머지 경유지가 설명하는 길이: ${(accounted / 1000).toFixed(2)}km · 남은 몫 ${Math.round(missing)}m`);
  if (!found) {
    console.log("  추정하지 않음 (남은 몫이 너무 작거나 길이 닿지 않음)");
    continue;
  }
  const off = haversineDistanceMeters({ lat: found.point[0], lng: found.point[1] }, real);
  console.log(`  추정한 출발지: ${found.point[0].toFixed(5)}, ${found.point[1].toFixed(5)} (${Math.round(found.metres)}m 지점)`);
  console.log(`  실제 '${real.name}'까지: ${Math.round(off)}m 차이`);
}
