/**
 * 경유지 "비둘기샘" 을 지운다.
 *
 *   node scripts/remove-bidulgisaem.mts --dry
 *   node scripts/remove-bidulgisaem.mts --apply
 *
 * origin=search 인 두 어프로치 코스가 들고 있던 이름인데, 부원이 모르는 이름이다.
 * 클럽에서 쓰는 말은 "비둘기길"(등반 루트) 과 "비둘기하강"(하강 포인트) 이고,
 * 그 둘은 어프로치 경유지가 아니라 인수봉에 붙는 루트다. 같은 검색이 만든 다른
 * 어프로치 두 행에는 이 이름이 아예 없다는 것도 근거다 — 검색이 스스로 모순됐다.
 *
 * 지우기 전 값을 파일로 남긴다. 되돌려야 할 때 쓰라고.
 */
import { readFileSync, writeFileSync } from "node:fs";

const apply = process.argv.includes("--apply");
if (!apply && !process.argv.includes("--dry")) {
  console.log("--dry 또는 --apply 를 붙여주세요.");
  process.exit(1);
}

function env(name: string): string {
  const m = readFileSync(".env.local", "utf8").match(new RegExp(`^${name}=(.*)$`, "m"));
  const v = m?.[1]?.trim().replace(/^["']|["']$/g, "");
  if (!v) throw new Error(`${name} is not set in .env.local`);
  return v;
}
const url = env("NEXT_PUBLIC_SUPABASE_URL");
const key = env("SUPABASE_SERVICE_ROLE_KEY");
const headers = { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" };

const TARGET = "비둘기샘";

interface Course { id: string; name: string; origin: string | null; waypoints: string[] | null }
interface Hike { id: string; title: string; route_waypoints: { name: string; lat: number; lng: number }[] | null }

const courses = (await (await fetch(
  `${url}/rest/v1/course_library?select=id,name,origin,waypoints`, { headers },
)).json() as Course[]).filter((c) => (c.waypoints ?? []).includes(TARGET));

const hikes = (await (await fetch(
  `${url}/rest/v1/hikes?select=id,title,route_waypoints`, { headers },
)).json() as Hike[]).filter((h) => (h.route_waypoints ?? []).some((p) => p.name === TARGET));

console.log(`course_library ${courses.length}행 · hikes(앨범) ${hikes.length}행에서 '${TARGET}' 발견\n`);

for (const c of courses) {
  console.log(`  [${c.origin}] ${c.name}`);
  console.log(`      전: ${(c.waypoints ?? []).join(" → ")}`);
  console.log(`      후: ${(c.waypoints ?? []).filter((w) => w !== TARGET).join(" → ")}`);
}
for (const h of hikes) {
  console.log(`  [앨범] ${h.title}`);
  console.log(`      전: ${(h.route_waypoints ?? []).map((p) => p.name).join(" → ")}`);
  console.log(`      후: ${(h.route_waypoints ?? []).filter((p) => p.name !== TARGET).map((p) => p.name).join(" → ")}`);
}

if (!apply) {
  console.log("\n--dry 라서 아무것도 바꾸지 않았습니다. 적용하려면 --apply.");
  process.exit(0);
}

if (courses.length + hikes.length === 0) {
  console.log("\n바꿀 것이 없습니다.");
  process.exit(0);
}

const backup = `scripts/_backup-bidulgisaem-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
writeFileSync(backup, JSON.stringify({ courses, hikes }, null, 2), "utf8");
console.log(`\n되돌릴 값을 ${backup} 에 남겼습니다.`);

for (const c of courses) {
  const next = (c.waypoints ?? []).filter((w) => w !== TARGET);
  const res = await fetch(`${url}/rest/v1/course_library?id=eq.${c.id}`, {
    method: "PATCH", headers, body: JSON.stringify({ waypoints: next }),
  });
  console.log(`  course_library ${c.id} → ${res.ok ? "완료" : `실패 ${res.status} ${await res.text()}`}`);
}
for (const h of hikes) {
  const next = (h.route_waypoints ?? []).filter((p) => p.name !== TARGET);
  const res = await fetch(`${url}/rest/v1/hikes?id=eq.${h.id}`, {
    method: "PATCH", headers, body: JSON.stringify({ route_waypoints: next.length ? next : null }),
  });
  console.log(`  hikes ${h.id} → ${res.ok ? "완료" : `실패 ${res.status} ${await res.text()}`}`);
}
