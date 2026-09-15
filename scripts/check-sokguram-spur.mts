/**
 * Do people walking 우이령길 actually go up to 석굴암?
 *
 *   node scripts/check-sokguram-spur.mts
 *
 * The course names 석굴암입구 - the turning, which is on the road - and Places
 * answers with 석굴암, the temple, which is not. The line then climbs to the
 * temple and comes back down, and that is the spur showing beside the route.
 *
 * Whether that is wrong depends on a fact about the ground rather than about
 * our code: if everyone who walks 우이령길 goes up to the temple, the detour is
 * the course. OSM's public GPS traces are people who walked it with a recorder
 * running, so they can be asked.
 *
 * This decides nothing on its own. It says how often the side trip happens.
 */
import { readFileSync } from "node:fs";
import { haversineDistanceMeters } from "../src/lib/gps/haversine.ts";
import type { TrackPoint } from "../src/lib/gps/track.ts";

function env(name: string): string {
  const match = readFileSync(".env.local", "utf8").match(new RegExp(`^${name}=(.*)$`, "m"));
  const value = match?.[1]?.trim().replace(/^["']|["']$/g, "");
  if (!value) throw new Error(`${name} is not set in .env.local`);
  return value;
}
const mapsKey = env("NEXT_PUBLIC_GOOGLE_MAPS_API_KEY");

async function place(textQuery: string) {
  const response = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "content-type": "application/json", "X-Goog-Api-Key": mapsKey, referer: "https://khuac.com/",
      "X-Goog-FieldMask": "places.displayName,places.location",
    },
    body: JSON.stringify({
      textQuery, languageCode: "ko", regionCode: "KR", maxResultCount: 1,
      locationBias: { circle: { center: { latitude: 37.68, longitude: 126.99 }, radius: 15000 } },
    }),
  });
  const body = await response.json() as { places?: { displayName: { text: string }; location: { latitude: number; longitude: number } }[] };
  const found = body.places?.[0];
  if (!found) throw new Error(`찾지 못함: ${textQuery}`);
  return { name: found.displayName.text, lat: found.location.latitude, lng: found.location.longitude };
}

const temple = await place("북한산 석굴암입구");
const west = await place("북한산국립공원 교현탐방지원센터");
const east = await place("북한산국립공원 우이령탐방지원센터");
for (const [label, p] of [["석굴암입구가 잡힌 곳", temple], ["서쪽 끝", west], ["동쪽 끝", east]] as const) {
  console.log(`${label}: ${p.name} (${p.lat.toFixed(5)}, ${p.lng.toFixed(5)})`);
}

const ENDPOINT = "https://api.openstreetmap.org/api/0.6/trackpoints";
const box = {
  south: Math.min(temple.lat, west.lat, east.lat) - 0.006,
  north: Math.max(temple.lat, west.lat, east.lat) + 0.006,
  west: Math.min(temple.lng, west.lng, east.lng) - 0.006,
  east: Math.max(temple.lng, west.lng, east.lng) + 0.006,
};
console.log(`\n트랙을 받는 중 (${box.south.toFixed(3)},${box.west.toFixed(3)} ~ ${box.north.toFixed(3)},${box.east.toFixed(3)})`);

const tracks: TrackPoint[][] = [];
for (let page = 0; page < 20; page++) {
  const url = `${ENDPOINT}?bbox=${box.west},${box.south},${box.east},${box.north}&page=${page}`;
  const response = await fetch(url, {
    headers: { "user-agent": "khuac.com hiking album (contact: https://khuac.com)" },
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const gpx = await response.text();
  let points = 0;
  for (const [, body] of gpx.matchAll(/<trkseg>([\s\S]*?)<\/trkseg>/g)) {
    const track: TrackPoint[] = [];
    for (const match of body.matchAll(/lat="(-?[\d.]+)"\s+lon="(-?[\d.]+)"/g)) {
      track.push([Number(match[1]), Number(match[2])]);
    }
    points += track.length;
    if (track.length >= 20) tracks.push(track);
  }
  process.stdout.write(`  ${page + 1}쪽 · 좌표 ${points}개 · 누적 트랙 ${tracks.length}개\n`);
  if (points < 5000) break;
  await new Promise((r) => setTimeout(r, 1000));
}

const metresTo = (point: TrackPoint, spot: { lat: number; lng: number }) =>
  haversineDistanceMeters({ lat: point[0], lng: point[1] }, spot);

// Counted as points rather than as walks. Most of what the archive holds here
// is anonymised, and an anonymised trace arrives as an unordered pool with no
// timestamps - you cannot tell one person's walk from another's, so "how many
// people went to the temple" is not answerable from it. Where the points are
// still is: a side trip people take leaves points on the side trip.
const all = tracks.flat();
console.log(`
좌표 ${all.length.toLocaleString()}개로 봅니다.`);

const closest = Math.min(...all.map((point) => metresTo(point, temple)));
console.log(`누가 걸은 자리 중 석굴암에서 가장 가까운 점: ${Math.round(closest)}m`);

for (const radius of [30, 60, 120]) {
  const atTemple = all.filter((point) => metresTo(point, temple) <= radius).length;
  console.log(`  석굴암 ${String(radius).padStart(3)}m 안: ${atTemple.toLocaleString()}개`);
}

// A yardstick: the same radius around the two ends of the road, which everyone
// walking it must pass through. Without one, a count of points means nothing.
for (const [label, spot] of [["교현(서쪽 끝)", west], ["우이(동쪽 끝)", east]] as const) {
  const n = all.filter((point) => metresTo(point, spot) <= 60).length;
  console.log(`  ${label} 60m 안: ${n.toLocaleString()}개`);
}

// And the turning itself: the nearest walked point to the temple, which is
// where the side trail leaves the road if there is one.
const nearestPoint = all.reduce((best, point) =>
  metresTo(point, temple) < metresTo(best, temple) ? point : best, all[0]);
console.log(`
석굴암에 가장 가까운 walked 지점: ${nearestPoint[0].toFixed(5)}, ${nearestPoint[1].toFixed(5)}`);
console.log(`  그 지점에서 교현까지 ${Math.round(metresTo(nearestPoint, west))}m · 우이까지 ${Math.round(metresTo(nearestPoint, east))}m`);
