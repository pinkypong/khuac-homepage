/**
 * Where does a published course length start measuring from?
 *
 *   node scripts/check-course-endpoints.mts
 *
 * 우이령길 is published at 6.8km and our line measures 4.25km flat, 4.37km with
 * the hill added. Elevation is not the difference. The other candidate is that
 * the two are not measuring between the same two points: a 탐방지원센터 is a gate
 * partway in, and a published length usually runs from where a walker actually
 * starts, which is the bus.
 */
import { readFileSync } from "node:fs";
import { haversineDistanceMeters } from "../src/lib/gps/haversine.ts";

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
      locationBias: { circle: { center: { latitude: 37.685, longitude: 126.995 }, radius: 20000 } },
    }),
  });
  const body = await response.json() as { places?: { displayName: { text: string }; location: { latitude: number; longitude: number } }[] };
  const found = body.places?.[0];
  if (!found) throw new Error(`찾지 못함: ${textQuery}`);
  return { name: found.displayName.text, lat: found.location.latitude, lng: found.location.longitude };
}

const 교현게이트 = await place("북한산국립공원 교현탐방지원센터");
const 교현버스 = await place("우이령 오봉산석굴암입구 정류장");
const 우이게이트 = await place("북한산국립공원 우이령탐방지원센터");
const 우이입구 = await place("북한산둘레길 21구간 우이령길 입구");

for (const [label, p] of [
  ["교현 게이트", 교현게이트], ["교현 쪽 버스", 교현버스],
  ["우이 게이트", 우이게이트], ["우이 쪽 입구", 우이입구],
] as const) {
  console.log(`${label.padEnd(12)} ${p.name} (${p.lat.toFixed(5)}, ${p.lng.toFixed(5)})`);
}

const west = haversineDistanceMeters(교현버스, 교현게이트);
const east = haversineDistanceMeters(우이게이트, 우이입구);
console.log(`\n교현 버스 → 게이트: ${Math.round(west)}m (직선)`);
console.log(`우이 게이트 → 입구: ${Math.round(east)}m (직선)`);
console.log(`\n우리가 재는 구간(게이트~게이트) 표면거리: 4.37km`);
console.log(`양끝 접근로를 더하면 최소: ${((4370 + west + east) / 1000).toFixed(2)}km`);
console.log(`공식: 6.80km`);
