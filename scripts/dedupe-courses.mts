/**
 * Merges courses that are one course under several names.
 *
 *   node scripts/dedupe-courses.mts [--dry-run]
 *
 * Each search names the same way up a mountain slightly differently -
 * 북한산성-백운대-도선사 코스, the same again as 종주 코스, and once more with
 * "(서울 도봉/고양시 기준)" after it - so the library grows three rows where
 * the club walks one route.
 *
 * Names are no help in telling them apart, which is the whole problem. What
 * decides it is where a course starts, where it ends and what it goes over:
 * two courses from the same trailhead to the same gate by way of the same
 * ridge are one course, and two from 정릉탐방지원센터 to 도선사 that differ
 * over 보국문 and 칼바위능선 are not, however alike their names look.
 */
import { readFileSync } from "node:fs";
import { findClubPoi, isUsableWaypoint, normalisePoiName, type ClubPoi } from "../src/lib/routes/poi.ts";
import { dropOutlierWaypoints, snapRouteToTrails } from "../src/lib/routes/snap.ts";
import { mergeTileSegments, tilesForBounds } from "../src/lib/routes/tiles.ts";
import { splitSurveyGaps, type TrailSegment } from "../src/lib/routes/trails.ts";
import { haversineDistanceMeters } from "../src/lib/gps/haversine.ts";
import type { TrackPoint } from "../src/lib/gps/track.ts";


/**
 * Where names alone settle it, and where the ground has to be asked.
 *
 * Comparing the names of the places two courses pass is cheap and right at
 * both extremes: share nearly all of them and it is one course, share almost
 * none and it is not. In between it cannot tell 숨은벽능선 from 숨은벽전망대 -
 * one ridge described from two angles - without a rule about shared opening
 * characters, and that rule says 백운산장 and 백운봉암문 are the same place as
 * readily, which they are not: a hut and a gate.
 *
 * So the middle is decided by drawing both courses and measuring how much of
 * one lies on the other. The names are a filter; the line is the answer.
 */
const CLEARLY_SAME = 0.8;
const CLEARLY_DIFFERENT = 0.3;

/** Two lines this close are on the same trail; wider is a parallel path. */
const ON_THE_SAME_LINE_M = 40;
/**
 * How much of the shorter line has to lie on the longer before they are one.
 *
 * The shorter one, not both. Two descriptions of a route rarely stop in the
 * same place: 밤골-숨은벽-백운대-도선사 lists six points and the same walk as
 * 숨은벽능선-백운대-도선사 lists eight, carrying on past 백운산장 and 하루재.
 * 93% of the first lies on the second and 58% of the second on the first, and
 * requiring both kept them apart - the same course written in more detail.
 *
 * Safe because only courses that start and end in the same places are compared
 * at all, so one line lying on another is the same route described twice
 * rather than a short walk swallowed by a long traverse.
 */
const LINE_OVERLAP = 0.7;

function env(name: string): string {
  const match = readFileSync(".env.local", "utf8").match(new RegExp(`^${name}=(.*)$`, "m"));
  const value = match?.[1]?.trim().replace(/^["']|["']$/g, "");
  if (!value) throw new Error(`${name} is not set in .env.local`);
  return value;
}

const url = env("NEXT_PUBLIC_SUPABASE_URL");
const key = env("SUPABASE_SERVICE_ROLE_KEY");
const headers = { apikey: key, authorization: `Bearer ${key}` };
const dryRun = process.argv.includes("--dry-run");

interface Course {
  id: string;
  mountain: string;
  name: string;
  waypoints: string[];
  distance_text: string | null;
  duration_text: string | null;
  difficulty: string | null;
  description: string | null;
  notes: string | null;
  sources: string[];
  origin: string;
}

const pois = await (async () => {
  const response = await fetch(`${url}/rest/v1/route_pois?select=name,aliases,lat,lng`, { headers });
  return response.ok ? await response.json() as ClubPoi[] : [];
})();

/**
 * Every name one waypoint answers to.
 *
 * A bracketed name carries two - 백운대탐방지원센터(도선사) is both - and the
 * club's gazetteer supplies the rest, which is how 밤골탐방지원센터 and
 * 밤골공원지킴터 are recognised as the trailhead they both are.
 *
 * Deliberately not substring matching: 백운대 is inside 백운대탐방지원센터 and
 * they are a summit and a visitor centre two kilometres apart.
 */
function namesOf(waypoint: string): Set<string> {
  const parts = [waypoint.replace(/[（([][^)\]）]*[)\]）]/g, " ")];
  for (const [, inner] of waypoint.matchAll(/[（([]([^)\]）]*)[)\]）]/g)) parts.push(inner);
  const out = new Set<string>();
  for (const part of parts) {
    const key = normalisePoiName(part);
    if (!key) continue;
    out.add(key);
    for (const poi of pois) {
      const family = [poi.name, ...poi.aliases].map(normalisePoiName);
      if (family.includes(key)) for (const name of family) out.add(name);
    }
  }
  return out;
}

