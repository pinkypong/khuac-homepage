/**
 * 첫 공개 전 실측. 추측하지 않고 지금 DB에 들어 있는 것으로 센다.
 *
 *   node scripts/check-launch-readiness.mts
 *
 * 보는 것:
 *  - /map 이 한 번에 내려보내는 본문 크기 (page.tsx 의 쿼리를 그대로 친다)
 *  - 앨범 하나를 열었을 때 지도에 실제로 꽂히는 사진 핀 개수
 *    → groupPhotosByPosition 은 좌표가 "완전히 같을 때만" 접는다. 폰 GPS 는
 *      한 장씩 다른 좌표를 주므로, 접히는 양이 거의 없으면 핀은 사진 수만큼 생긴다.
 *  - 부원이 열었을 때 아무것도 안 보이는 구멍들 (앨범 없는 장소, 앨범에 안 붙은 사진 등)
 */
import { readFileSync } from "node:fs";

function env(name: string): string {
  const match = readFileSync(".env.local", "utf8").match(new RegExp(`^${name}=(.*)$`, "m"));
  const value = match?.[1]?.trim().replace(/^["']|["']$/g, "");
  if (!value) throw new Error(`${name} is not set in .env.local`);
  return value;
}
const supabaseUrl = env("NEXT_PUBLIC_SUPABASE_URL");
const key = env("SUPABASE_SERVICE_ROLE_KEY");
const headers = { apikey: key, authorization: `Bearer ${key}` };

async function get<T>(path: string): Promise<T> {
  const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, { headers });
  if (!response.ok) throw new Error(`${path}: ${response.status} ${await response.text()}`);
  return (await response.json()) as T;
}

// page.tsx 가 실제로 치는 쿼리. 한 글자라도 다르면 크기 측정이 의미가 없다.
const select =
  "id, name, type, region, elevation, lat, lng, created_at, " +
  "hikes(id, title, date, description, activity_type, lat, lng, track, route_waypoints, course_info, course_id, " +
  "photos(id, storage_key_original, taken_at, exif_lat, exif_lng, uploader_id))";

interface Photo {
  id: string; storage_key_original: string; taken_at: string | null;
  exif_lat: number | null; exif_lng: number | null; uploader_id: string | null;
}
interface Hike {
  id: string; title: string; date: string; activity_type: string;
  track: unknown[] | null; photos: Photo[];
}
interface Location {
  id: string; name: string; type: string; region: string | null;
  lat: number; lng: number; hikes: Hike[];
}

const rows = await get<Location[]>(
  `locations?select=${encodeURIComponent(select)}&lat=not.is.null&lng=not.is.null&order=name`,
);

const bytes = new TextEncoder().encode(JSON.stringify(rows)).length;
const hikes = rows.flatMap((r) => r.hikes ?? []);
const photos = hikes.flatMap((h) => h.photos ?? []);
const geotagged = photos.filter((p) => p.exif_lat != null && p.exif_lng != null);

console.log("── /map 첫 로드 ──────────────────────────────");
console.log(`장소 ${rows.length}개 · 앨범 ${hikes.length}개 · 사진 ${photos.length}장`);
console.log(`한 번에 내려가는 본문  ${(bytes / 1024).toFixed(1)}KB`);
console.log(`사진 1장이 차지하는 몫  ${photos.length ? (bytes / photos.length / 1024).toFixed(2) : "–"}KB`);
console.log(`위치정보(EXIF) 있는 사진  ${geotagged.length}/${photos.length}장`);

console.log("\n── 앨범을 열면 지도에 꽂히는 핀 ────────────────");
console.log("(핀 하나 = 썸네일 이미지 요청 하나. collision REQUIRED 라 겹쳐도 안 숨는다)");
const byPins = hikes
  .map((h) => {
    const tagged = (h.photos ?? []).filter((p) => p.exif_lat != null && p.exif_lng != null);
    const distinct = new Set(tagged.map((p) => `${p.exif_lat},${p.exif_lng}`)).size;
    return { title: h.title, date: h.date, total: (h.photos ?? []).length, tagged, distinct };
  })
  .filter((h) => h.total > 0)
  .sort((a, b) => b.distinct - a.distinct);

for (const h of byPins.slice(0, 8)) {
  const folded = h.tagged.length - h.distinct;
  console.log(
    `  ${h.date}  ${h.title.slice(0, 22).padEnd(22)} 사진 ${String(h.total).padStart(3)}장 ` +
      `→ 핀 ${String(h.distinct).padStart(3)}개` +
      (folded > 0 ? `  (겹쳐 접힌 것 ${folded}장)` : "  (접힌 것 없음)"),
  );
}

// 400px WebP 썸네일 하나가 대략 40KB. 핀은 lazy 가 아니라 전부 즉시 받는다.
const worst = byPins[0];
if (worst) {
  console.log(
    `\n  가장 무거운 앨범: 핀 ${worst.distinct}개 × 썸네일 약 40KB ≈ ` +
      `${((worst.distinct * 40) / 1024).toFixed(1)}MB 를 한꺼번에 받는다`,
  );
}

console.log("\n── 부원이 열었을 때 비어 보이는 곳 ──────────────");
const emptyLocations = rows.filter((r) => (r.hikes ?? []).length === 0);
const emptyHikes = hikes.filter((h) => (h.photos ?? []).length === 0);
const noTrack = hikes.filter((h) => !h.track);
console.log(`앨범이 하나도 없는 장소  ${emptyLocations.length}개` +
  (emptyLocations.length ? `  (${emptyLocations.slice(0, 6).map((l) => l.name).join(", ")}${emptyLocations.length > 6 ? " …" : ""})` : ""));
console.log(`사진이 하나도 없는 앨범  ${emptyHikes.length}개`);
console.log(`경로(선)가 없는 앨범    ${noTrack.length}/${hikes.length}개`);

const orphans = await get<{ id: string }[]>("photos?select=id&hike_id=is.null");
console.log(`앨범에 안 붙은 사진      ${orphans.length}장  (어느 화면에도 안 보인다)`);

const members = await get<{ role: string }[]>("members?select=role");
const byRole = members.reduce<Record<string, number>>((acc, m) => {
  acc[m.role] = (acc[m.role] ?? 0) + 1;
  return acc;
}, {});
console.log(`\n부원  ${members.length}명 ` +
  Object.entries(byRole).map(([role, n]) => `· ${role} ${n}`).join(" "));

const uploaders = new Set(photos.map((p) => p.uploader_id).filter(Boolean));
console.log(`사진을 올려본 사람  ${uploaders.size}명`);
