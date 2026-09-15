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
import { normalisePoiName, type ClubPoi } from "../src/lib/routes/poi.ts";

/** How much of the middle two courses must share to be the same course. */
const SAME_MIDDLE = Number(process.env.SAME_MIDDLE ?? 0.6);

/**
 * Two names for one feature share their opening, and three characters is where
 * that starts meaning something.
 *
 * 숨은벽능선 and 숨은벽전망대 are the same ridge described from two angles, and
 * without this the courses over it look half different and stay apart. Two is
 * too few: 백운산장, 백운봉암문 and 백운대 all begin 백운 and are a hut, a gate
 * and a summit.
 */
const STEM = 3;

function sharedStem(a: string, b: string): boolean {
  const limit = Math.min(a.length, b.length);
  let same = 0;
  while (same < limit && a[same] === b[same]) same++;
  return same >= STEM;
}

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

function sameCourse(a: Course, b: Course): boolean {
  if (a.waypoints.length < 2 || b.waypoints.length < 2) return false;
  if (!samePlace(a.waypoints[0], b.waypoints[0])) return false;
  if (!samePlace(a.waypoints[a.waypoints.length - 1], b.waypoints[b.waypoints.length - 1])) return false;
  const left = middleOf(a);
  const right = middleOf(b);
  if (left.size === 0 || right.size === 0) return true;
  let shared = 0;
  for (const name of left) {
    if (right.has(name) || [...right].some((other) => sharedStem(name, other))) shared++;
  }
  return shared / (left.size + right.size - shared) >= SAME_MIDDLE;
}

const courses = await (async () => {
  const response = await fetch(`${url}/rest/v1/course_library?select=*&order=mountain,name`, { headers });
  if (!response.ok) throw new Error(`course_library: ${response.status}`);
  return await response.json() as Course[];
})();
console.log(`코스 ${courses.length}개`);

const groups: Course[][] = [];
for (const course of courses) {
  const found = groups.find((group) =>
    group[0].mountain === course.mountain && group.some((member) => sameCourse(member, course)));
  if (found) found.push(course);
  else groups.push([course]);
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
