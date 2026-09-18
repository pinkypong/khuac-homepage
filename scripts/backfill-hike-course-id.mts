/**
 * Points albums already made from a course at the course they were made from.
 *
 *   node scripts/backfill-hike-course-id.mts [--apply]
 *
 * course_id was added after these albums existed. What identifies them is the
 * pair the library itself is keyed on: the album's title is the course's name
 * and its folder is the mountain. Only albums that carry course_info are
 * considered - that column is written by the one action that makes an album
 * from a course, so its presence is the evidence the album came from one.
 *
 * Exact pairs only. A near-match would be a guess, and a wrong link shows a
 * member somebody else's walk as a record of this one.
 */
import { readFileSync } from "node:fs";
function env(n: string) { const m = readFileSync(".env.local","utf8").match(new RegExp(`^${n}=(.*)$`,"m")); const v=m?.[1]?.trim().replace(/^["']|["']$/g,""); if(!v) throw new Error(`${n} is not set in .env.local`); return /%[0-9A-Fa-f]{2}/.test(v)?decodeURIComponent(v):v; }
const url = env("NEXT_PUBLIC_SUPABASE_URL"), key = env("SUPABASE_SERVICE_ROLE_KEY");
const headers = { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" };
const apply = process.argv.includes("--apply");

interface HikeRow {
  id: string;
  title: string | null;
  course_id: string | null;
  course_info: unknown;
  locations: { name: string } | null;
}
interface CourseRow { id: string; mountain: string; name: string }

const get = async <T,>(path: string): Promise<T[]> => {
  const r = await fetch(`${url}/rest/v1/${path}`, { headers });
  if (!r.ok) throw new Error(`${path}: ${r.status} ${(await r.text()).slice(0, 200)}`);
  return (await r.json()) as T[];
};

const hikes = await get<HikeRow>("hikes?select=id,title,course_id,course_info,location_id,locations(name)&limit=2000");
const courses = await get<CourseRow>("course_library?select=id,mountain,name&limit=2000");
const pair = (m: string, n: string) => JSON.stringify([m.trim().toLowerCase(), n.trim().toLowerCase()]);
const byPair = new Map(courses.map((c) => [pair(c.mountain, c.name), c.id]));

const fromCourse = hikes.filter((h) => h.course_info);
const plan: { id: string; course: string; label: string }[] = [];
for (const h of fromCourse) {
  if (h.course_id) continue;
  const mountain = h.locations?.name;
  if (!mountain || !h.title) continue;
  const id = byPair.get(pair(mountain, h.title));
  if (id) plan.push({ id: h.id, course: id, label: `${mountain} / ${h.title}` });
}
console.log(`앨범 ${hikes.length}개 중 코스로 만든 것 ${fromCourse.length}개`);
console.log(`이미 연결됨 ${fromCourse.filter((h) => h.course_id).length}개`);
console.log(`이름·산이 정확히 맞는 것 ${plan.length}개`);
for (const p of plan) console.log(`  ${p.label}`);
const unmatched = fromCourse.filter((h) => !h.course_id && !plan.some((p) => p.id === h.id));
if (unmatched.length) {
  console.log(`\n맞는 코스가 없는 앨범 ${unmatched.length}개 (그대로 null 로 둡니다):`);
  for (const h of unmatched.slice(0, 15)) console.log(`  ${h.locations?.name ?? "?"} / ${h.title}`);
}
if (!apply) { console.log("\n--apply 를 주면 저장합니다."); process.exit(0); }
for (const p of plan) {
  const r = await fetch(`${url}/rest/v1/hikes?id=eq.${p.id}`, { method: "PATCH", headers, body: JSON.stringify({ course_id: p.course }) });
  if (!r.ok) throw new Error(`${p.label}: ${r.status} ${(await r.text()).slice(0, 200)}`);
  console.log(`  연결 ${p.label}`);
}
console.log("완료");
