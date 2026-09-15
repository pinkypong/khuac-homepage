/**
 * Gives an album made from a course the line it was made from.
 *
 *   node scripts/backfill-album-tracks.mts [--dry-run]
 *
 * Albums built from a suggested course kept the waypoints as a sentence in
 * their description and nothing else, because when that was written the line
 * between them was a straight join and had no business in the column the map
 * draws as "the route". It is mapped trail geometry now and is saved with new
 * albums, but the ones already made opened as a bare pin.
 *
 * An album that kept its waypoints already holds the points themselves, and
 * those are used as they stand - they are what the member saw drawn, they cost
 * nothing to read, and looking the same names up again would spend a billed
 * Places request to arrive somewhere slightly different. Older albums have only
 * the sentence, "AI 추천 코스: A → B → C", and those names are looked up.
 *
 * Either way the line is rebuilt by the same snapping the map does. An album
 * whose course cannot be drawn end to end is left alone rather than given half
 * of one.
 */
import { readFileSync } from "node:fs";
import { snapRouteToTrails, dropOutlierWaypoints } from "../src/lib/routes/snap.ts";
import { mergeTileSegments, tilesForBounds } from "../src/lib/routes/tiles.ts";
import { splitSurveyGaps, type TrailSegment } from "../src/lib/routes/trails.ts";
import { findClubPoi, isUsableWaypoint, SAME_PLACE_M, type ClubPoi } from "../src/lib/routes/poi.ts";
import { haversineDistanceMeters } from "../src/lib/gps/haversine.ts";


function env(name: string): string {
  const match = readFileSync(".env.local", "utf8").match(new RegExp(`^${name}=(.*)$`, "m"));
  const value = match?.[1]?.trim().replace(/^["']|["']$/g, "");
  if (!value) throw new Error(`${name} is not set in .env.local`);
  return value;
}

const url = env("NEXT_PUBLIC_SUPABASE_URL");
const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
const mapsKey = env("NEXT_PUBLIC_GOOGLE_MAPS_API_KEY");
const headers = { apikey: serviceKey, authorization: `Bearer ${serviceKey}` };
const dryRun = process.argv.includes("--dry-run");

const clubPois: ClubPoi[] = await (async () => {
  const response = await fetch(`${url}/rest/v1/route_pois?select=name,aliases,lat,lng`, { headers });
  return response.ok ? await response.json() as ClubPoi[] : [];
})();

async function search(textQuery: string, asked: string, place: string, centre: { lat: number; lng: number }) {
  const response = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-Goog-Api-Key": mapsKey,
      referer: "https://khuac.com/",
      "X-Goog-FieldMask": "places.displayName,places.location,places.types",
    },
    body: JSON.stringify({
      textQuery, languageCode: "ko", regionCode: "KR", maxResultCount: 5,
      locationBias: { circle: { center: { latitude: centre.lat, longitude: centre.lng }, radius: 20000 } },
    }),
  });
  const body = await response.json() as {
    places?: { displayName: { text: string }; location: { latitude: number; longitude: number }; types: string[] }[];
  };
  return (body.places ?? []).find((p) =>
    isUsableWaypoint(asked, p.displayName.text, p.types ?? [], place));
}

interface HikeRow {
  id: string;
  title: string;
  description: string | null;
  track: unknown;
  route_waypoints: unknown;
  locations: { name: string; lat: number; lng: number } | null;
}

const hikes = await (async () => {
  const response = await fetch(
    `${url}/rest/v1/hikes?select=id,title,description,track,route_waypoints,locations(name,lat,lng)`
    + `&or=(track.is.null,route_waypoints.is.null)`,
    { headers },
  );
  if (!response.ok) throw new Error(`hikes: ${response.status}`);
  return await response.json() as HikeRow[];
})();
console.log(`경로 없는 앨범 ${hikes.length}개`);

