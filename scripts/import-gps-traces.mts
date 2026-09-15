/**
 * Builds trail geometry from the public GPS traces people upload to OSM.
 *
 *   node scripts/import-gps-traces.mts <남> <서> <북> <동> [--dry-run]
 *   node scripts/import-gps-traces.mts 37.655 126.950 37.675 126.985
 *
 * Some real trails are not mapped as ways. The 밤골 approach to 숨은벽 is one:
 * OSM holds a 26-point fragment of it tagged 비법정탐방로 and nothing that
 * connects, the national park does not publish closed routes, and a course
 * asked to go that way is routed two kilometres south and back instead.
 *
 * People have walked it with a recorder running, though, and OSM publishes
 * those traces openly under the same licence as the map itself. This is not
 * scraping somebody's account: it is the archive they are contributed to.
 *
 * The danger is that a raw trace is not a trail. It holds the walk back to the
 * car, the ten minutes spent lost, and whatever the receiver did under a cliff.
 * So nothing is kept on one track's word - a place is a path here only where
 * separate people walked it, which no single wrong turn can satisfy.
 */
import { readFileSync } from "node:fs";
import { groupSegmentsByTile } from "../src/lib/routes/tiles.ts";
import { haversineDistanceMeters } from "../src/lib/gps/haversine.ts";
import type { TrailSegment } from "../src/lib/routes/trails.ts";
import type { TrackPoint } from "../src/lib/gps/track.ts";

const ENDPOINT = "https://api.openstreetmap.org/api/0.6/trackpoints";
/** The API's own limit on the box it will answer, and on points per page. */
const MAX_SPAN_DEG = 0.25;
const PAGE_SIZE = 5000;

/**
 * A whole massif is asked for a piece at a time.
 *
 * The archive pages 5,000 points at a time and stops somewhere; over 북한산
 * that ceiling arrives long before the mountain does, and a truncated answer
 * looks exactly like a quiet one. Small boxes each get their own budget, and
 * they overlap so a path crossing a boundary is not cut at it.
 */
const CHUNK_DEG = 0.04;
const CHUNK_OVERLAP_DEG = 0.004;
const MAX_PAGES = 20;

/**
 * The grid the agreement is counted on, about thirteen metres at this latitude.
 *
 * Wide enough that two people walking the same path land in the same cell -
 * consumer GPS under tree cover is good to something like ten metres - and
 * narrow enough that the path either side of a fork stays two paths.
 */
const CELL_DEG = 0.00012;

/**
 * How many separate tracks have to pass through a cell before it is a path.
 *
 * Two is the whole filter. One track is one person's day, wrong turns and all;
 * two people taking the same line through the same thirteen metres is a path,
 * and a wrong turn repeated by two strangers is a path as well.
 */
const MIN_TRACKS = 2;

/** Points off the agreed path that a run survives before it is broken. */
const MAX_STRAY_POINTS = 3;

/** Shorter than this and it is a stray cluster, not a piece of trail. */
const MIN_RUN_POINTS = 4;
const MIN_RUN_LENGTH_M = 40;

/** Roughly OSM's own spacing; finer than this is receiver noise. */
const MIN_SPACING_M = 8;

/**
 * Ids are negative so they can never collide with an OSM way id.
 *
 * The agency imports took 900,000,000 and 950,000,000, which was safe when
 * they were written and is not: OSM way ids passed 1.4 billion and are still
 * climbing, so those bands will eventually name a real way. Negative ids are
 * outside anything OSM will ever issue.
 */
const ID_BASE = -2_000_000;

