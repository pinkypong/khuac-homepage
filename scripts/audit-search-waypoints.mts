/**
 * origin=search 코스의 경유지 이름이 실재하는 지점인지 대조한다.
 *
 *   node scripts/audit-search-waypoints.mts
 *
 * "비둘기샘"이 이렇게 걸렸다. 그럴듯한 이름이라 읽어서는 걸러지지 않는다.
 * 그래서 읽지 말고 대조한다 — 그 이름이 우리가 믿는 출처에도 있는가:
 *
 *   knps/forest 경유지   측량된 코스가 실제로 쓰는 이름
 *   OSM 지명            지도에 등록된 지점
 *
 * 둘 다에 없으면 그 이름은 웹 답변 안에만 존재한다. 그것만으로 틀렸다고
 * 단정하지는 않는다 — 클럽에서만 쓰는 이름일 수도 있다. 사람이 볼 목록을
 * 좁혀주는 것이 이 스크립트가 하는 일의 전부다.
 */
import { readFileSync } from "node:fs";

function env(name: string): string {
  const m = readFileSync(".env.local", "utf8").match(new RegExp(`^${name}=(.*)$`, "m"));
  const v = m?.[1]?.trim().replace(/^["']|["']$/g, "");
  if (!v) throw new Error(`${name} is not set in .env.local`);
  return v;
}
const supabaseUrl = env("NEXT_PUBLIC_SUPABASE_URL");
const key = env("SUPABASE_SERVICE_ROLE_KEY");
const headers = { apikey: key, authorization: `Bearer ${key}` };
const get = async <T>(p: string): Promise<T> =>
  (await (await fetch(`${supabaseUrl}/rest/v1/${p}`, { headers })).json()) as T;

interface Course { id: string; name: string; mountain: string; origin: string | null; waypoints: string[] | null }

const all = await get<Course[]>("course_library?select=id,name,mountain,origin,waypoints");
const search = all.filter((c) => c.origin === "search");
const trusted = all.filter((c) => c.origin === "knps" || c.origin === "forest");

// 믿는 출처가 쓰는 이름 전부
const trustedNames = new Set<string>();
for (const c of trusted) for (const w of c.waypoints ?? []) trustedNames.add(w.trim());
console.log(`믿는 출처(knps ${all.filter(c=>c.origin==="knps").length} · forest ${all.filter(c=>c.origin==="forest").length}) 가 쓰는 경유지 이름 ${trustedNames.size}개`);

// 선언이 Overpass 블록보다 위에 있어야 한다. 아래에 두었더니 그 블록에서
// osmVariants 를 건드리는 순간 TDZ ReferenceError 가 났고, 미러 세 개가 모두
// "실패" 로 찍히면서 OSM 대조가 통째로 빠졌다 — 백운대·하루재 같은 실재 지명이
// 무더기로 "어느 출처에도 없음" 으로 나온 것이 그 증상이었다.
const trustedVariants: (readonly [string, string[]])[] = [];
const osmVariants: (readonly [string, string[]])[] = [];

// OSM: 북한산 일대 이름 있는 지점 전부
const BBOX = "37.60,126.92,37.71,127.03";
// way 도 이름만 있으면 전부 가져온다. 처음에는 natural/tourism/historic 만
// 받았는데, 절·탐방지원센터·지킴터는 대부분 amenity 나 building 이 붙은 way 라
// 통째로 빠졌다 — 도선사·보리사·백운탐방지원센터가 "어느 출처에도 없음" 으로
// 나온 것이 그 증상이었고, 데이터가 아니라 질의가 좁았던 것이다.
const query = `[out:json][timeout:90];
(node(${BBOX})["name"];
 way(${BBOX})["name"];
 relation(${BBOX})["name"]["boundary"!~"."];);
out center tags;`;
const MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];
const osmNames = new Set<string>();
for (const url of MIRRORS) {
  try {
    const control = new AbortController();
    const timer = setTimeout(() => control.abort(), 90_000);
    const res = await fetch(url, {
      method: "POST", body: "data=" + encodeURIComponent(query), signal: control.signal,
      headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": "khuac-homepage/1.0" },
    });
    clearTimeout(timer);
    if (!res.ok) { console.log(`  (${new URL(url).host} → ${res.status})`); continue; }
    const data = await res.json() as { elements: { tags?: Record<string, string> }[] };
    for (const e of data.elements) if (e.tags?.name) osmNames.add(e.tags.name.trim());
    for (const n of osmNames) osmVariants.push([n, variants(n)] as const);
    console.log(`OSM 북한산 일대 지명 ${osmNames.size}개  (출처 ${new URL(url).host})\n`);
    break;
  } catch (e) { console.log(`  (${new URL(url).host} → ${(e as Error).name})`); }
}
if (osmNames.size === 0) { console.log("Overpass 실패 — OSM 대조 없이 진행합니다\n"); }

/**
 * 한 이름이 가리킬 수 있는 표기들.
 *
 * 괄호를 그냥 떼면 안 된다. "백운탐방지원센터(도선사)" 는 괄호 밖이 본 이름이고
 * OSM 의 "북한산(백운대)" 는 괄호 안이 본 이름이라, 한쪽으로 정하면 반대쪽이
 * 깨진다 — 실제로 백운대와 도선사가 "어느 출처에도 없음" 으로 나왔던 이유다.
 * 그래서 버리지 않고 전체·괄호밖·괄호안을 모두 후보로 둔다.
 */
function variants(raw: string): string[] {
  const squash = (s: string) => s.replace(/\s+/g, "").trim();
  const out = new Set<string>([squash(raw)]);
  const outside = squash(raw.replace(/\s*[(（][^)）]*[)）]\s*/g, ""));
  if (outside) out.add(outside);
  for (const m of raw.matchAll(/[(（]([^)）]*)[)）]/g)) {
    const inside = squash(m[1]);
    if (inside) out.add(inside);
  }
  return [...out].filter(Boolean);
}
/**
 * 부분일치는 길이를 함께 본다.
 *
 * 처음에는 그냥 서로 포함하면 통과시켰는데, 그러면 "비둘기샘" 이 통과한다 —
 * 믿는 출처 어딘가에 "샘" 이나 "비둘기" 같은 짧은 이름이 있으면
 * "비둘기샘".includes("샘") 이 참이 되기 때문이다. 접두사 매칭을 이름만 바꿔
 * 단 것이고, CLAUDE.md 가 경고하는 바로 그 모양이다.
 *
 * 그래서 짧은 쪽이 긴 쪽의 70% 이상이고 네 글자 이상일 때만 같은 이름으로 본다.
 * "숨은벽전망대" ↔ "숨은벽 전망대"(공백만 다름) 는 통과하고,
 * "비둘기샘" ↔ "샘" 은 통과하지 못한다.
 */