async function segmentsFor(points: { lat: number; lng: number }[]): Promise<TrailSegment[]> {
  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  const bounds = {
    south: Math.min(...lats) - 0.02, west: Math.min(...lngs) - 0.02,
    north: Math.max(...lats) + 0.02, east: Math.max(...lngs) + 0.02,
  };
  const keys = tilesForBounds(bounds);
  const list = keys.map((key) => `"${key}"`).join(",");
  const [osm, official] = await Promise.all(["trail_tiles", "official_trails"].map(async (table) => {
    const response = await fetch(
      `${url}/rest/v1/${table}?select=segments&tile_key=in.(${encodeURIComponent(list)})`,
      { headers },
    );
    if (!response.ok) throw new Error(`${table}: ${response.status}`);
    return ((await response.json()) as { segments: TrailSegment[] }[]).map((row) => row.segments ?? []);
  }));
  return mergeTileSegments([mergeTileSegments(osm), splitSurveyGaps(mergeTileSegments(official))]);
}

for (const hike of hikes) {
  const place = hike.locations?.name ?? "";
  const centre = hike.locations ?? { lat: 37.5, lng: 127.0 };

  // The points the album already holds, where it holds them. These are what
  // the member saw drawn; looking the same names up again would cost a billed
  // request each and could land somewhere slightly different.
  const stored = Array.isArray(hike.route_waypoints)
    ? hike.route_waypoints.filter((point) =>
      typeof point?.lat === "number" && typeof point?.lng === "number" && typeof point?.name === "string")
    : [];

  let found: { name: string; lat: number; lng: number }[] = stored;
  if (found.length < 2) {
    const course = hike.description?.match(/AI 추천 코스:\s*(.+)/)?.[1];
    if (!course) {
      console.log(`${hike.title}: 경유지도 코스 설명도 없어 건너뜁니다`);
      continue;
    }
    const names = course.split("→").map((name) => name.trim()).filter(Boolean);
    found = [];
    for (const name of names) {
      const known = findClubPoi(name, clubPois);
      if (known) {
        found.push({ name, lat: known.lat, lng: known.lng });
        continue;
      }
      let best = await search(`${place} ${name}`, name, place, centre);
      if (!best) best = await search(name, name, place, centre);
      if (best) found.push({ name, lat: best.location.latitude, lng: best.location.longitude });
    }
  }

  const collapsed = found.filter((point, i) =>
    i === 0 || haversineDistanceMeters(found[i - 1], point) > SAME_PLACE_M);
  const kept = dropOutlierWaypoints(collapsed);
  if (kept.length < 2) {
    console.log(`${hike.title}: 경유지를 2개 이상 찾지 못했습니다`);
    continue;
  }

  const legs = snapRouteToTrails(kept, await segmentsFor(kept));
  // The same rule the map uses when it saves one: a course with an unmapped
  // leg saves nothing, because half a route in this column reads as all of it.
  if (legs.length === 0 || legs.some((leg) => !leg.onTrail)) {
    const gaps = legs.flatMap((leg, i) => leg.onTrail ? [] : [`${kept[i].name}→${kept[i + 1].name}`]);
    console.log(`${hike.title}: 못 그린 구간이 있어 건너뜁니다 (${gaps.join(", ")})`);
    continue;
  }
  const track = legs.flatMap((leg) => leg.points);
  console.log(`${hike.title}: ${track.length}점 · 경유지 ${kept.map((p) => p.name).join(" → ")}`);
  if (dryRun) continue;

  const write = await fetch(`${url}/rest/v1/hikes?id=eq.${hike.id}`, {
    method: "PATCH",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({
      track,
      // Stored with the line, so each name can be drawn where it is rather
      // than listed on the pin the line starts at.
      route_waypoints: kept.map((p) => ({ name: p.name, lat: p.lat, lng: p.lng })),
    }),
  });
  if (!write.ok) throw new Error(`${hike.title} 저장 실패 (${write.status}): ${(await write.text()).slice(0, 200)}`);
}
console.log(dryRun ? "시험 모드이므로 저장하지 않았습니다." : "완료");
