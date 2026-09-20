/**
 * What the album route picker would offer for each place the club has.
 *
 *   node scripts/check-location-courses.mts
 *
 * Mirrors coursesForLocation so the rule can be checked against the real
 * library without a browser: courses filed under the place itself, plus - only
 * where the place is not a mountain of its own - the ones that merely lead
 * there, which is how 인수봉 finds the four approaches filed under 북한산.
 */
import { readFileSync } from "node:fs";
import { groupByMountain, placesOf } from "../src/lib/assistant/region.ts";
import { rankOf } from "../src/lib/assistant/origin.ts";
function env(n: string) { const m = readFileSync(".env.local","utf8").match(new RegExp(`^${n}=(.*)$`,"m")); const v=m![1].trim().replace(/^["']|["']$/g,""); return /%[0-9A-Fa-f]{2}/.test(v)?decodeURIComponent(v):v; }
const url = env("NEXT_PUBLIC_SUPABASE_URL"), key = env("SUPABASE_SERVICE_ROLE_KEY");
const h = { apikey: key, authorization: `Bearer ${key}` };
interface Row {
  id: string;
  mountain: string;
  name: string;
  region: string | null;
  origin: string | null;
  waypoints: string[] | null;
  distance_text: string | null;
  duration_text: string | null;
  difficulty: string | null;
}
const all = (await (await fetch(`${url}/rest/v1/course_library?select=id,mountain,name,region,origin,waypoints,distance_text,duration_text,difficulty&limit=2000`, { headers: h })).json()) as Row[];

function coursesFor(name: string, region: string | null) {
  if (name.trim().length < 2) return [];
  const sameName = all.filter((r) => r.mountain === name);
  let direct: Row[] = [];
  if (sameName.length > 0) {
    const groups = groupByMountain(sameName);
    const here = new Set(placesOf(region));
    const picked = groups.length === 1 ? groups[0]
      : (groups.find((g) => [...g.places].some((p) => here.has(p))) ?? null);
    direct = picked ? picked.rows : [];
  }
  const mentions = (r: Row) => r.name.includes(name) || (r.waypoints ?? []).some((p) => p.includes(name));
  const seen = new Set(direct.map((r) => r.id));
  const isKnownMountain = all.some((r) => r.mountain === name);
  const lead = isKnownMountain ? [] : all.filter((r) => !seen.has(r.id) && mentions(r));
  return [...direct, ...lead].sort((a,b) => rankOf(b.origin)-rankOf(a.origin) || a.name.localeCompare(b.name));
}

const PLACES: [string, string][] = [["인수봉","고양시 인수봉"],["북한산","서울"],["관악산","Gwanaksan, Seoul, South Korea"],["지리산","경남/전남"]];
for (const [n, reg] of PLACES) {
  const got = coursesFor(n, reg);
  console.log(`\n### "${n}" → ${got.length}건`);
  for (const c of got.slice(0,5)) console.log(`   [${c.mountain}] ${c.name.slice(0,34)}\n       ${(c.waypoints??[]).join(" → ").slice(0,90)}`);
  if (got.length > 5) console.log(`   … 외 ${got.length-5}건`);
}
