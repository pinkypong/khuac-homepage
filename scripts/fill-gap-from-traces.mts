/**
 * Fills one missing stretch of trail with a line somebody actually walked.
 *
 *   node scripts/fill-gap-from-traces.mts <남> <서> <북> <동> [--dry-run]
 *   node scripts/fill-gap-from-traces.mts 37.65871 126.95129 37.66277 126.97630
 *
 * The first attempt at this took every trace at once and kept whatever two
 * people agreed on. Over 34 tracks that produced a path; over 900 it produced a
 * braid, because walkers drift between neighbouring cells and agreement counted
 * cell by cell has no opinion about which strand is the trail.
 *
 * So the line is not built from the crowd. One person's track is taken as the
 * answer and the others are only asked whether they went the same way. What
 * comes out is a line that was really walked, once, by one recorder - never an
 * average of several - and the crowd's job is to say that it was not a mistake.
 *
 * Between two points, which is how a course is already described: waypoint to
 * waypoint. A stretch nobody can vouch for is left undrawn rather than guessed,
 * the same as everywhere else here.
 */
import { readFileSync } from "node:fs";
import { groupSegmentsByTile } from "../src/lib/routes/tiles.ts";
import { haversineDistanceMeters } from "../src/lib/gps/haversine.ts";
import type { TrailSegment } from "../src/lib/routes/trails.ts";
import type { TrackPoint } from "../src/lib/gps/track.ts";

const ENDPOINT = "https://api.openstreetmap.org/api/0.6/trackpoints";
const PAGE_SIZE = 5000;
const MAX_PAGES = 20;
const CHUNK_DEG = 0.04;
const CHUNK_OVERLAP_DEG = 0.004;

/** How near a track has to pass an end to be talking about this stretch. */
const END_TOLERANCE_M = 120;

/**
 * How far apart two people can be and still be on the same path.
 *
 * Consumer GPS under tree cover is good to something like ten metres, and two
 * people do not walk in each other's footprints, so this is deliberately
 * looser than the accuracy of either. It is not measuring agreement on a
 * position, it is asking whether they were on the same trail.
 */
const MATCH_TOLERANCE_M = 30;

/** How much of the reference another track has to cover to vouch for it. */
const MATCH_RATIO = 0.75;

/**
 * How many other people have to have walked it.
 *
 * Three is what we want, because two is one coincidence away from a wrong turn
 * that two strangers both took - the junction everybody misses is exactly the
 * place where two agreeing tracks are both wrong.
 *
 * Two is accepted when two is all there is. On the quieter approaches that is
 * the whole archive, and a line two people walked is still better evidence
 * than the two-kilometre detour the router finds without it. The count is
 * written into the line, so a later run over the same stretch can tell whether
 * the archive has since done better and replace it if so.
 */
const PREFERRED_WITNESSES = 3;
const MIN_WITNESSES = 2;

/** References to try before giving up. Shuffled, so this is not the same one. */
const MAX_REFERENCES = 40;

/** A stretch far longer than the straight line is somebody's whole day out. */
const MAX_DETOUR_RATIO = 3;

/** Roughly OSM's own spacing; finer than this is receiver noise. */
const MIN_SPACING_M = 8;

/** Negative, so it can never collide with an OSM way id. */
const ID_BASE = -3_000_000;