const samePlace = (a: string, b: string) => {
  const left = namesOf(a);
  for (const name of namesOf(b)) if (left.has(name)) return true;
  return false;
};

/** Every place a course passes, as a set of canonical names. */
function middleOf(course: Course): Set<string> {
  const out = new Set<string>();
  for (const waypoint of course.waypoints.slice(1, -1)) {
    for (const name of namesOf(waypoint)) out.add(name);
  }
  return out;
}

/** How much of the places they pass two courses have in common, by name. */
function nameOverlap(a: Course, b: Course): number {
  const left = middleOf(a);
  const right = middleOf(b);
  if (left.size === 0 || right.size === 0) return 1;
  let shared = 0;
  for (const name of left) if (right.has(name)) shared++;
  return shared / (left.size + right.size - shared);
}

const mapsKey = env("NEXT_PUBLIC_GOOGLE_MAPS_API_KEY");

async function placeOf(name: string, mountain: string, centre: TrackPoint): Promise<TrackPoint | null> {
  const known = findClubPoi(name, pois);
  if (known) return [known.lat, known.lng];
  for (const query of [`${mountain} ${name}`, name]) {
    const response = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Goog-Api-Key": mapsKey,
        referer: "https://khuac.com/",
        "X-Goog-FieldMask": "places.displayName,places.location,places.types",
      },
      body: JSON.stringify({
        textQuery: query, languageCode: "ko", regionCode: "KR", maxResultCount: 5,
        locationBias: { circle: { center: { latitude: centre[0], longitude: centre[1] }, radius: 20000 } },
      }),
    });
    const body = await response.json() as {
      places?: { displayName: { text: string }; location: { latitude: number; longitude: number }; types: string[] }[];
    };
    const found = (body.places ?? []).find((p) =>
      isUsableWaypoint(name, p.displayName.text, p.types ?? [], mountain));
    if (found) return [found.location.latitude, found.location.longitude];
  }
  return null;
}

/** The line a course actually draws, or null when too little of it can be placed. */
const drawn = new Map<string, TrackPoint[] | null>();
async function lineOf(course: Course, centre: TrackPoint): Promise<TrackPoint[] | null> {
  const cached = drawn.get(course.id);
  if (cached !== undefined) return cached;

  const points: { name: string; lat: number; lng: number }[] = [];
  for (const waypoint of course.waypoints) {
    const found = await placeOf(waypoint, course.mountain, centre);
    if (found) points.push({ name: waypoint, lat: found[0], lng: found[1] });
  }
  const kept = dropOutlierWaypoints(points);
  if (kept.length < 2) {
    drawn.set(course.id, null);
    return null;
  }

  const lats = kept.map((p) => p.lat);
  const lngs = kept.map((p) => p.lng);
  const keys = tilesForBounds({
    south: Math.min(...lats) - 0.02, west: Math.min(...lngs) - 0.02,
    north: Math.max(...lats) + 0.02, east: Math.max(...lngs) + 0.02,
  });
  const list = keys.map((k) => `"${k}"`).join(",");
  const [osm, official] = await Promise.all(["trail_tiles", "official_trails"].map(async (table) => {
    const response = await fetch(
      `${url}/rest/v1/${table}?select=segments&tile_key=in.(${encodeURIComponent(list)})`, { headers });
    if (!response.ok) throw new Error(`${table}: ${response.status}`);
    return ((await response.json()) as { segments: TrailSegment[] }[]).map((row) => row.segments ?? []);
  }));
  const segments = mergeTileSegments([mergeTileSegments(osm), splitSurveyGaps(mergeTileSegments(official))]);
  const line = snapRouteToTrails(kept, segments).flatMap((leg) => leg.points);
  const result = line.length >= 2 ? line : null;
  drawn.set(course.id, result);
  return result;
}

const metres = (a: TrackPoint, b: TrackPoint) =>
  haversineDistanceMeters({ lat: a[0], lng: a[1] }, { lat: b[0], lng: b[1] });

/** What fraction of one line lies on the other. */
function covered(line: TrackPoint[], other: TrackPoint[]): number {
  const cell = ON_THE_SAME_LINE_M / 111_320;
  const grid = new Map<string, TrackPoint[]>();
  for (const point of other) {
    const k = `${Math.floor(point[0] / cell)}:${Math.floor(point[1] / cell)}`;
    const bucket = grid.get(k);
    if (bucket) bucket.push(point); else grid.set(k, [point]);
  }
  let hit = 0;
  for (const point of line) {
    const y = Math.floor(point[0] / cell);
    const x = Math.floor(point[1] / cell);
    let near = false;
    for (let dy = -1; dy <= 1 && !near; dy++) {
      for (let dx = -1; dx <= 1 && !near; dx++) {
        for (const candidate of grid.get(`${y + dy}:${x + dx}`) ?? []) {
          if (metres(candidate, point) <= ON_THE_SAME_LINE_M) { near = true; break; }
        }
      }
    }
    if (near) hit++;
  }
  return hit / line.length;
}

