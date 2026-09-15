/**
 * Imports 국립공원 탐방로 공간데이터 into public.official_trails.
 *
 *   node scripts/import-park-trails.mts [--dry-run] [--limit N]
 *
 * The API publishes one row per vertex - 910,000 of them nationally - with the
 * course id alongside. Grouping by course in arrival order rebuilds the line:
 * consecutive points come back 0.9m apart at the median, which is both proof
 * that the order is real and far finer than anything a map needs.
 *
 * That density is the reason for the thinning below. Stored raw, one course
 * runs to thousands of points and the browser would draw a polyline it cannot
 * tell from a line a fifteenth the size.
 */
import { readFileSync } from "node:fs";
import { groupSegmentsByTile } from "../src/lib/routes/tiles.ts";
import { haversineDistanceMeters } from "../src/lib/gps/haversine.ts";
import { splitSurveyGaps, type TrailSegment } from "../src/lib/routes/trails.ts";

const ENDPOINT =
  "https://api.odcloud.kr/api/15003467/v1/uddi:33b2e50e-6039-4649-a9da-8d5b89180b78_201709281349";
const PAGE_SIZE = 5000; // The API returns nothing above this.
// Used to re-ask for an offset the large page size returns empty.
const SMALL_PAGE = 1000;

/** Ids are ours; the offset keeps them clear of OSM way ids and the other source. */
const ID_OFFSET = 950_000_000;

/**
 * Roughly the spacing OSM uses, which is enough to follow a switchback.
 * Sub-metre vertices are survey detail, not map detail.
 */
const MIN_SPACING_M = 8;

interface Row {
  코스ID?: number | string;
  "탐방코스(한글)"?: string;
  위도?: string | number;
  경도?: string | number;
  "탐방로 통제여부"?: number | string;
}

