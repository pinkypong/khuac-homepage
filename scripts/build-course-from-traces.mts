/**
 * Confirms a whole course from the trailhead outward, one waypoint at a time.
 *
 *   node scripts/build-course-from-traces.mts 북한산 밤골탐방지원센터 해골바위 숨은벽능선 백운봉암문 백운대 하루재 "백운대탐방지원센터(도선사)"
 *
 * Filling one stretch at a time by hand needs somebody to know which two points
 * a trail actually runs between, and that is exactly what was got wrong on
 * 밤골: asked for a line from 밤골탐방지원센터 to 숨은벽능선, the archive said
 * no such walk exists, which was true. The walk that does exist goes to
 * 백운봉암문, one waypoint further along the same course, and nobody thought to
 * ask for it until two tracks were measured touching at 0m.
 *
 * So the pairs are not chosen by hand. The waypoints are put in walking order -
 * outward from the trailhead - and each stretch is confirmed in turn. When a
 * stretch has no walk of its own, the next waypoint is added to it and the
 * longer stretch is tried, which is how a trail that skips a named point is
 * still found.
 *
 * Everything else is the same question the single-gap tool asks, from the same
 * module: one person's line, and the others only saying whether they went the
 * same way.
 */
import { readFileSync } from "node:fs";
import { groupSegmentsByTile } from "../src/lib/routes/tiles.ts";
import { findClubPoi, isPlausibleMatch, type ClubPoi } from "../src/lib/routes/poi.ts";
import { dropOutlierWaypoints } from "../src/lib/routes/snap.ts";
import type { TrailSegment } from "../src/lib/routes/trails.ts";
import type { TrackPoint } from "../src/lib/gps/track.ts";
import { chooseLine, fetchTracks, lengthOf, metres, type Box } from "./trace-lines.mts";

/** Kept in step with src/app/map/suggested-route.tsx. */
const NOT_A_WAYPOINT = new Set([
  "subway_station", "train_station", "light_rail_station", "transit_station",
  "transit_depot", "bus_station", "bus_stop", "airport", "transportation_service",
]);
const ASKING_FOR_TRANSIT = /역$|역\s|버스\s*종점|정류장|터미널|station/i;
const STATION_NAME = /역$|역\s/;
const SAME_PLACE_M = 60;

/** How near a track has to pass a waypoint to be talking about that stretch. */
const END_TOLERANCE_M = 120;
/** A stretch far longer than its straight line is somebody's whole day out. */
const MAX_DETOUR_RATIO = 3;
/** Negative, so it can never collide with an OSM way id. */
const ID_BASE = -3_000_000;

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

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const force = args.includes("--force");
const [place, ...names] = args.filter((a) => !a.startsWith("--"));
if (!place || names.length < 2) {
  throw new Error("사용법: <산이름> <경유지...> [--dry-run] [--force]");
}

const clubPois: ClubPoi[] = await (async () => {
  const response = await fetch(`${supabaseUrl}/rest/v1/route_pois?select=name,aliases,lat,lng`, { headers });
  return response.ok ? await response.json() as ClubPoi[] : [];
})();

async function search(textQuery: string, asked: string, centre: TrackPoint) {
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
      locationBias: { circle: { center: { latitude: centre[0], longitude: centre[1] }, radius: 20000 } },
    }),
  });
  const body = await response.json() as {
    places?: { displayName: { text: string }; location: { latitude: number; longitude: number }; types: string[] }[];
  };
  const transitWanted = ASKING_FOR_TRANSIT.test(asked);
  const mustBeStation = STATION_NAME.test(asked);
  return (body.places ?? []).find((p) =>
    (transitWanted || !(p.types ?? []).some((t) => NOT_A_WAYPOINT.has(t)))
    && (!mustBeStation || (p.types ?? []).some((t) => NOT_A_WAYPOINT.has(t)))
    && isPlausibleMatch(asked, p.displayName.text, place));
}

// The mountain itself, to bias the first lookups toward; replaced by the
// course's own middle as soon as anything has been placed.
let centre: TrackPoint = await (async () => {
  const found = await search(place, place, [37.5, 127.0]);
  return found ? [found.location.latitude, found.location.longitude] : [37.5, 127.0];
})();

interface Placed { asked: string; found: string; point: TrackPoint }
const placed: Placed[] = [];
const missing: string[] = [];
for (const name of names) {
  const known = findClubPoi(name, clubPois);
  if (known) {
    placed.push({ asked: name, found: `${known.name} (동아리 등록)`, point: [known.lat, known.lng] });
    continue;
  }
  let best = await search(`${place} ${name}`, name, centre);
  if (!best) best = await search(name, name, centre);
  if (!best) {
    missing.push(name);
    continue;
  }
  placed.push({ asked: name, found: best.displayName.text, point: [best.location.latitude, best.location.longitude] });
  if (placed.length === 1) centre = placed[0].point;
}
if (missing.length) console.log(`찾지 못한 경유지: ${missing.join(", ")}`);
if (placed.length < 2) throw new Error("경유지가 2개 미만입니다.");

/**
 * Walking order: out from the trailhead.
 *
 * The order an answer lists waypoints in is usually the order they are walked,
 * but not always - and the line is drawn between consecutive ones, so an
 * answer that mentions a gate on the way up and again on the way down puts the
 * summit between two copies of one place. Sorting by distance from the start
 * settles it for a course that goes out and comes back the same way, which is
 * what these are. The two ends are left where the answer put them.
 */
