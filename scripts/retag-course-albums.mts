/**
 * Files albums made from a course by what the course actually is.
 *
 *   node scripts/retag-course-albums.mts [--dry-run]
 *
 * An album built from a suggested course was filed as 산 whatever the course
 * was, so 인수봉 고독길 어프로치 - a walk in to the foot of a rock route - sat
 * in the hiking folder beside the trails to 백운대. New albums are filed by
 * what they are now; these were made before that and are re-read here with the
 * same rule.
 *
 * Only albums that name a course. An album a member made by hand carries
 * whatever they chose, and a script has no business second-guessing it.
 */
import { readFileSync } from "node:fs";
import { ACTIVITY_LABEL, activityForCourse } from "../src/app/map/activity.ts";

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

interface Row {
  id: string;
  title: string;
  description: string | null;
  activity_type: string;
  route_waypoints: { name?: string }[] | null;
}

const rows = await (await fetch(
  `${url}/rest/v1/hikes?select=id,title,description,activity_type,route_waypoints`
  + `&description=ilike.*AI 추천 코스*`,
  { headers },
)).json() as Row[];

console.log(`코스로 만든 앨범 ${rows.length}개`);
for (const row of rows) {
  const names = (row.route_waypoints ?? []).map((point) => point?.name ?? "").join(" ");
  const should = activityForCourse(row.title, row.description, names);
  const now = row.activity_type;
  if (should === now) {
    console.log(`  그대로 · ${row.title.slice(0, 40)} (${ACTIVITY_LABEL[now as never]})`);
    continue;
  }
  console.log(`  바꿈  · ${row.title.slice(0, 40)}`);
  console.log(`          ${ACTIVITY_LABEL[now as never]} → ${ACTIVITY_LABEL[should]}`);
  if (dryRun) continue;
  const write = await fetch(`${url}/rest/v1/hikes?id=eq.${row.id}`, {
    method: "PATCH",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({ activity_type: should }),
  });
  if (!write.ok) throw new Error(`${row.title} 저장 실패 (${write.status}): ${(await write.text()).slice(0, 200)}`);
}
console.log(dryRun ? "시험 모드이므로 저장하지 않았습니다." : "완료");
