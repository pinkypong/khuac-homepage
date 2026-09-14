/**
 * Loads an official Korean trail file into public.official_trails.
 *
 *   node scripts/import-official-trails.mts <forest|park> <file.geojson ...>
 *
 * Run once per published file, not on a schedule: 산림청 and 국립공원공단 put
 * these out as downloads a few times a year, and a Worker that needs no
 * external service to draw a route is the point of importing them at all.
 *
 * Accepts GeoJSON (FeatureCollection) with LineString or MultiLineString
 * geometry - the shape both agencies publish alongside their shapefiles.
 * Coordinates must be WGS84 lon/lat, which is what their GeoJSON exports use;
 * a shapefile in EPSG:5186 has to be reprojected before it gets here.
 *
 * Type stripping means this imports the real tiling code rather than a copy of
 * it, so the grid can never drift from what the app reads.
 */
import { readFileSync } from "node:fs";
import { groupSegmentsByTile } from "../src/lib/routes/tiles.ts";
import type { TrailSegment } from "../src/lib/routes/trails.ts";

type Source = "forest" | "park";

interface Feature {
  type: string;
  properties?: Record<string, unknown>;
  geometry?: { type: string; coordinates: unknown } | null;
}

/** Their files disagree on what the name column is called. */
const NAME_KEYS = ["MNTN_NM", "PMNTN_NM", "NAME", "name", "TRL_NM", "SEC_NM", "FRTP_NM"];

function nameOf(properties: Record<string, unknown> | undefined): string | null {
  if (!properties) return null;
  for (const key of NAME_KEYS) {
    const value = properties[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

/** [lon, lat] pairs as GeoJSON stores them, into our [lat, lng]. */
function toPoints(line: unknown): [number, number][] {
  if (!Array.isArray(line)) return [];
  return line.flatMap((pair) => {
    if (!Array.isArray(pair) || pair.length < 2) return [];
    const [lng, lat] = pair as number[];
    return Number.isFinite(lat) && Number.isFinite(lng) ? [[lat, lng] as [number, number]] : [];
  });
}

function segmentsFrom(features: Feature[], startId: number): TrailSegment[] {
  const segments: TrailSegment[] = [];
  let id = startId;
  for (const feature of features) {
    const geometry = feature.geometry;
    if (!geometry) continue;
    const lines =
      geometry.type === "LineString"
        ? [geometry.coordinates]
        : geometry.type === "MultiLineString"
          ? (geometry.coordinates as unknown[])
          : [];
    for (const line of lines) {
      const points = toPoints(line);
      // A single point is not a path; two is the minimum that can be walked.
      if (points.length < 2) continue;
      segments.push({ id: id++, name: nameOf(feature.properties), kind: "path", points });
    }
  }
  return segments;
}

function env(name: string): string {
  const line = readFileSync(".env.local", "utf8").match(new RegExp(`^${name}=(.*)$`, "m"));
  const value = line?.[1]?.trim().replace(/^["']|["']$/g, "");
  if (!value) throw new Error(`${name} is not set in .env.local`);
  return value;
}

const args = process.argv.slice(2);
// Lets a file be checked - how many paths, how many tiles - before anything is
// written, which is the difference between finding a bad projection now and
// finding it as a route drawn through the Yellow Sea later.
const dryRun = args.includes("--dry-run");
const [source, ...files] = args.filter((a) => a !== "--dry-run") as [Source, ...string[]];
if (source !== "forest" && source !== "park") {
  throw new Error("첫 인자는 forest 또는 park여야 합니다.");
}
if (files.length === 0) throw new Error("가져올 GeoJSON 파일을 지정해주세요.");

// Ids are ours, not theirs: the two agencies number independently and the
// router de-duplicates by id, so an overlap would silently drop real paths.
// The offset keeps each source in its own range, clear of OSM's way ids.
const OFFSET: Record<Source, number> = { forest: 900_000_000, park: 950_000_000 };

let all: TrailSegment[] = [];
for (const file of files) {
  const parsed = JSON.parse(readFileSync(file, "utf8")) as { features?: Feature[] };
  const found = segmentsFrom(parsed.features ?? [], OFFSET[source] + all.length);
  console.log(`${file}: ${found.length} segments`);
  all = all.concat(found);
}

const byTile = groupSegmentsByTile(all);
console.log(`총 ${all.length}개 구간 · ${byTile.size}개 타일`);

if (dryRun) {
  const lats = all.flatMap((s) => s.points.map(([lat]) => lat));
  const lngs = all.flatMap((s) => s.points.map(([, lng]) => lng));
  // Korea is roughly 33-39N, 124-132E. Anything outside that is a shapefile
  // that was never reprojected out of EPSG:5186.
  console.log(`위도 ${Math.min(...lats).toFixed(3)}~${Math.max(...lats).toFixed(3)} · 경도 ${Math.min(...lngs).toFixed(3)}~${Math.max(...lngs).toFixed(3)}`);
  console.log("시험 모드이므로 저장하지 않았습니다.");
  process.exit(0);
}

const url = env("NEXT_PUBLIC_SUPABASE_URL");
const key = env("SUPABASE_SERVICE_ROLE_KEY");
const rows = [...byTile].map(([tile_key, segments]) => ({ tile_key, source, segments }));

// Batched: one request with thousands of tiles is refused, and a failure
// halfway through is recoverable because upsert is idempotent.
for (let i = 0; i < rows.length; i += 200) {
  const batch = rows.slice(i, i + 200);
  const response = await fetch(`${url}/rest/v1/official_trails?on_conflict=tile_key,source`, {
    method: "POST",
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
      prefer: "resolution=merge-duplicates",
    },
    body: JSON.stringify(batch),
  });
  if (!response.ok) {
    throw new Error(`업로드 실패 (${response.status}): ${(await response.text()).slice(0, 300)}`);
  }
  console.log(`  ${Math.min(i + 200, rows.length)}/${rows.length} 타일`);
}
console.log("완료");
