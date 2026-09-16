/**
 * Splits an album's description into the fields it should have been.
 *
 *   node scripts/split-course-descriptions.mts [--dry-run]
 *
 * Albums made from a suggested course kept all of it in one string: the
 * waypoints as a sentence, the distance as prose, the caveats run in after
 * them. The waypoints are dropped rather than parsed - route_waypoints holds
 * the same points with coordinates, and the sentence is the copy worth losing.
 * The rest becomes course_info, and description is left empty for whatever the
 * member wants to say.
 */
import { readFileSync } from "node:fs";
import { courseInfoFromDescription } from "../src/app/map/course-info.ts";

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

const rows = await (await fetch(
  `${url}/rest/v1/hikes?select=id,title,description,course_info&description=ilike.*AI 추천 코스*`,
  { headers },
)).json() as { id: string; title: string; description: string | null; course_info: unknown }[];

console.log(`코스로 만든 앨범 ${rows.length}개`);
for (const row of rows) {
  if (row.course_info) {
    console.log(`  건너뜀 · ${row.title.slice(0, 36)} (이미 나뉘어 있음)`);
    continue;
  }
  const { info, rest } = courseInfoFromDescription(row.description);
  if (!info) {
    console.log(`  건너뜀 · ${row.title.slice(0, 36)} (나눌 것이 없음)`);
    continue;
  }
  console.log(`  나눔  · ${row.title.slice(0, 36)}`);
  if (info.distanceText) console.log(`            거리: ${info.distanceText}`);
  if (info.durationText) console.log(`            소요: ${info.durationText}`);
  if (info.notes) console.log(`            비고: ${info.notes.replace(/\n/g, " / ").slice(0, 70)}`);
  if (dryRun) continue;

  const write = await fetch(`${url}/rest/v1/hikes?id=eq.${row.id}`, {
    method: "PATCH",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({ course_info: info, description: rest }),
  });
  if (!write.ok) throw new Error(`${row.title} 저장 실패 (${write.status}): ${(await write.text()).slice(0, 200)}`);
}
console.log(dryRun ? "시험 모드이므로 저장하지 않았습니다." : "완료");