/**
 * 표기 후보끼리 하나라도 같으면 같은 이름. 부분일치는 길이를 함께 본다 —
 * 그냥 서로 포함하면 통과시키면 "비둘기샘" 이 "샘" 에 걸려 통과한다. 짧은 쪽이
 * 긴 쪽의 70% 이상일 때만 같은 곳으로 본다: "숨은벽전망대"↔"숨은벽 전망대" 는
 * 통과하고, "비둘기샘"↔"샘" 은 통과하지 못한다.
 */
function sameName(a: string[], b: string[]): boolean {
  for (const x of a) for (const y of b) {
    if (x === y) return true;
    const [short, long] = x.length <= y.length ? [x, y] : [y, x];
    if (short.length >= 3 && short.length / long.length >= 0.7 && long.includes(short)) return true;
  }
  return false;
}

for (const n of trustedNames) trustedVariants.push([n, variants(n)] as const);
const known = (name: string): string | null => {
  const n = variants(name);
  for (const [raw, v] of trustedVariants) if (sameName(v, n)) return raw === name ? "knps/forest" : `knps/forest≈${raw}`;
  for (const [raw, v] of osmVariants) if (sameName(v, n)) return raw === name ? "OSM" : `OSM≈${raw}`;
  return null;
};

const unknown = new Map<string, string[]>(); // 이름 → 그 이름을 쓰는 코스들

console.log("━".repeat(70));
for (const course of search) {
  console.log(`\n■ ${course.name}`);
  for (const w of course.waypoints ?? []) {
    const where = known(w);
    if (where) {
      console.log(`    ✓ ${w.padEnd(24)} ${where}`);
    } else {
      console.log(`    ‼ ${w.padEnd(24)} 어느 출처에도 없음`);
      (unknown.get(w) ?? unknown.set(w, []).get(w)!).push(course.name);
    }
  }
}

console.log("\n" + "━".repeat(70));
console.log(`\n확인이 필요한 이름 ${unknown.size}개\n`);
for (const [name, courses] of [...unknown].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`  ${name}   — ${courses.length}개 코스에서 사용`);
  for (const c of courses) console.log(`      ${c}`);
}
