/**
 * 올라온 사진의 EXIF 좌표를 읽어 두 가지를 한 번에 본다.
 *
 *   node scripts/check-photo-gps.mts                 최근 올라온 앨범
 *   node scripts/check-photo-gps.mts 인수봉           제목/장소에 이 말이 든 앨범
 *
 * 1) 핀 접기 반경을 30m / 60m / 줌기준으로 바꿔가며 핀이 몇 개가 되는지.
 *    고정 미터는 앨범마다 답이 갈린다 — 숨은벽 코스를 폰에서 열면 핀 하나가
 *    땅 598m 를 덮고, 인수봉 등반 앨범을 PC 에서 열면 30m 를 덮는다. 그래서
 *    화면 픽셀 기준(핀 하나 폭)도 같이 계산해 비교한다.
 *
 * 2) 좌표가 없는 지점(비둘기샘 · 인수봉 고독길 들머리 등)을 사진으로 특정하기.
 *    두 코스가 그 이름을 경유지로 들고 있는데 좌표가 없어서 폴리라인이 거기까지
 *    그려지지 않는다. 같은 자리에서 찍은 사진이 여럿이면 중앙값을 쓴다 — 산에서
 *    폰 GPS 는 ±10~30m 로 흔들리고, 중앙값은 튀는 한 장에 끌려가지 않는다.
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

const R = 6_371_000;
const rad = (d: number) => (d * Math.PI) / 180;
function metres(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng) * Math.cos(rad((a.lat + b.lat) / 2));
  return Math.hypot(dLat, dLng) * R;
}

interface Photo {
  id: string; taken_at: string | null;
  exif_lat: number | null; exif_lng: number | null;
  hike: { id: string; title: string; date: string; track: [number, number][] | null } | null;
}

const filter = process.argv[2];
const photos = await get<Photo[]>(
  "photos?select=id,taken_at,exif_lat,exif_lng,hike:hikes!hike_id(id,title,date,track)" +
    "&exif_lat=not.is.null&order=taken_at.asc",
);

const albums = new Map<string, { title: string; date: string; track: [number, number][] | null; photos: Photo[] }>();
for (const photo of photos) {
  if (!photo.hike) continue;
  if (filter && !photo.hike.title.includes(filter)) continue;
  const entry = albums.get(photo.hike.id) ?? {
    title: photo.hike.title, date: photo.hike.date, track: photo.hike.track, photos: [],
  };
  entry.photos.push(photo);
  albums.set(photo.hike.id, entry);
}

if (albums.size === 0) {
  console.log(
    filter
      ? `'${filter}' 이 든 앨범에 위치정보 있는 사진이 없습니다.`
      : "위치정보(EXIF GPS) 가 있는 사진이 아직 없습니다.",
  );
  process.exit(0);
}

/** 가까운 것부터 묶는 단일연결 클러스터링. 반경 안에 들어오면 같은 핀. */
function cluster(points: { lat: number; lng: number; photo: Photo }[], radius: number) {
  const groups: (typeof points)[] = [];
  for (const point of points) {
    const near = groups.find((g) => g.some((member) => metres(member, point) <= radius));
    if (near) near.push(point);
    else groups.push([point]);
  }
  return groups;
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

// 44px 핀 + 여백. 화면에서 이만큼보다 가까우면 어차피 겹쳐 보인다.
const PIN_PIXELS = 48;
const PANES: [string, number, number][] = [
  ["폰 세로", 390, 520],
  ["PC 분할", 760, 820],
  ["PC 전체", 1400, 820],
];

for (const album of albums.values()) {
  const points = album.photos
    .filter((p) => p.exif_lat != null && p.exif_lng != null)
    .map((p) => ({ lat: p.exif_lat as number, lng: p.exif_lng as number, photo: p }));

  console.log(`\n━━ ${album.date}  ${album.title}`);
  console.log(`   위치정보 있는 사진 ${points.length}장`);

  // 지도가 어느 줌으로 열리는지. track 이 있으면 그것이, 없으면 사진들이 기준.
  const frame = album.track?.length ? album.track.map(([lat, lng]) => ({ lat, lng })) : points;
  const lats = frame.map((p) => p.lat), lngs = frame.map((p) => p.lng);
  const midLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const spanH = rad(Math.max(...lats) - Math.min(...lats)) * R;
  const spanW = rad(Math.max(...lngs) - Math.min(...lngs)) * R * Math.cos(rad(midLat));
  console.log(`   지도가 담는 범위 ${(spanW / 1000).toFixed(2)}km × ${(spanH / 1000).toFixed(2)}km` +
    (album.track?.length ? "  (track 기준)" : "  (사진 기준)"));

  console.log("\n   접기 반경별 핀 개수");
  console.log(`     지금 (좌표 완전일치)   ${new Set(points.map((p) => `${p.lat},${p.lng}`)).size}개`);
  for (const radius of [30, 60, 100]) {
    console.log(`     ${String(radius).padStart(3)}m 고정            ${String(cluster(points, radius).length).padStart(3)}개`);
  }
  for (const [name, pw, ph] of PANES) {
    const mpp = Math.max(spanW / (pw - 128), spanH / (ph - 128));
    const radius = PIN_PIXELS * mpp;
    const groups = cluster(points, radius);
    console.log(
      `     줌기준 · ${name.padEnd(7)}  ${String(groups.length).padStart(3)}개` +
        `   (그 화면에서는 ${radius < 100 ? radius.toFixed(0) : Math.round(radius / 10) * 10}m 에 해당)`,
    );
  }

  // 같은 자리에서 여러 장 찍힌 곳 — 지점을 특정하기 좋은 후보.
  const spots = cluster(points, 40).filter((g) => g.length >= 2).sort((a, b) => b.length - a.length);
  if (spots.length) {
    console.log("\n   여러 장이 겹친 지점 (이름 붙이기 좋은 후보)");
    for (const spot of spots.slice(0, 10)) {
      const lat = median(spot.map((p) => p.lat)), lng = median(spot.map((p) => p.lng));
      const spread = Math.max(...spot.map((p) => metres({ lat, lng }, p)));
      const times = spot.map((p) => p.photo.taken_at).filter(Boolean).sort();
      const clock = (t: string | null | undefined) =>
        t ? new Date(t).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }) : "??:??";
      console.log(
        `     ${lat.toFixed(6)}, ${lng.toFixed(6)}   ${String(spot.length).padStart(2)}장` +
          `  흩어짐 ±${spread.toFixed(0)}m   ${clock(times[0])}~${clock(times[times.length - 1])}`,
      );
    }
  }

  console.log("\n   시간순 전체 (촬영시각 · 좌표 · 직전 사진과의 거리)");
  let previous: { lat: number; lng: number } | null = null;
  for (const point of points) {
    const step = previous ? `${metres(previous, point).toFixed(0).padStart(5)}m` : "    –";
    const time = point.photo.taken_at
      ? new Date(point.photo.taken_at).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })
      : "??:??";
    console.log(`     ${time}  ${point.lat.toFixed(6)}, ${point.lng.toFixed(6)}  ${step}`);
    previous = point;
  }
}