// A name that resolved to the wrong side of the city would otherwise be sorted
// into the middle of the walk and drag a stretch across the map: 해골바위 comes
// back on 불암산, nine kilometres east, and belongs nowhere in this course.
const near = dropOutlierWaypoints(placed.map((p) => ({ ...p, lat: p.point[0], lng: p.point[1] })));
const dropped = placed.filter((p) => !near.some((k) => k.asked === p.asked));
if (dropped.length) console.log(`너무 멀어 제외: ${dropped.map((p) => p.asked).join(", ")}`);

const start = near[0];
const end = near[near.length - 1];
const middle = near.slice(1, -1)
  .sort((a, b) => metres(start.point, a.point) - metres(start.point, b.point));
const ordered: Placed[] = [start, ...middle, end]
  // One place under two names - 위문 and 백운봉암문 - is one waypoint.
  .filter((point, i, all) => i === 0 || metres(all[i - 1].point, point.point) > SAME_PLACE_M);

console.log(`\n걷는 순서: ${ordered.map((p) => p.asked).join(" → ")}`);
for (const point of ordered) {
  if (point.found.replace(/\s/g, "") !== point.asked.replace(/\s/g, "")) {
    console.log(`  '${point.asked}' → '${point.found}'`);
  }
}

const lats = ordered.map((p) => p.point[0]);
const lngs = ordered.map((p) => p.point[1]);
const box: Box = {
  south: Math.min(...lats) - 0.008, west: Math.min(...lngs) - 0.008,
  north: Math.max(...lats) + 0.008, east: Math.max(...lngs) + 0.008,
};
console.log("\nOSM 공개 GPS 트랙을 받는 중…");
const tracks = await fetchTracks(box);
console.log(`트랙 ${tracks.length}개 · 좌표 ${tracks.reduce((n, t) => n + t.length, 0)}개`);

/**
 * Each stretch in turn, reaching further along the course when one has no walk.
 *
 * A trail that runs past a named point without stopping at it - the 밤골 valley
 * goes to 백운봉암문, not to the 숨은벽능선 the answer lists before it - is
 * found by the longer reach and not by the short one.
 */
const lines: { from: string; to: string; line: NonNullable<ReturnType<typeof chooseLine>> }[] = [];
let at = 0;
while (at < ordered.length - 1) {
  let taken = false;
  for (let next = at + 1; next < ordered.length; next++) {
    const line = chooseLine(tracks, ordered[at].point, ordered[next].point, {
      endToleranceM: END_TOLERANCE_M, maxDetourRatio: MAX_DETOUR_RATIO,
    });
    const label = `${ordered[at].asked} → ${ordered[next].asked}`;
    if (!line) {
      console.log(`  ${label}: 걸은 사람 없음`);
      continue;
    }
    console.log(`  ${label}: ${line.points.length}점 · ${(lengthOf(line.points) / 1000).toFixed(2)}km · 동의 ${line.witnesses}명 · 분포 ${line.spread}`);
    lines.push({ from: ordered[at].asked, to: ordered[next].asked, line });
    at = next;
    taken = true;
    break;
  }
  // Nothing from here reaches anywhere. Start again from the next waypoint
  // rather than abandoning the rest of the course.
  if (!taken) at++;
}

if (lines.length === 0) {
  console.log("\n확정된 구간이 없습니다.");
  process.exit(0);
}
const total = lines.reduce((n, l) => n + lengthOf(l.line.points), 0);
console.log(`\n확정 ${lines.length}구간 · 합계 ${(total / 1000).toFixed(2)}km`);
if (dryRun) {
  console.log("시험 모드이므로 저장하지 않았습니다.");
  process.exit(0);
}

let nextId = ID_BASE - Math.floor(Math.random() * 1e5) * 10;
const segments: TrailSegment[] = lines.map(({ from, to, line }) => ({
  id: nextId--,
  name: `GPS 트랙 · ${from}→${to} · 동의 ${line.witnesses}명`,
  kind: "path",
  points: line.points,
}));

for (const [tile_key, tileSegments] of groupSegmentsByTile(segments)) {
  const existing = await fetch(
    `${supabaseUrl}/rest/v1/official_trails?select=segments&tile_key=eq.${encodeURIComponent(tile_key)}&source=eq.trace`,
    { headers },
  );
  const held = existing.ok ? ((await existing.json()) as { segments: TrailSegment[] }[])[0]?.segments ?? [] : [];
  // A line already stored between the same two ends is this stretch from an
  // earlier run. Replaced when this run had more people behind it, kept when
  // it did not - so a stretch settled for one improves once a second uploads.
  const witnessesIn = (segment: TrailSegment) =>
    Number(segment.name?.match(/동의 (\d+)명/)?.[1] ?? 0);
  const sameStretch = (a: TrailSegment, b: TrailSegment) => Math.min(
    metres(a.points[0], b.points[0]) + metres(a.points.at(-1)!, b.points.at(-1)!),
    metres(a.points[0], b.points.at(-1)!) + metres(a.points.at(-1)!, b.points[0]),
  ) <= 100;
  // A fresh line only displaces a stored one with fewer people behind it.
  const superseded = (segment: TrailSegment) => tileSegments.some((fresh) =>
    sameStretch(segment, fresh) && (force || witnessesIn(fresh) > witnessesIn(segment)));
  const keep = held.filter((segment) => !superseded(segment));
  const added = tileSegments.filter((fresh) =>
    !keep.some((segment) => sameStretch(segment, fresh)));
  const write = await fetch(`${supabaseUrl}/rest/v1/official_trails?on_conflict=tile_key,source`, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json", prefer: "resolution=merge-duplicates" },
    body: JSON.stringify([{ tile_key, source: "trace", segments: [...keep, ...added] }]),
  });
  if (!write.ok) throw new Error(`${tile_key} 저장 실패 (${write.status}): ${(await write.text()).slice(0, 200)}`);
}
console.log("저장했습니다");