function env(name: string): string {
  const match = readFileSync(".env.local", "utf8").match(new RegExp(`^${name}=(.*)$`, "m"));
  const value = match?.[1]?.trim().replace(/^["']|["']$/g, "");
  if (!value) throw new Error(`${name} is not set in .env.local`);
  // Accept either key form: URLSearchParams would encode an already-encoded
  // key a second time, which fails as SERVICE_KEY_IS_NOT_REGISTERED_ERROR.
  return /%[0-9A-Fa-f]{2}/.test(value) ? decodeURIComponent(value) : value;
}

async function fetchPage(
  key: string,
  page: number,
  perPage: number = PAGE_SIZE,
): Promise<{ rows: Row[]; total: number }> {
  const url = new URL(ENDPOINT);
  url.searchParams.set("serviceKey", key);
  url.searchParams.set("page", String(page));
  url.searchParams.set("perPage", String(perPage));
  const response = await fetch(url, { signal: AbortSignal.timeout(90_000) });
  if (!response.ok) throw new Error(`page ${page}: HTTP ${response.status}`);
  const body = (await response.json()) as { data?: Row[]; totalCount?: number };
  return { rows: body.data ?? [], total: body.totalCount ?? 0 };
}

/**
 * A page that comes back empty is not the end of the data.
 *
 * Measured against this endpoint: page 13 returned nothing while pages 12 and
 * 14 both returned a full 5,000, and page 180 was still serving rows. Taking
 * the first empty page as the end stopped an import at 60,000 of 910,000 -
 * with 북한산 among what was missed - and it looked like a clean finish.
 */
async function fetchPageWithRetry(key: string, page: number) {
  const first = await fetchPage(key, page);
  if (first.rows.length > 0) return first;

  // The same offset, asked for in smaller pieces. Page 13 of 5,000 is reliably
  // empty while the rows either side of it are not, so the gap is in how the
  // service slices this offset rather than in the data - and asking for it a
  // thousand at a time gets most of it back.
  const offset = (page - 1) * PAGE_SIZE;
  const recovered: Row[] = [];
  for (let i = 0; i < PAGE_SIZE / SMALL_PAGE; i++) {
    const small = await fetchPage(key, offset / SMALL_PAGE + i + 1, SMALL_PAGE);
    recovered.push(...small.rows);
  }
  return { rows: recovered, total: first.total };
}

/** Keeps the shape, drops the survey detail. Ends are always kept. */
function thin(points: [number, number][]): [number, number][] {
  if (points.length <= 2) return points;
  const kept: [number, number][] = [points[0]];
  for (const point of points.slice(1, -1)) {
    const last = kept[kept.length - 1];
    const gap = haversineDistanceMeters(
      { lat: last[0], lng: last[1] },
      { lat: point[0], lng: point[1] },
    );
    if (gap >= MIN_SPACING_M) kept.push(point);
  }
  kept.push(points[points.length - 1]);
  return kept;
}

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const limitArg = args.indexOf("--limit");
const maxPages = limitArg >= 0 ? Number(args[limitArg + 1]) : Infinity;

const key = env("DATA_GO_KR_PARK_KEY");

// Courses are accumulated across pages: a single course runs past 1,000 points
// and therefore spans several of them.
const courses = new Map<string, { name: string | null; points: [number, number][] }>();
let page = 1;
let total = Infinity;
let seen = 0;
let empties = 0;
for (;;) {
  if (page > maxPages) break;
  // Bounded by the row count the API reports rather than by the first gap in
  // it, so a flaky page costs a retry instead of most of the country.
  if (seen >= total) break;
  const { rows, total: reported } = await fetchPageWithRetry(key, page);
  if (reported > 0) total = reported;
  if (rows.length === 0) {
    // Skipped, not stopped: pages further on still hold data, and treating the
    // first gap as the end is what cut an earlier run off at 60,000 of 910,000.
    console.log(`  ${page}페이지는 비어 있어 건너뜁니다 (${seen}/${total})`);
    empties++;
    if (empties > 8) break;
    page++;
    continue;
  }
  empties = 0;
  seen += rows.length;
  for (const row of rows) {
    const lat = Number(row["위도"]);
    const lng = Number(row["경도"]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const id = String(row["코스ID"] ?? "");
    const course = courses.get(id) ?? { name: row["탐방코스(한글)"] ?? null, points: [] };
    course.points.push([lat, lng]);
    courses.set(id, course);
  }
  if (page % 20 === 0) console.log(`  ${page}페이지 · ${seen}/${total} · 코스 ${courses.size}개`);
  page++;
}

const lines: TrailSegment[] = [];
for (const course of courses.values()) {
  const points = thin(course.points);
  if (points.length < 2) continue;
  lines.push({ id: 0, name: course.name, kind: "path", points });
}

/**
 * A published course is not always one continuous line.
 *
 * Several of them concatenate pieces that are nowhere near each other, and the
 * jump between two pieces is a straight edge hundreds of kilometres long. The
 * tiler walks along every edge so a sparse road cannot cross a tile unnoticed,
 * which turns one of those jumps into a stripe of tiles painted across the
 * country: 111 courses produced 17,155 tiles, and the upload died of a
 * statement timeout at the 310th.
 *
 * Splitting here rather than at read time means what we store is already the
 * geometry the router wants, and every reader gets it without repeating the work.
 */
let nextId = ID_OFFSET;
const segments: TrailSegment[] = splitSurveyGaps(lines).map((segment) => ({ ...segment, id: nextId++ }));

const rawPoints = [...courses.values()].reduce((n, c) => n + c.points.length, 0);
const keptPoints = segments.reduce((n, s) => n + s.points.length, 0);
console.log(`코스 ${lines.length}개 -> 구간 ${segments.length}개 · 좌표 ${rawPoints} -> ${keptPoints} (${MIN_SPACING_M}m 간격으로 정리)`);

const byTile = groupSegmentsByTile(segments);
console.log(`타일 ${byTile.size}개`);

if (dryRun) {
  const lats = segments.flatMap((s) => s.points.map(([lat]) => lat));
  const lngs = segments.flatMap((s) => s.points.map(([, lng]) => lng));
  console.log(`위도 ${Math.min(...lats).toFixed(3)}~${Math.max(...lats).toFixed(3)} · 경도 ${Math.min(...lngs).toFixed(3)}~${Math.max(...lngs).toFixed(3)}`);
  console.log("시험 모드이므로 저장하지 않았습니다.");
  process.exit(0);
}

const url = env("NEXT_PUBLIC_SUPABASE_URL");
const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
const rows = [...byTile].map(([tile_key, tileSegments]) => ({
  tile_key,
  source: "park",
  segments: tileSegments,
}));

// Ten at a time. A hundred tiles of trail geometry is several megabytes and
// PostgREST answered 502 to it; the whole upload is idempotent, so the cost of
// a small batch is a few more requests and nothing else.
const BATCH = 10;
for (let i = 0; i < rows.length; i += BATCH) {
  const batch = rows.slice(i, i + BATCH);
  let sent = false;
  for (let attempt = 0; attempt < 4 && !sent; attempt++) {
    const response = await fetch(`${url}/rest/v1/official_trails?on_conflict=tile_key,source`, {
      method: "POST",
      headers: {
        apikey: serviceKey,
        authorization: `Bearer ${serviceKey}`,
        "content-type": "application/json",
        prefer: "resolution=merge-duplicates",
      },
      body: JSON.stringify(batch),
    });
    if (response.ok) {
      sent = true;
      break;
    }
    const detail = (await response.text()).slice(0, 200);
    if (attempt === 3) throw new Error(`업로드 실패 (${response.status}): ${detail}`);
    await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
  }
  if ((i / BATCH) % 10 === 0 || i + BATCH >= rows.length) {
    console.log(`  ${Math.min(i + BATCH, rows.length)}/${rows.length} 타일`);
  }
}
console.log("완료");
