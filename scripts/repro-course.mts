/**
 * Reproduces one course the way the browser does it.
 *
 *   node scripts/repro-course.mts 북한산 구기탐방지원센터 대남문 대동문 용암문 도선사
 *
 * The map resolves waypoint names through Places and then asks the server to
 * pull the line onto real trails, and a course can fail in either half. This
 * runs both against the live services, so a course that draws nothing on the
 * phone can be taken apart here instead of guessed at from a screenshot.
 */
import { readFileSync } from "node:fs";
import { snapRouteToTrails, dropOutlierWaypoints, type SnapDiagnostics } from "../src/lib/routes/snap.ts";
import { mergeTileSegments, tilesForBounds } from "../src/lib/routes/tiles.ts";
import { splitSurveyGaps, type TrailSegment } from "../src/lib/routes/trails.ts";
import { findClubPoi, isUsableWaypoint, type ClubPoi } from "../src/lib/routes/poi.ts";


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

const [place, ...names] = process.argv.slice(2);
if (!place || names.length < 2) throw new Error("사용법: <산이름> <경유지...>");

// The map biases to the place it is centred on; 북한산 is close enough for this.
const centre = { latitude: 37.64, longitude: 126.98 };

async function search(textQuery: string, asked: string) {
  const response = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-Goog-Api-Key": mapsKey,
      // The browser key is referrer-restricted; this is that same site.
      referer: "https://khuac.com/",
      "X-Goog-FieldMask": "places.displayName,places.location,places.types",
    },
    body: JSON.stringify({
      textQuery, languageCode: "ko", regionCode: "KR", maxResultCount: 5,
      locationBias: { circle: { center: centre, radius: 20000 } },
    }),
  });
  const body = await response.json() as {
    places?: { displayName: { text: string }; location: { latitude: number; longitude: number }; types: string[] }[];
  };
  return (body.places ?? []).find((p) =>
    isUsableWaypoint(asked, p.displayName.text, p.types ?? [], place));
}

const clubPois: ClubPoi[] = await (async () => {
  const response = await fetch(`${supabaseUrl}/rest/v1/route_pois?select=name,aliases,lat,lng`, { headers });
  return response.ok ? await response.json() as ClubPoi[] : [];
})();

const resolved: { name: string; lat: number; lng: number; as: string }[] = [];
for (const name of names) {
  // A raw "lat,lng" stands in for a name, so a leg can be probed between two
  // points that no gazetteer or search would return.
  const literal = name.match(/^(-?\d+\.\d+),(-?\d+\.\d+)$/);
  if (literal) {
    resolved.push({ name, lat: Number(literal[1]), lng: Number(literal[2]), as: "좌표" });
    console.log(`${name} → 좌표 직접 지정`);
    continue;
  }
  // The club's own gazetteer first, exactly as the browser does.
  const known = findClubPoi(name, clubPois);
  if (known) {
    resolved.push({ name, lat: known.lat, lng: known.lng, as: `${known.name} (동아리 등록)` });
    console.log(`${name} → ${known.name} (동아리 등록) · ${known.lat.toFixed(5)},${known.lng.toFixed(5)}`);
    continue;
  }
  let best = await search(`${place} ${name}`.trim(), name);
  if (!best) best = await search(name, name);
  if (!best) {
    console.log(`${name} → 찾지 못함 (생략)`);
    continue;
  }
  resolved.push({ name, lat: best.location.latitude, lng: best.location.longitude, as: best.displayName.text });
  console.log(`${name} → ${best.displayName.text} · ${best.location.latitude.toFixed(5)},${best.location.longitude.toFixed(5)}`);
}

const kept = dropOutlierWaypoints(resolved);
if (kept.length !== resolved.length) {
  const dropped = resolved.filter((p) => !kept.includes(p)).map((p) => p.name);
  console.log(`\n너무 멀어 제외된 경유지: ${dropped.join(", ")}`);
}
if (kept.length < 2) throw new Error("경유지가 2개 미만입니다.");

const lats = kept.map((p) => p.lat);
const lngs = kept.map((p) => p.lng);
const bounds = {
  south: Math.min(...lats) - 0.02, west: Math.min(...lngs) - 0.02,
  north: Math.max(...lats) + 0.02, east: Math.max(...lngs) + 0.02,
};
console.log(`\n영역 ${(bounds.north - bounds.south).toFixed(3)}° x ${(bounds.east - bounds.west).toFixed(3)}°`);

async function rows(table: string, keys: string[]): Promise<TrailSegment[][]> {
  const list = keys.map((key) => `"${key}"`).join(",");
  const response = await fetch(
    `${supabaseUrl}/rest/v1/${table}?select=segments&tile_key=in.(${encodeURIComponent(list)})`,
    { headers },
  );
  if (!response.ok) throw new Error(`${table}: ${response.status}`);
  return ((await response.json()) as { segments: TrailSegment[] }[]).map((row) => row.segments ?? []);
}

const keys = tilesForBounds(bounds);
const loadStarted = performance.now();
const [osm, official] = await Promise.all([rows("trail_tiles", keys), rows("official_trails", keys)]);
const segments = mergeTileSegments([
  mergeTileSegments(osm),
  splitSurveyGaps(mergeTileSegments(official)),
]);
console.log(`타일 ${keys.length}개 · 등산로 ${segments.length}개 · ${Math.round(performance.now() - loadStarted)}ms`);

const diagnostics: SnapDiagnostics = { snapDistances: [], legs: [] };
const snapStarted = performance.now();
const legs = snapRouteToTrails(kept, segments, diagnostics);
console.log(`스냅 ${Math.round(performance.now() - snapStarted)}ms · 경유지별 거리 ${diagnostics.snapDistances.join("/")}m\n`);

legs.forEach((leg, i) => {
  const from = kept[i].name;
  const to = kept[i + 1].name;
  const detail = diagnostics.legs[i];
  if (!leg.onTrail) {
    console.log(`${from} → ${to}: 경로 없음 · 직선 ${((detail?.straightM ?? 0) / 1000).toFixed(2)}km`);
    return;
  }
  console.log(`${from} → ${to}: ${leg.points.length}점 · ${((detail?.routedM ?? 0) / 1000).toFixed(2)}km (직선 ${((detail?.straightM ?? 0) / 1000).toFixed(2)}km)`);
  // Quarter points, so the shape of the leg can be checked against the ground.
  const marks = [0.25, 0.5, 0.75].map((f) => leg.points[Math.floor(leg.points.length * f)]);
  console.log(`    경유: ${marks.map(([la, ln]) => `${la.toFixed(5)},${ln.toFixed(5)}`).join("  ")}`);
});
