/**
 * Files the courses 산림청 describes into course_library.
 *
 *   node scripts/import-forest-courses.mts [--dry-run] [--limit N]
 *                                          [--cache <file>] [--skip <산>]...
 *
 * 국립공원공단 covers twenty-one parks. The mountains the club actually walks
 * most weekends - 관악산, 수락산, 불암산, 인왕산 - are in none of them, so a
 * question about one falls through to a grounded web search: 26.7 seconds and
 * sixteen sources, bought again for every rephrasing of the same question. OSM
 * holds 3,522 paths around 불암산 and names 3% of them, mostly 중랑천 산책로
 * and one called "0.5Km 00:11" - so the lines are there and the courses are not.
 *
 * Where it comes from: 산림청_산 정보 조회_GW (data.go.kr 15158978), read with
 * DATA_GO_KR_PARK_KEY - the same account key the park scripts use; the dataset
 * is already approved on it. 이용허락범위 제한 없음.
 *
 * What is worth keeping is one field. `crcmrsghtnginfoetcdscrt` is described in
 * the schema as 산정보주변관광정보기타코스설명 and holds, for 310 of the 1,338
 * mountains, the walk itself:
 *
 *   ① 수락산역 - 미주아파트 - 시립양로원 - 계곡 - 깔딱고개 - 정상 …(총 2시간)
 *
 * The two fields that look like they should hold this - ptmntrcmmncoursdscrt
 * (추천코스) and hkngpntdscrt (산행포인트) - are empty on all 1,338 rows.
 *
 * Distance and difficulty are not here and are not invented. The agency states
 * neither, and a difficulty we worked out ourselves would be read as theirs.
 * Both stay null for something that measures them to fill in later.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";

/** 산림청_산 정보 조회_GW, 이용허락범위 제한 없음. */
const DATASET_PAGE = "https://www.data.go.kr/data/15158978/openapi.do";
const ENDPOINT = "https://apis.data.go.kr/1400000/trailInfoService/getforeststoryservice";
const PAGE_SIZE = 1000;

interface Mountain {
  mntnnm: string;
  mntninfopoflc: string | null;
  mntninfohght: string | null;
  crcmrsghtnginfoetcdscrt: string | null;
}