function env(name: string): string {
  const match = readFileSync(".env.local", "utf8").match(new RegExp(`^${name}=(.*)$`, "m"));
  const value = match?.[1]?.trim().replace(/^["']|["']$/g, "");
  if (!value) throw new Error(`${name} is not set in .env.local`);
  return value;
}

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
// Replaces a line already stored for this stretch even when it had as many
// witnesses. For when the choice rule itself has changed, not the archive.
const force = args.includes("--force");
const [fromLat, fromLng, toLat, toLng] = args.filter((a) => !a.startsWith("--")).map(Number);
if (![fromLat, fromLng, toLat, toLng].every(Number.isFinite)) {
  throw new Error("사용법: <시작위도> <시작경도> <끝위도> <끝경도> [--dry-run]");
}
const from: TrackPoint = [fromLat, fromLng];
const to: TrackPoint = [toLat, toLng];

const metres = (a: TrackPoint, b: TrackPoint) =>
  haversineDistanceMeters({ lat: a[0], lng: a[1] }, { lat: b[0], lng: b[1] });

const straight = metres(from, to);
console.log(`구간 ${(straight / 1000).toFixed(2)}km (직선)`);

interface Box { south: number; west: number; north: number; east: number }

/** Wide enough that a path going round a spur is still inside the box. */
const margin = Math.max(0.006, straight / 111_320 * 0.4);
const box: Box = {
  south: Math.min(fromLat, toLat) - margin,
  west: Math.min(fromLng, toLng) - margin,
  north: Math.max(fromLat, toLat) + margin,
  east: Math.max(fromLng, toLng) + margin,
};

function chunksOf(area: Box): Box[] {
  const out: Box[] = [];
  for (let y = area.south; y < area.north - 1e-9; y += CHUNK_DEG) {
    for (let x = area.west; x < area.east - 1e-9; x += CHUNK_DEG) {
      out.push({
        south: Math.max(area.south, y - CHUNK_OVERLAP_DEG),
        west: Math.max(area.west, x - CHUNK_OVERLAP_DEG),
        north: Math.min(area.north, y + CHUNK_DEG + CHUNK_OVERLAP_DEG),
        east: Math.min(area.east, x + CHUNK_DEG + CHUNK_OVERLAP_DEG),
      });
    }
  }
  return out;
}

/** Every trace seen so far, keyed by the upload it came from. */
const named = new Map<string, { point: TrackPoint; at: number }[]>();

async function fetchTracks(area: Box): Promise<void> {
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = `${ENDPOINT}?bbox=${area.west},${area.south},${area.east},${area.north}&page=${page}`;
    let gpx = "";
    for (let attempt = 1; ; attempt++) {
      try {
        const response = await fetch(url, {
          headers: { "user-agent": "khuac.com hiking album (contact: https://khuac.com)" },
          signal: AbortSignal.timeout(60_000),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        gpx = await response.text();
        break;
      } catch (error) {
        if (attempt >= 4) throw new Error(`page ${page}: ${String(error)}`);
        await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
      }
    }
    let points = 0;
    // One <trk> per uploaded trace, and only the ones that kept their times.
    //
    // The archive anonymises traces whose owner asked it to: those come back
    // stripped of timestamps and in no particular order, and reading them as a
    // line joins points at random. That is what produced "tracks" 5,981km long
    // through a two-kilometre valley. A trace that still carries times is one
    // somebody published as theirs, and its points are a walk.
    for (const [, block] of gpx.matchAll(/<trk>([\s\S]*?)<\/trk>/g)) {
      const name = block.match(/<url>([^<]*)<\/url>/)?.[1]
        ?? block.match(/<name>([^<]*)<\/name>/)?.[1] ?? "";
      const timed: { point: TrackPoint; at: number }[] = [];
      for (const [, lat, lon, iso] of block.matchAll(
        /lat="(-?[\d.]+)"\s+lon="(-?[\d.]+)"[\s\S]{0,120}?<time>([^<]+)<\/time>/g,
      )) {
        const at = Date.parse(iso);
        if (Number.isFinite(at)) timed.push({ point: [Number(lat), Number(lon)], at });
      }
      points += (block.match(/<trkpt/g) ?? []).length;
      if (timed.length < 10) continue;
      timed.sort((a, b) => a.at - b.at);
      // The same trace appears again on the next page and in the overlapping
      // chunk beside this one; its pieces belong to one walk, not three.
      const existing = named.get(name);
      if (existing) existing.push(...timed);
      else named.set(name, timed);
    }
    if (points < PAGE_SIZE) break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

console.log("OSM 공개 GPS 트랙을 받는 중…");
for (const chunk of chunksOf(box)) await fetchTracks(chunk);
const tracks: TrackPoint[][] = [...named.values()]
  .map((timed) => {
    timed.sort((a, b) => a.at - b.at);
    return timed.map((entry) => entry.point);
  })
  .filter((track) => track.length >= 10);
console.log(`트랙 ${tracks.length}개 · 좌표 ${tracks.reduce((n, t) => n + t.length, 0)}개`);
{
  const lengths = tracks.map((t) => {
    let d = 0;
    for (let i = 1; i < t.length; i++) d += haversineDistanceMeters(
      { lat: t[i-1][0], lng: t[i-1][1] }, { lat: t[i][0], lng: t[i][1] });
    return d;
  }).sort((a, b) => b - a);
  console.log(`  조각 길이 상위: ${lengths.slice(0, 8).map((d) => (d/1000).toFixed(2)).join(", ")}km · 중앙값 ${(lengths[Math.floor(lengths.length/2)]/1000).toFixed(2)}km`);
}

/** Where a track comes closest to a point, and how close that is. */
function closest(track: TrackPoint[], point: TrackPoint) {
  let index = -1;
  let best = Infinity;
  for (const [i, candidate] of track.entries()) {
    const gap = metres(candidate, point);
    if (gap < best) {
      best = gap;
      index = i;
    }
  }
  return { index, distance: best };
}

/** The piece of a track that runs between the two ends, in walking order. */
function stretchOf(track: TrackPoint[]): TrackPoint[] | null {
  const start = closest(track, from);
  const end = closest(track, to);
  if (start.distance > END_TOLERANCE_M || end.distance > END_TOLERANCE_M) return null;
  const slice = start.index <= end.index
    ? track.slice(start.index, end.index + 1)
    : track.slice(end.index, start.index + 1).reverse();
  if (slice.length < 10) return null;
  let length = 0;
  for (let i = 1; i < slice.length; i++) length += metres(slice[i - 1], slice[i]);
  // Somebody who wandered off for an hour in the middle is not describing this
  // stretch, however close they passed to both ends of it.
  if (length > straight * MAX_DETOUR_RATIO) return null;
  return slice;
}

const candidates = tracks.flatMap((track) => {
  const stretch = stretchOf(track);
  return stretch ? [stretch] : [];
});
console.log(`양 끝을 모두 지나는 트랙 ${candidates.length}개`);
if (candidates.length < MIN_WITNESSES + 1) {
  // Which end nobody came near is the whole diagnosis: a tolerance that is too
  // tight looks exactly like a point in the wrong place.
  const starts = tracks.map((t) => closest(t, from).distance).sort((a, b) => a - b);
  const ends = tracks.map((t) => closest(t, to).distance).sort((a, b) => a - b);
  console.log(`  시작점에 가장 가까이 지난 거리: ${starts.slice(0, 5).map((d) => Math.round(d)).join(", ")}m`);
  console.log(`  끝점에 가장 가까이 지난 거리: ${ends.slice(0, 5).map((d) => Math.round(d)).join(", ")}m`);
}
if (candidates.length < MIN_WITNESSES + 1) {
  console.log(`증인이 ${MIN_WITNESSES}명은 있어야 합니다. 이 구간은 그리지 않습니다.`);
  process.exit(0);
}

/** A coarse index of one track, so covering it is not a scan per point. */
function indexOf(track: TrackPoint[]) {
  const cell = MATCH_TOLERANCE_M / 111_320;
  const grid = new Map<string, TrackPoint[]>();
  for (const point of track) {
    const key = `${Math.floor(point[0] / cell)}:${Math.floor(point[1] / cell)}`;
    const bucket = grid.get(key);
    if (bucket) bucket.push(point);
    else grid.set(key, [point]);
  }
  return (point: TrackPoint) => {
    const y = Math.floor(point[0] / cell);
    const x = Math.floor(point[1] / cell);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        for (const candidate of grid.get(`${y + dy}:${x + dx}`) ?? []) {
          if (metres(candidate, point) <= MATCH_TOLERANCE_M) return true;
        }
      }
    }
    return false;
  };
}

/** How much of the reference this other track also walked. */
function covers(reference: TrackPoint[], other: TrackPoint[]): number {
  const near = indexOf(other);
  let hit = 0;
  for (const point of reference) if (near(point)) hit++;
  return hit / reference.length;
}

/**
 * Candidates in the order they deserve to be asked about, not at random.
 *
 * Shuffling meant two runs over one stretch chose different people and stored
 * different lines - 3.98km one time and 3.73km the next, both with three
 * witnesses at a hundred per cent. A stored line ought not to depend on when it
 * was stored.
 *
 * The order is by how many people walked something that long. Between two
 * points there is often more than one way - a ridge and a valley, or a
 * scramble and the path round it - and they show up as separate clumps in the
 * lengths. The biggest clump is the way most people take, which is the
 * question being asked: not the shortest line between these points, which is
 * what the router already finds and is why this exists.
 *
 * A median would sit between two clumps and belong to neither. A mode picks a
 * side.
 */
const lengthOf = (track: TrackPoint[]) => {
  let total = 0;
  for (let i = 1; i < track.length; i++) total += metres(track[i - 1], track[i]);
  return total;
};
const lengths = candidates.map(lengthOf);
// Wide enough that two recordings of one walk share a bin, narrow enough that
// two different ways between the same points do not.
const BIN_M = Math.max(120, straight * 0.08);
const bins = new Map<number, number[]>();
for (const [index, length] of lengths.entries()) {
  const bin = Math.round(length / BIN_M);
  const members = bins.get(bin);
  if (members) members.push(index);
  else bins.set(bin, [index]);
}
const sorted = [...bins].sort((a, b) => b[1].length - a[1].length || a[0] - b[0]);
console.log(`  길이 분포 (${Math.round(BIN_M)}m 단위): ${sorted.slice(0, 5)
  .map(([bin, members]) => `${(bin * BIN_M / 1000).toFixed(2)}km×${members.length}`).join(", ")}`);
// The busiest clump first, each clump's members nearest its centre first, and
// the quieter clumps after it as a fallback rather than as an equal.
const order = sorted.flatMap(([bin, members]) =>
  [...members].sort((a, b) =>
    Math.abs(lengths[a] - bin * BIN_M) - Math.abs(lengths[b] - bin * BIN_M)));

let chosen: { stretch: TrackPoint[]; votes: number[] } | null = null;
// Asked for three first and settled for two only if three is not on offer, so
// a quiet stretch is drawn without a busy one being drawn on weaker evidence.
for (const wanted of [PREFERRED_WITNESSES, MIN_WITNESSES]) {
  for (const index of order.slice(0, MAX_REFERENCES)) {
    const reference = candidates[index];
    const votes: number[] = [];
    for (const [other, stretch] of candidates.entries()) {
      if (other === index) continue;
      const ratio = covers(reference, stretch);
      if (ratio >= MATCH_RATIO) votes.push(ratio);
      if (votes.length >= wanted) break;
    }
    if (votes.length >= wanted) {
      let length = 0;
      for (let i = 1; i < reference.length; i++) length += metres(reference[i - 1], reference[i]);
      console.log(`  채택 후보 ${index}: ${reference.length}점 · ${(length / 1000).toFixed(2)}km · 동의 ${votes.length}명`);
      chosen = { stretch: reference, votes };
      break;
    }
  }
  if (chosen) break;
  console.log(`  동의 ${wanted}명인 경로 없음`);
}

if (!chosen) {
  console.log(`${MIN_WITNESSES}명 이상이 동의하는 경로가 없습니다. 이 구간은 그리지 않습니다.`);
  process.exit(0);
}

// Thinned the way the surveyed import is, and for the same reason.
const kept: TrackPoint[] = [chosen.stretch[0]];
for (const point of chosen.stretch.slice(1)) {
  if (metres(kept[kept.length - 1], point) >= MIN_SPACING_M) kept.push(point);
}
if (kept[kept.length - 1] !== chosen.stretch[chosen.stretch.length - 1]) {
  kept.push(chosen.stretch[chosen.stretch.length - 1]);
}
let routed = 0;
for (let i = 1; i < kept.length; i++) routed += metres(kept[i - 1], kept[i]);
console.log(`채택: ${kept.length}점 · ${(routed / 1000).toFixed(2)}km · 배율 ${(routed / straight).toFixed(2)} · 동의 ${chosen.votes.map((v) => `${Math.round(v * 100)}%`).join(", ")}`);

// The count is part of the line, so a later run can see what this one was
// working from and replace it only when the archive has done better.
const witnessed = chosen.votes.length;
const segments: TrailSegment[] = [{
  id: ID_BASE - Math.floor(Math.random() * 1e6),
  name: `GPS 트랙 · 동의 ${witnessed}명`,
  kind: "path",
  points: kept,
}];
const byTile = groupSegmentsByTile(segments);
console.log(`타일 ${byTile.size}개`);

if (dryRun) {
  console.log("시험 모드이므로 저장하지 않았습니다.");
  process.exit(0);
}

const url = env("NEXT_PUBLIC_SUPABASE_URL");
const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
const headers = { apikey: serviceKey, authorization: `Bearer ${serviceKey}` };

// Merged into whatever this source already holds for the tile rather than
// replacing it, so filling a second gap does not erase the first.
for (const [tile_key, tileSegments] of byTile) {
  const existing = await fetch(
    `${url}/rest/v1/official_trails?select=segments&tile_key=eq.${encodeURIComponent(tile_key)}&source=eq.trace`,
    { headers },
  );
  const rows = existing.ok ? (await existing.json()) as { segments: TrailSegment[] }[] : [];
  const held = rows[0]?.segments ?? [];
  // A line already drawn between these same two ends is this stretch, drawn on
  // an earlier run. Replaced when this run had more people behind it, kept when
  // it did not - which is how a stretch settled for two improves by itself once
  // a third walker uploads.
  const sameStretch = (segment: TrailSegment) =>
    Math.min(
      metres(segment.points[0], kept[0]) + metres(segment.points[segment.points.length - 1], kept[kept.length - 1]),
      metres(segment.points[0], kept[kept.length - 1]) + metres(segment.points[segment.points.length - 1], kept[0]),
    ) <= 100;
  const previous = held.filter(sameStretch);
  const best = Math.max(0, ...previous.map((s) => Number(s.name?.match(/동의 (\d+)명/)?.[1] ?? 0)));
  if (!force && previous.length > 0 && best >= witnessed) {
    console.log(`${tile_key}: 이미 동의 ${best}명짜리 선이 있어 그대로 둡니다`);
    continue;
  }
  const merged = [...held.filter((segment) => !sameStretch(segment)), ...tileSegments];
  const write = await fetch(`${url}/rest/v1/official_trails?on_conflict=tile_key,source`, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json", prefer: "resolution=merge-duplicates" },
    body: JSON.stringify([{ tile_key, source: "trace", segments: merged }]),
  });
  if (!write.ok) throw new Error(`${tile_key} 저장 실패 (${write.status}): ${(await write.text()).slice(0, 200)}`);
}
console.log(`${byTile.size}개 타일에 저장했습니다`);