function env(name: string): string {
  const match = readFileSync(".env.local", "utf8").match(new RegExp(`^${name}=(.*)$`, "m"));
  const value = match?.[1]?.trim().replace(/^["']|["']$/g, "");
  if (!value) throw new Error(`${name} is not set in .env.local`);
  return value;
}

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const [south, west, north, east] = args.filter((a) => a !== "--dry-run").map(Number);
if (![south, west, north, east].every(Number.isFinite)) {
  throw new Error("사용법: <남> <서> <북> <동> [--dry-run]");
}
if (north - south > MAX_SPAN_DEG || east - west > MAX_SPAN_DEG) {
  throw new Error(`한 번에 ${MAX_SPAN_DEG}° 이하만 요청할 수 있습니다.`);
}

interface Box { south: number; west: number; north: number; east: number }

function chunksOf(box: Box): Box[] {
  const out: Box[] = [];
  for (let y = box.south; y < box.north - 1e-9; y += CHUNK_DEG) {
    for (let x = box.west; x < box.east - 1e-9; x += CHUNK_DEG) {
      out.push({
        south: Math.max(box.south, y - CHUNK_OVERLAP_DEG),
        west: Math.max(box.west, x - CHUNK_OVERLAP_DEG),
        north: Math.min(box.north, y + CHUNK_DEG + CHUNK_OVERLAP_DEG),
        east: Math.min(box.east, x + CHUNK_DEG + CHUNK_OVERLAP_DEG),
      });
    }
  }
  return out;
}

/** Ordered points per recorded segment, as the archive returns them. */
async function fetchTracks(box: Box): Promise<TrackPoint[][]> {
  const tracks: TrackPoint[][] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = `${ENDPOINT}?bbox=${box.west},${box.south},${box.east},${box.north}&page=${page}`;
    const response = await fetch(url, {
      headers: { "user-agent": "khuac.com hiking album (contact: https://khuac.com)" },
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) throw new Error(`page ${page}: HTTP ${response.status}`);
    const gpx = await response.text();

    let points = 0;
    // Regex rather than an XML parser: the archive returns one shape, and the
    // only thing wanted from it is the coordinates in the order they were
    // recorded, grouped by the segment they belong to.
    for (const [, body] of gpx.matchAll(/<trkseg>([\s\S]*?)<\/trkseg>/g)) {
      const track: TrackPoint[] = [];
      for (const match of body.matchAll(/lat="(-?[\d.]+)"\s+lon="(-?[\d.]+)"/g)) {
        track.push([Number(match[1]), Number(match[2])]);
      }
      points += track.length;
      if (track.length >= MIN_RUN_POINTS) tracks.push(track);
    }
    // A short page is the last one; the archive fills each to the cap.
    if (points < PAGE_SIZE) break;
    // The archive is free and volunteer-funded. One request a second.
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return tracks;
}

const cellOf = (point: TrackPoint) =>
  `${Math.floor(point[0] / CELL_DEG)}:${Math.floor(point[1] / CELL_DEG)}`;

console.log(`OSM 공개 GPS 트랙을 받는 중 (${south},${west} ~ ${north},${east})`);
const chunks = chunksOf({ south, west, north, east });
const tracks: TrackPoint[][] = [];
for (const [index, chunk] of chunks.entries()) {
  const found = await fetchTracks(chunk);
  tracks.push(...found);
  console.log(`  ${index + 1}/${chunks.length} · 트랙 ${found.length}개 · 누적 ${tracks.length}개`);
}
console.log(`트랙 ${tracks.length}개 · 좌표 ${tracks.reduce((n, t) => n + t.length, 0)}개`);

// How many separate tracks touch each cell, and where their points average to.
const walkers = new Map<string, Set<number>>();
const sums = new Map<string, { lat: number; lng: number; n: number }>();
for (const [index, track] of tracks.entries()) {
  for (const point of track) {
    const cell = cellOf(point);
    const seen = walkers.get(cell);
    if (seen) seen.add(index);
    else walkers.set(cell, new Set([index]));
    const sum = sums.get(cell) ?? { lat: 0, lng: 0, n: 0 };
    sum.lat += point[0];
    sum.lng += point[1];
    sum.n++;
    sums.set(cell, sum);
  }
}
/**
 * Agreement is counted over a cell and its eight neighbours.
 *
 * Counted cell by cell it is not two people walking a path, it is two people
 * landing in the same thirteen metres, and a receiver that wanders one cell
 * sideways breaks its own evidence. That cut 34 tracks into 2,146 fragments -
 * a pile of short pieces the router cannot join, which is the state this was
 * meant to fix rather than reproduce.
 */
const agreed = new Set<string>();
for (const cell of walkers.keys()) {
  const [y, x] = cell.split(":").map(Number);
  const nearby = new Set<number>();
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      for (const who of walkers.get(`${y + dy}:${x + dx}`) ?? []) nearby.add(who);
    }
  }
  if (nearby.size >= MIN_TRACKS) agreed.add(cell);
}
console.log(`격자 ${walkers.size}개 중 ${agreed.size}개에서 ${MIN_TRACKS}개 이상의 트랙이 일치`);

/**
 * Every point in an agreed cell becomes that cell's average position, so two
 * tracks down the same path come out as the same coordinates rather than as
 * two lines a few metres apart. The router then treats them as one way without
 * being told, because identical coordinates are already one node to it.
 */
const centre = (cell: string): TrackPoint => {
  const sum = sums.get(cell)!;
  return [sum.lat / sum.n, sum.lng / sum.n];
};

const segments: TrailSegment[] = [];
let nextId = ID_BASE;
for (const track of tracks) {
  let run: TrackPoint[] = [];
  const flush = () => {
    if (run.length >= MIN_RUN_POINTS) {
      // Thinned the way the surveyed import is, and by the same reasoning.
      const kept: TrackPoint[] = [run[0]];
      for (const point of run.slice(1)) {
        const last = kept[kept.length - 1];
        const gap = haversineDistanceMeters(
          { lat: last[0], lng: last[1] }, { lat: point[0], lng: point[1] },
        );
        if (gap >= MIN_SPACING_M) kept.push(point);
      }
      if (kept.length < 2) kept.push(run[run.length - 1]);
      let length = 0;
      for (let i = 1; i < kept.length; i++) {
        length += haversineDistanceMeters(
          { lat: kept[i - 1][0], lng: kept[i - 1][1] }, { lat: kept[i][0], lng: kept[i][1] },
        );
      }
      if (kept.length >= 2 && length >= MIN_RUN_LENGTH_M) {
        segments.push({ id: nextId--, name: null, kind: "path", points: kept });
      }
    }
    run = [];
  };

  // A single stray point between two agreed ones is the receiver, not a gap in
  // the path; several in a row is the walker leaving it.
  let straying = 0;
  for (const point of track) {
    const cell = cellOf(point);
    if (!agreed.has(cell)) {
      // Where the tracks stop agreeing the path stops. Carrying on to the next
      // agreed stretch would draw a straight line over whatever was in between.
      if (++straying > MAX_STRAY_POINTS) flush();
      continue;
    }
    straying = 0;
    const snapped = centre(cell);
    const last = run[run.length - 1];
    if (!last || last[0] !== snapped[0] || last[1] !== snapped[1]) run.push(snapped);
  }
  flush();
}

const points = segments.reduce((n, s) => n + s.points.length, 0);
console.log(`구간 ${segments.length}개 · 좌표 ${points}개`);
if (segments.length === 0) {
  console.log("일치하는 구간이 없습니다. 더 넓은 영역을 시도하거나 MIN_TRACKS를 확인하세요.");
  process.exit(0);
}

const byTile = groupSegmentsByTile(segments);
console.log(`타일 ${byTile.size}개`);

if (dryRun) {
  const lats = segments.flatMap((s) => s.points.map(([lat]) => lat));
  const lngs = segments.flatMap((s) => s.points.map(([, lng]) => lng));
  console.log(`위도 ${Math.min(...lats).toFixed(4)}~${Math.max(...lats).toFixed(4)} · 경도 ${Math.min(...lngs).toFixed(4)}~${Math.max(...lngs).toFixed(4)}`);
  console.log("시험 모드이므로 저장하지 않았습니다.");
  process.exit(0);
}

const url = env("NEXT_PUBLIC_SUPABASE_URL");
const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
const rows = [...byTile].map(([tile_key, tileSegments]) => ({
  tile_key,
  // Its own source, so a re-run replaces these and leaves the agencies' rows
  // alone - and so a line that came from traces can be told apart later.
  source: "trace",
  segments: tileSegments,
}));

for (let i = 0; i < rows.length; i += 10) {
  const response = await fetch(`${url}/rest/v1/official_trails?on_conflict=tile_key,source`, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      authorization: `Bearer ${serviceKey}`,
      "content-type": "application/json",
      prefer: "resolution=merge-duplicates",
    },
    body: JSON.stringify(rows.slice(i, i + 10)),
  });
  if (!response.ok) {
    throw new Error(`업로드 실패 (${response.status}): ${(await response.text()).slice(0, 200)}`);
  }
}
console.log(`${rows.length}개 타일 저장 완료`);
