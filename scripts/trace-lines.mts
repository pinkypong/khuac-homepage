/**
 * Turning OSM's public GPS traces into one line per stretch of trail.
 *
 * The rules live here rather than in either script so that filling one gap and
 * building a whole course cannot drift apart - they are the same question asked
 * about different numbers of stretches.
 *
 * The archive anonymises traces whose owner asked it to: those come back
 * without timestamps and in no particular order, and read as a line they join
 * points at random. Only traces that kept their times are used, gathered by the
 * upload they came from so a walk split across pages and chunks is one walk.
 */
import { haversineDistanceMeters } from "../src/lib/gps/haversine.ts";
import type { TrackPoint } from "../src/lib/gps/track.ts";

const ENDPOINT = "https://api.openstreetmap.org/api/0.6/trackpoints";
const PAGE_SIZE = 5000;
const MAX_PAGES = 20;
const CHUNK_DEG = 0.04;
const CHUNK_OVERLAP_DEG = 0.004;

/** How far apart two people can be and still be on the same path. */
export const MATCH_TOLERANCE_M = 30;
/** How much of the reference another track has to cover to vouch for it. */
export const MATCH_RATIO = 0.75;
/** Three is wanted; fewer is accepted, down to a lone track, when that is all
    the archive holds. The count is stored so a later run can improve on it. */
export const WITNESS_LEVELS = [3, 2, 1, 0];
/** Roughly OSM's own spacing; finer than this is receiver noise. */
export const MIN_SPACING_M = 8;

export interface Box { south: number; west: number; north: number; east: number }

export const metres = (a: TrackPoint, b: TrackPoint) =>
  haversineDistanceMeters({ lat: a[0], lng: a[1] }, { lat: b[0], lng: b[1] });

export function lengthOf(track: TrackPoint[]): number {
  let total = 0;
  for (let i = 1; i < track.length; i++) total += metres(track[i - 1], track[i]);
  return total;
}

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

/** Every timestamped trace over an area, one entry per walk. */
export async function fetchTracks(area: Box): Promise<TrackPoint[][]> {
  const named = new Map<string, { point: TrackPoint; at: number }[]>();
  for (const chunk of chunksOf(area)) {
    for (let page = 0; page < MAX_PAGES; page++) {
      const url = `${ENDPOINT}?bbox=${chunk.west},${chunk.south},${chunk.east},${chunk.north}&page=${page}`;
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
        const existing = named.get(name);
        if (existing) existing.push(...timed);
        else named.set(name, timed);
      }
      if (points < PAGE_SIZE) break;
      // The archive is free and volunteer-funded. One request a second.
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  return [...named.values()]
    .map((timed) => {
      timed.sort((a, b) => a.at - b.at);
      return timed.map((entry) => entry.point);
    })
    .filter((track) => track.length >= 10);
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

function covers(reference: TrackPoint[], other: TrackPoint[]): number {
  const near = indexOf(other);
  let hit = 0;
  for (const point of reference) if (near(point)) hit++;
  return hit / reference.length;
}

export interface ChosenLine {
  points: TrackPoint[];
  witnesses: number;
  votes: number[];
  /** The length clumps the candidates fell into, for the log. */
  spread: string;
}

/**
 * The line most people walked between two points, or null if nobody did.
 *
 * One person's track is the answer and the others only say whether they went
 * the same way. Building the line from the crowd instead - keeping whatever any
 * two agreed on, cell by cell - was tried first and produces a braid rather
 * than a path once there are hundreds of tracks, because walkers drift between
 * neighbouring cells and a cell has no opinion about which strand is the trail.
 *
 * Which person is asked first is decided by length. Between two points there is
 * often more than one way - a ridge and a valley, a scramble and the path round
 * it - and they show up as separate clumps in the lengths. The busiest clump is
 * the way most people take, which is the question: the shortest line between
 * two points is what the router finds on its own, and that it disagrees with
 * the walked route is the reason any of this exists.
 */
export function chooseLine(
  tracks: TrackPoint[][],
  from: TrackPoint,
  to: TrackPoint,
  options: { endToleranceM: number; maxDetourRatio: number },
): ChosenLine | null {
  const straight = metres(from, to);
  const candidates = tracks.flatMap((track) => {
    const start = closest(track, from);
    const end = closest(track, to);
    if (start.distance > options.endToleranceM || end.distance > options.endToleranceM) return [];
    const slice = start.index <= end.index
      ? track.slice(start.index, end.index + 1)
      : track.slice(end.index, start.index + 1).reverse();
    if (slice.length < 10) return [];
    // Somebody who wandered off for an hour in the middle is not describing
    // this stretch, however close they passed to both ends of it.
    if (lengthOf(slice) > straight * options.maxDetourRatio) return [];
    return [slice];
  });
  if (candidates.length === 0) return null;

  const lengths = candidates.map(lengthOf);
  // Wide enough that two recordings of one walk share a bin, narrow enough
  // that two different ways between the same points do not.
  const binM = Math.max(120, straight * 0.08);
  const bins = new Map<number, number[]>();
  for (const [index, length] of lengths.entries()) {
    const bin = Math.round(length / binM);
    const members = bins.get(bin);
    if (members) members.push(index);
    else bins.set(bin, [index]);
  }
  const sorted = [...bins].sort((a, b) => b[1].length - a[1].length || a[0] - b[0]);
  const spread = sorted.slice(0, 4)
    .map(([bin, members]) => `${(bin * binM / 1000).toFixed(2)}km×${members.length}`).join(", ");
  const order = sorted.flatMap(([bin, members]) =>
    [...members].sort((a, b) =>
      Math.abs(lengths[a] - bin * binM) - Math.abs(lengths[b] - bin * binM)));

  for (const wanted of WITNESS_LEVELS) {
    for (const index of order.slice(0, 40)) {
      const reference = candidates[index];
      const votes: number[] = [];
      for (const [other, stretch] of candidates.entries()) {
        if (other === index) continue;
        const ratio = covers(reference, stretch);
        if (ratio >= MATCH_RATIO) votes.push(ratio);
        if (votes.length >= wanted) break;
      }
      if (votes.length >= wanted) {
        return { points: thin(reference), witnesses: votes.length, votes, spread };
      }
    }
  }
  return null;
}

/** Keeps the shape, drops the receiver's jitter. Ends are always kept. */
export function thin(points: TrackPoint[]): TrackPoint[] {
  const kept: TrackPoint[] = [points[0]];
  for (const point of points.slice(1)) {
    if (metres(kept[kept.length - 1], point) >= MIN_SPACING_M) kept.push(point);
  }
  const last = points[points.length - 1];
  if (kept[kept.length - 1] !== last) kept.push(last);
  return kept;
}