/** Read the same way import-knps-courses.mts reads it, for the same reasons. */
function env(name: string): string {
  const match = readFileSync(".env.local", "utf8").match(new RegExp(`^${name}=(.*)$`, "m"));
  const value = match?.[1]?.trim().replace(/^["']|["']$/g, "");
  if (!value) throw new Error(`${name} is not set in .env.local`);
  // Accept either key form: URLSearchParams would encode an already-encoded
  // key a second time, which fails as SERVICE_KEY_IS_NOT_REGISTERED_ERROR.
  return /%[0-9A-Fa-f]{2}/.test(value) ? decodeURIComponent(value) : value;
}

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const limitIndex = args.indexOf("--limit");
const maxRows = limitIndex >= 0 ? Number(args[limitIndex + 1]) : Infinity;
const cacheIndex = args.indexOf("--cache");
const cachePath = cacheIndex >= 0 ? args[cacheIndex + 1] : null;
/** Mountains to leave alone. 북한산 holds thirteen courses written by hand. */
const skip = args.reduce<string[]>(
  (found, arg, i) => (arg === "--skip" && args[i + 1] ? [...found, args[i + 1]] : found),
  [],
);

async function gather(): Promise<Mountain[]> {
  if (cachePath && existsSync(cachePath)) {
    console.log(`${cachePath} 에서 읽습니다 (API 호출 없음).`);
    return JSON.parse(readFileSync(cachePath, "utf8")) as Mountain[];
  }
  const key = env("DATA_GO_KR_PARK_KEY");
  const out: Mountain[] = [];
  for (let page = 1; out.length < maxRows; page++) {
    const url = `${ENDPOINT}?serviceKey=${key}&pageNo=${page}&numOfRows=${PAGE_SIZE}&_type=json`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${page}페이지 실패 (${response.status})`);
    const body = (await response.json()) as {
      response: { body: { totalCount: number; items: { item: Mountain | Mountain[] } | "" } };
    };
    const items = body.response.body.items;
    const list = !items ? [] : Array.isArray(items.item) ? items.item : [items.item];
    if (list.length === 0) break;
    out.push(...list);
    console.log(`  ${page}페이지 · ${out.length}/${body.response.body.totalCount}`);
    if (out.length >= body.response.body.totalCount) break;
  }
  // A run cut short by --limit holds part of the country and a cache cannot say
  // so; the next run would read it and report the rest as mountains with no
  // courses. Only a complete read is worth keeping.
  if (cachePath && !Number.isFinite(maxRows)) writeFileSync(cachePath, JSON.stringify(out));
  return out;
}

function unescapeEntities(text: string): string {
  return text
    // Numeric first, and before &amp;, so that a twice-encoded &amp;#xD; - a
    // line break the agency's editor left inside a place name - resolves rather
    // than arriving in a waypoint as the literal text "&#xD;". 고려산 files its
    // loop as 적석사 입구 ~ &#xD; 적석사 입구.
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

/**
 * The course text, readable.
 *
 * Unescaped twice on purpose: the field arrives as `&amp;nbsp;` and
 * `&lt;br /&gt;` - encoded, then encoded again - so a single pass leaves
 * `&nbsp;` sitting in the middle of a place name.
 */
function readable(raw: string | null): string {
  if (!raw) return "";
  return unescapeEntities(unescapeEntities(raw))
    .replace(/<[^>]+>/g, " ")
    // Every kind of blank, newlines included: a course runs across lines in the
    // source and a waypoint must not carry the break into its name.
    .replace(/\s+/g, " ")
    .trim();
}

/** ①②③ number the courses within one mountain's paragraph. */
const CIRCLED = /[①-⑮]/;
/** The tail every course carries: (총 3시간 40분). */
const TOTAL = /\(\s*총\s*([^)]*?)\s*\)/;

/**
 * 도봉산(자운봉) is 도봉산. The parenthetical names the peak the agency measured
 * from, which is not part of what a member would type or say out loud.
 */
function bareName(name: string): string {
  return name.replace(/\s*\([^)]*\)\s*$/, "").trim();
}

interface Course {
  mountain: string;
  region: string | null;
  waypoints: string[];
  duration: string | null;
}

function coursesOf(row: Mountain): Course[] {
  const text = readable(row.crcmrsghtnginfoetcdscrt);
  if (text.length < 20) return [];
  const numbered = text.split(CIRCLED).slice(1);
  const mountain = bareName(row.mntnnm);
  const region = (row.mntninfopoflc ?? "").trim() || null;
  const chunks = numbered.length > 0 ? numbered : [text];
  return chunks.flatMap((chunk) => {
    const trimmed = chunk.trim();
    if (trimmed.length < 8) return [];
    const total = TOTAL.exec(trimmed);
    const body = trimmed.replace(TOTAL, "").trim().replace(/^[-·,\s]+|[-·,\s]+$/g, "");
    const waypoints = body.split(/\s*-\s*/).map((part) => part.trim()).filter(Boolean);
    if (waypoints.length < 2) return [];
    return [{ mountain, region, waypoints, duration: total?.[1] ?? null }];
  });
}

/**
 * A name for a course the agency did not name.
 *
 * It numbers them ①②③ within a mountain and nothing more, and a number is
 * neither a name a member recognises nor a key an upsert can use. The two ends
 * are what a course is called when somebody says it out loud, and it is how
 * 국립공원공단 writes its own: 추령 ~ 토함산.
 *
 * Ten pairs on the same mountain share both ends - 강천산 has two 매표소~매표소
 * loops - so those take the middle of the walk as well, rather than one of them
 * quietly overwriting the other.
 */
function nameFor(waypoints: string[], taken: Set<string>): string {
  const ends = `${waypoints[0]}~${waypoints[waypoints.length - 1]}`;
  if (!taken.has(ends)) return ends;
  const middle = waypoints[Math.floor(waypoints.length / 2)];
  const viaMiddle = `${waypoints[0]}~${middle}~${waypoints[waypoints.length - 1]}`;
  if (!taken.has(viaMiddle)) return viaMiddle;
  for (let n = 2; ; n++) if (!taken.has(`${ends} (${n})`)) return `${ends} (${n})`;
}

interface LibraryRow {
  mountain: string;
  region: string | null;
  name: string;
  waypoints: string[];
  distance_text: null;
  duration_text: string | null;
  difficulty: null;
  description: null;
  notes: null;
  sources: string[];
  origin: string;
  updated_at: string;
}

const rows = await gather();
console.log(`산 ${rows.length}곳`);

const library: LibraryRow[] = [];
const takenByMountain = new Map<string, Set<string>>();
let skipped = 0;
let noCourse = 0;

for (const row of rows) {
  const found = coursesOf(row);
  if (found.length === 0) {
    noCourse++;
    continue;
  }
  if (skip.includes(bareName(row.mntnnm))) {
    skipped += found.length;
    continue;
  }
  for (const course of found) {
    const taken = takenByMountain.get(course.mountain) ?? new Set<string>();
    takenByMountain.set(course.mountain, taken);
    const name = nameFor(course.waypoints, taken);
    taken.add(name);
    library.push({
      mountain: course.mountain,
      region: course.region,
      name,
      waypoints: course.waypoints,
      // Neither is in the file, and a number we worked out ourselves would be
      // read as the agency's. Empty until something measures them.
      distance_text: null,
      difficulty: null,
      // The file carries no prose about a course; left for a member to write.
      description: null,
      notes: null,
      duration_text: course.duration ? `총 ${course.duration}` : null,
      sources: [DATASET_PAGE],
      // Not knps: that was a survey whose stated distances were checked against
      // its own measured line. This is a sentence inside a description.
      origin: "forest",
      updated_at: new Date().toISOString(),
    });
  }
}

console.log(`\n저장 대상 ${library.length}개 · 산 ${new Set(library.map((r) => r.mountain)).size}곳`);
console.log(`코스 설명이 없어 건너뜀: ${noCourse}곳`);
if (skipped) console.log(`--skip ${skip.join(" ")} 이라 건너뜀: ${skipped}개`);
console.log(
  `소요시간 있음 ${library.filter((r) => r.duration_text).length}개 · ` +
    `경유지 평균 ${(library.reduce((sum, r) => sum + r.waypoints.length, 0) / library.length).toFixed(1)}개`,
);
console.log(`region 있음 ${library.filter((r) => r.region).length}/${library.length}개`);

// The whole reason the region column exists, printed rather than assumed: if
// these do not come out separated, the assistant is being handed two mountains
// as one and the column is not doing its job.
const regionsByName = new Map<string, Set<string>>();
for (const row of library) {
  const seen = regionsByName.get(row.mountain) ?? new Set<string>();
  if (row.region) seen.add(row.region);
  regionsByName.set(row.mountain, seen);
}
const shared = [...regionsByName].filter(([, regions]) => regions.size > 1);
console.log(`\n이름이 같은 다른 산: ${shared.length}종 — region 으로 갈린다`);
for (const [mountain, regions] of shared) {
  console.log(`  ${mountain}: ${[...regions].map((r) => r.slice(0, 24)).join(" / ")}`);
}

if (dryRun) {
  const metro = library.filter((row) => /서울|경기|인천/.test(row.region ?? ""));
  console.log(`\n--- 수도권 ${metro.length}개 중 앞 10개 ---`);
  for (const row of metro.slice(0, 10)) {
    console.log(`${row.mountain} / ${row.name}`);
    console.log(`  경유지: ${row.waypoints.join(" → ")}`);
    console.log(`  ${row.duration_text ?? "시간 미상"} · ${row.region?.slice(0, 30)}`);
  }
  console.log("\n시험 모드이므로 저장하지 않았습니다.");
  process.exit(0);
}

const supabaseUrl = env("NEXT_PUBLIC_SUPABASE_URL");
const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
for (let i = 0; i < library.length; i += 20) {
  const response = await fetch(`${supabaseUrl}/rest/v1/course_library?on_conflict=mountain,name`, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      authorization: `Bearer ${serviceKey}`,
      "content-type": "application/json",
      prefer: "resolution=merge-duplicates",
    },
    body: JSON.stringify(library.slice(i, i + 20)),
  });
  if (!response.ok) {
    throw new Error(`저장 실패 (${response.status}): ${(await response.text()).slice(0, 300)}`);
  }
  console.log(`  ${Math.min(i + 20, library.length)}/${library.length}`);
}
console.log(`${library.length}개 저장 완료`);
