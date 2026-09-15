/**
 * Moves the courses already searched for into the library.
 *
 *   node scripts/harvest-courses.mts [--dry-run]
 *
 * Every route question paid for a grounded web search - 26.7 seconds and 16
 * sources for one answer - and the answers are sitting in assistant_cache,
 * keyed by the question that was typed. That key is why the cost repeats:
 * "북한산 코스 추천" and "도선사로 하산하는 코스" are different questions with
 * the same courses behind them.
 *
 * Filed by mountain instead, they answer both. This reads what we have already
 * paid for and files it, so the library starts with everything the club has
 * asked about rather than empty.
 */
import { readFileSync } from "node:fs";

interface CachedRoute {
  name?: unknown;
  waypoints?: unknown;
  distanceText?: unknown;
  durationText?: unknown;
  difficulty?: unknown;
  description?: unknown;
  notes?: unknown;
  sourceUrls?: unknown;
}

interface CachedAnswer {
  routes?: CachedRoute[];
  routePlaceName?: unknown;
  place?: { name?: unknown } | null;
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

const text = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim() : null;

/** The mountains the club has folders for, used to read one out of a question. */
const known: string[] = await (async () => {
  const response = await fetch(`${url}/rest/v1/locations?select=name&type=eq.mountain`, { headers });
  if (!response.ok) return [];
  return ((await response.json()) as { name: string }[]).map((row) => row.name);
})();

const rows = await (async () => {
  const response = await fetch(
    `${url}/rest/v1/assistant_cache?select=question,answer,created_at&order=created_at.desc`,
    { headers },
  );
  if (!response.ok) throw new Error(`assistant_cache: ${response.status}`);
  return await response.json() as { question: string; answer: CachedAnswer; created_at: string }[];
})();

const courses = new Map<string, Record<string, unknown>>();
for (const row of rows) {
  const answer = row.answer ?? {};
  // The mountain the courses belong to, which is the whole point of filing
  // them: a question that never names it is answered by the same rows.
  // Named by the answer where it named one; otherwise read out of the
  // question, which is how "도봉산 등반 루트" files itself. An answer covering
  // several mountains at once names none of them and is left alone rather than
  // filed under whichever was mentioned first.
  const mountain = text(answer.routePlaceName)
    ?? text(answer.place?.name)
    ?? known.find((name) => row.question.includes(name))
    ?? null;
  if (!mountain || !Array.isArray(answer.routes)) continue;

  for (const route of answer.routes) {
    const name = text(route.name);
    if (!name) continue;
    const waypoints = Array.isArray(route.waypoints)
      ? route.waypoints.flatMap((w) => text(w) ? [text(w)!] : [])
      : [];
    // Newest first out of the query, so the first sighting of a course is the
    // freshest and later ones are not allowed to overwrite it.
    const slot = `${mountain.toLowerCase()}|${name.toLowerCase()}`;
    if (courses.has(slot)) continue;
    courses.set(slot, {
      mountain,
      name,
      waypoints,
      distance_text: text(route.distanceText),
      duration_text: text(route.durationText),
      difficulty: text(route.difficulty),
      description: text(route.description),
      notes: text(route.notes),
      sources: Array.isArray(route.sourceUrls) ? route.sourceUrls : [],
      origin: "search",
    });
  }
}

const byMountain = new Map<string, number>();
for (const course of courses.values()) {
  const mountain = course.mountain as string;
  byMountain.set(mountain, (byMountain.get(mountain) ?? 0) + 1);
}
console.log(`캐시 ${rows.length}건에서 코스 ${courses.size}개`);
for (const [mountain, count] of [...byMountain].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${mountain}: ${count}개`);
}

if (courses.size === 0 || dryRun) {
  console.log(dryRun ? "시험 모드이므로 저장하지 않았습니다." : "저장할 코스가 없습니다.");
  process.exit(0);
}

const list = [...courses.values()];
for (let i = 0; i < list.length; i += 20) {
  const response = await fetch(`${url}/rest/v1/course_library?on_conflict=mountain,name`, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json", prefer: "resolution=merge-duplicates" },
    body: JSON.stringify(list.slice(i, i + 20)),
  });
  if (!response.ok) {
    throw new Error(`저장 실패 (${response.status}): ${(await response.text()).slice(0, 300)}`);
  }
}
console.log(`${list.length}개 저장 완료`);