async function sameCourse(a: Course, b: Course, centre: TrackPoint): Promise<boolean> {
  if (a.waypoints.length < 2 || b.waypoints.length < 2) return false;
  if (!samePlace(a.waypoints[0], b.waypoints[0])) return false;
  if (!samePlace(a.waypoints[a.waypoints.length - 1], b.waypoints[b.waypoints.length - 1])) return false;

  const byName = nameOverlap(a, b);
  if (byName >= CLEARLY_SAME) return true;
  if (byName < CLEARLY_DIFFERENT) return false;

  // Neither obviously the same nor obviously not. Draw them and look.
  const [left, right] = await Promise.all([lineOf(a, centre), lineOf(b, centre)]);
  if (!left || !right) return false;
  const forward = covered(left, right);
  const back = covered(right, left);
  console.log(`   비교: ${a.name} ↔ ${b.name} · 이름 ${(byName * 100).toFixed(0)}% · 선 ${(forward * 100).toFixed(0)}%/${(back * 100).toFixed(0)}%`);
  return Math.max(forward, back) >= LINE_OVERLAP;
}

const courses = await (async () => {
  const response = await fetch(`${url}/rest/v1/course_library?select=*&order=mountain,name`, { headers });
  if (!response.ok) throw new Error(`course_library: ${response.status}`);
  return await response.json() as Course[];
})();
console.log(`코스 ${courses.length}개`);

const centres = new Map<string, TrackPoint>();
for (const mountain of new Set(courses.map((c) => c.mountain))) {
  centres.set(mountain, await placeOf(mountain, mountain, [37.6, 127.0]) ?? [37.6, 127.0]);
}

const groups: Course[][] = [];
for (const course of courses) {
  let placed = false;
  for (const group of groups) {
    if (group[0].mountain !== course.mountain) continue;
    const centre = centres.get(course.mountain)!;
    for (const member of group) {
      if (await sameCourse(member, course, centre)) {
        group.push(course);
        placed = true;
        break;
      }
    }
    if (placed) break;
  }
  if (!placed) groups.push([course]);
}

const merged = groups.filter((group) => group.length > 1);
if (merged.length === 0) {
  console.log("합칠 코스가 없습니다.");
  process.exit(0);
}

const first = <T>(values: (T | null)[]) => values.find((value) => value !== null && value !== undefined) ?? null;
const keepers: { keep: Course; drop: Course[] }[] = [];
for (const group of merged) {
  // The fullest description of the route wins its name and its shape; the
  // others only fill in what it happens to be missing.
  const sorted = [...group].sort((a, b) => b.waypoints.length - a.waypoints.length);
  const [keep, ...drop] = sorted;
  keep.distance_text = first(sorted.map((c) => c.distance_text));
  keep.duration_text = first(sorted.map((c) => c.duration_text));
  keep.difficulty = first(sorted.map((c) => c.difficulty));
  keep.description = first(sorted.map((c) => c.description));
  keep.notes = first(sorted.map((c) => c.notes));
  keep.sources = [...new Set(sorted.flatMap((c) => c.sources))];
  keepers.push({ keep, drop });
  console.log(`\n[${keep.mountain}] 남김: ${keep.name}`);
  console.log(`   ${keep.waypoints.join(" → ")}`);
  for (const gone of drop) console.log(`   합침: ${gone.name} (${gone.waypoints.length}개 경유지)`);
}

if (dryRun) {
  console.log("\n시험 모드이므로 저장하지 않았습니다.");
  process.exit(0);
}

for (const { keep, drop } of keepers) {
  const update = await fetch(`${url}/rest/v1/course_library?id=eq.${keep.id}`, {
    method: "PATCH",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({
      distance_text: keep.distance_text,
      duration_text: keep.duration_text,
      difficulty: keep.difficulty,
      description: keep.description,
      notes: keep.notes,
      sources: keep.sources,
      updated_at: new Date().toISOString(),
    }),
  });
  if (!update.ok) throw new Error(`${keep.name} 갱신 실패 (${update.status})`);
  for (const gone of drop) {
    const remove = await fetch(`${url}/rest/v1/course_library?id=eq.${gone.id}`, { method: "DELETE", headers });
    if (!remove.ok) throw new Error(`${gone.name} 삭제 실패 (${remove.status})`);
  }
}
console.log(`\n${keepers.reduce((n, k) => n + k.drop.length, 0)}개 합쳐 ${courses.length - keepers.reduce((n, k) => n + k.drop.length, 0)}개 남았습니다`);
