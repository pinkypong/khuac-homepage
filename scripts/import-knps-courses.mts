/**
 * Files the courses 국립공원공단 publishes into course_library.
 *
 *   node scripts/import-knps-courses.mts [--dry-run] [--limit N] [--cache <file>]
 *                                         [--skip <산>]...
 *
 * Every route question the club types pays for a grounded web search - 26.7
 * seconds and sixteen sources for one answer - and pays again for the next
 * rephrasing of it. harvest-courses.mts files what those searches already
 * found; this fills the same shelf from the agency that maintains the trails,
 * so a question about a national park is answered from a row we hold rather
 * than from a search we buy.
 *
 * Where it comes from: 국립공원공단_국립공원 탐방로 공간데이터 (data.go.kr
 * 15003467), read through the odcloud REST API with DATA_GO_KR_PARK_KEY - the
 * same dataset and the same key import-park-trails.mts already uses for the
 * geometry. Nothing is scraped from knps.or.kr: its robots.txt allows only
 * /front/portal/visit, and that path now bounces to /portal/main/contents.do,
 * which the same file disallows. The published data says everything the site
 * would have, so there is no reason to argue with it.
 *
 * The file is one row per surveyed vertex - 910,110 of them - and the course
 * fields repeat on every one. What is worth keeping is what repeats:
 *
 *   상세구간   수통골주차장~빈계산~금수봉~자티고개~도덕봉~수통골
 *   GIS 상 거리(m) / 가는시간(분) / 오는시간(분) / 난이도   per stretch
 *
 * The waypoints are the reason this script exists. Distance and time on their
 * own are facts we could not put on a map; a list of Korean place names in
 * walking order is exactly the shape course_library.waypoints holds and the
 * map draws.
 *
 * Nothing here is inferred. A course the file names only at its two ends gets
 * those two names and no invented middle, a course the file marks out of use
 * is skipped, and the difficulty is carried across as the number the file
 * states - 국립공원공단 publishes no legend for that scale, so no 쉬움/보통/
 * 어려움 is invented for it.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { haversineDistanceMeters } from "../src/lib/gps/haversine.ts";

/** 국립공원공단_국립공원 탐방로 공간데이터, 이용허락범위 제한 없음. */
const DATASET_PAGE = "https://www.data.go.kr/data/15003467/fileData.do";
const ENDPOINT =
  "https://api.odcloud.kr/api/15003467/v1/uddi:33b2e50e-6039-4649-a9da-8d5b89180b78_201709281349";
const PAGE_SIZE = 5000; // The API returns nothing above this.
const SMALL_PAGE = 1000; // Used to re-ask for an offset the large page returns empty.

/**
 * Overpass names the park, because the file will not.
 *
 * The rows carry 공원사무소코드 (201, 301, ...) and no park name anywhere, and
 * 국립공원공단 publishes no code table with the dataset - the one open dataset
 * that pairs a park code with 공원명, 국립공원 공원경계 (15017313), answers 401
 * to this key because odcloud authorises per dataset. Asking which national
 * park boundary contains a point is a containment test on published geometry
 * rather than a guess about what 201 means, and it costs one query per park
 * office - about twenty for the country, not one per course.
 *
 * This is the same endpoint list src/lib/routes/overpass-core.ts uses.
 */
// Overpass is volunteer-run and the main instance does fall over - it answered
// 504 to the first run of this script. The mirrors run the same API over the
// same data, which is why src/lib/routes/overpass-core.ts keeps this list; a
// script that stops on one 504 after reading 910,000 rows is a script that
// throws away a quarter of an hour of someone else's bandwidth.
const OVERPASS_URLS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];
const USER_AGENT = "khuac.com hiking album (contact: https://khuac.com)";

interface Row {
  코스ID?: number | string;
  공원사무소코드?: number | string;
  국립공원관리번호?: number | string;
  시작점_ID?: number | string;
  종점_ID?: number | string;
  "탐방코스(한글)"?: string;
  상세구간?: string;
  "GIS 상 거리(m)"?: number | string;
  "가는시간(분)"?: number | string;
  "오는시간(분)"?: number | string;
  난이도?: number | string;
  사용여부?: number | string;
  "통제구간 설명"?: string;
  위도?: number | string;
  경도?: number | string;
}

/** One surveyed stretch of a course, as the file states it. */
interface Segment {
  meters: number;
  goMinutes: number;
  backMinutes: number;
  difficulty: string | null;
  inUse: boolean;
  closure: string | null;
  /** The length of this stretch's own vertices, to check the stated one against. */
  surveyed: number;
}

/** A course, gathered from every vertex row that names it. */
interface Course {
  office: number;
  courseId: number;
  name: string | null;
  detail: string | null;
  segments: Record<string, Segment>;
  /** Kept only to ask Overpass which park the course sits in. */
  latSum: number;
  lngSum: number;
  points: number;
}

function env(name: string): string {
  const match = readFileSync(".env.local", "utf8").match(new RegExp(`^${name}=(.*)$`, "m"));
  const value = match?.[1]?.trim().replace(/^["']|["']$/g, "");
  if (!value) throw new Error(`${name} is not set in .env.local`);
  // Accept either key form: URLSearchParams would encode an already-encoded
  // key a second time, which fails as SERVICE_KEY_IS_NOT_REGISTERED_ERROR.
  return /%[0-9A-Fa-f]{2}/.test(value) ? decodeURIComponent(value) : value;
}

const text = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim() : null;

async function fetchPage(key: string, page: number, perPage: number = PAGE_SIZE) {
  const url = new URL(ENDPOINT);
  url.searchParams.set("serviceKey", key);
  url.searchParams.set("page", String(page));
  url.searchParams.set("perPage", String(perPage));
  const response = await fetch(url, {
    headers: { "user-agent": USER_AGENT },
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) throw new Error(`page ${page}: HTTP ${response.status}`);
  const body = (await response.json()) as { data?: Row[]; totalCount?: number };
  return { rows: body.data ?? [], total: body.totalCount ?? 0 };
}

/**
 * A page that comes back empty is not the end of the data.
 *
 * Measured against this endpoint by import-park-trails.mts: page 13 returned
 * nothing while pages 12 and 14 both returned a full 5,000. Taking the first
 * empty page as the end stopped that import at 60,000 rows of 910,000 - with
 * 북한산 among what was missed - and it looked like a clean finish. The same
 * offset asked for a thousand at a time gets most of it back.
 */
async function fetchPageWithRetry(key: string, page: number) {
  const first = await fetchPage(key, page);
  if (first.rows.length > 0) return first;

  const offset = (page - 1) * PAGE_SIZE;
  const recovered: Row[] = [];
  for (let i = 0; i < PAGE_SIZE / SMALL_PAGE; i++) {
    const small = await fetchPage(key, offset / SMALL_PAGE + i + 1, SMALL_PAGE);
    recovered.push(...small.rows);
    await pause(250);
  }
  return { rows: recovered, total: first.total };
}

/** Their service, their pace: a quarter second between requests, throughout. */
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The walking order, out of whichever field the park wrote it in.
 *
 * The file writes a walk as names joined by a tilde - "수통골주차장~빈계산~
 * 금수봉~자티고개~도덕봉~수통골" - and uses the full-width and wave-dash forms
 * of it as well as the ASCII one. Nothing else is treated as a separator: a
 * hyphen is part of a Korean place name often enough ("제1-2주차장") that
 * splitting on it would invent waypoints the file does not contain, and an
 * invented waypoint is worse than a missing one.
 */
function splitChain(value: string | null): string[] {
  if (!value) return [];
  return value
    .split(/[~∼〜～]|->|→|=>/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/**
 * 상세구간 where the park filled it in, the course name where it did not.
 *
 * Only 157 of the 516 published courses carry 상세구간. The rest put the walk
 * in the name instead - 북한산 files every one of its 96 that way, as
 * "사기막골입구 ~ 백운대" - and reading only 상세구간 would throw away the
 * mountain the club actually climbs. Both fields are the agency's own text, so
 * neither is a guess; what differs is how much of the middle they wrote down,
 * which is why the dry run counts the two apart.
 *
 * A name with no separator in it is a name, not a route: "대청봉코스" yields
 * nothing rather than a one-stop walk.
 */
function waypointsFor(course: Course): string[] {
  const detailed = splitChain(course.detail);
  if (detailed.length >= 2) return detailed;
  const named = splitChain(course.name);
  return named.length >= 2 ? named : [];
}

/** "12.3km", or nothing if the file states no distance for the course. */
function distanceText(meters: number): string | null {
  if (!(meters > 0)) return null;
  return `${(meters / 1000).toFixed(1)}km`;
}

/**
 * Both directions, because the file states both and they differ.
 *
 * 가는시간 and 오는시간 are the climb and the descent, and a course that takes
 * three hours up and two down is a different day out from one that takes two
 * and a half each way. Anything the file leaves at zero is left out rather
 * than printed as "0분".
 */
function durationText(goMinutes: number, backMinutes: number): string | null {
  const spell = (minutes: number) => {
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    if (hours && rest) return `${hours}시간 ${rest}분`;
    if (hours) return `${hours}시간`;
    return `${rest}분`;
  };
  const parts: string[] = [];
  if (goMinutes > 0) parts.push(`올라갈 때 ${spell(goMinutes)}`);
  if (backMinutes > 0) parts.push(`내려올 때 ${spell(backMinutes)}`);
  return parts.length ? parts.join(" · ") : null;
}

/**
 * The difficulty as published, which is a number on an unpublished scale.
 *
 * 난이도 comes per stretch, as "2.33" or "3.10", and 국립공원공단 does not ship
 * a legend with this dataset - the 탐방로 등급제 document that defines the
 * scale is a separate PDF. So the number is carried across labelled as what it
 * is, and a course whose stretches disagree keeps the range rather than an
 * average nobody published.
 */
function difficultyText(values: string[]): string | null {
  const numbers = [...new Set(values)]
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b);
  if (numbers.length === 0) return null;
  const low = numbers[0].toFixed(2);
  const high = numbers[numbers.length - 1].toFixed(2);
  const scale = low === high ? low : `${low}~${high}`;
  return `국립공원공단 난이도 ${scale}`;
}

/**
 * Asks Overpass which national park a point belongs to.
 *
 * Two questions in one request, because containment alone does not answer for
 * every park. 다도해해상 and 태안해안 are drawn around islands and coastline,
 * and a point on one of their island trails falls outside the drawn area often
 * enough that is_in comes back empty; the park boundary still runs within a
 * kilometre or two of it. So: the area the point is inside, and failing that
 * the park boundary it is standing next to. Containment wins where both
 * answer, and a point that two different parks claim by proximity is left
 * unnamed rather than filed under a coin toss.
 */
async function parkNameAt(lat: number, lng: number): Promise<string | null> {
  const here = `${lat.toFixed(6)},${lng.toFixed(6)}`;
  const query =
    `[out:json][timeout:90];` +
    `is_in(${here})->.a;area.a["boundary"="national_park"];out tags;` +
    `relation["boundary"="national_park"](around:3000,${here});out tags;`;

  // Each mirror in turn, then the whole list again after a wait. An overloaded
  // instance answers 504 with an HTML error page, so a 200 is not enough on
  // its own - the body has to parse as the JSON we asked for.
  let lastError = "";
  for (let round = 0; round < 2; round++) {
    for (const url of OVERPASS_URLS) {
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "content-type": "application/x-www-form-urlencoded",
            "user-agent": USER_AGENT,
          },
          body: new URLSearchParams({ data: query }),
          signal: AbortSignal.timeout(120_000),
        });
        if (!response.ok) {
          lastError = `${url}: HTTP ${response.status}`;
          continue;
        }
        return readParkName(await response.json());
      } catch (error) {
        lastError = `${url}: ${error instanceof Error ? error.message : String(error)}`;
      }
      await pause(2_000);
    }
    if (round === 0) await pause(15_000);
  }
  throw new Error(`overpass 응답 없음 (${lastError})`);
}

function readParkName(payload: unknown): string | null {
  const body = (payload ?? {}) as {
    elements?: { type?: string; tags?: Record<string, string> }[];
  };

  // Korean only. An English name would file the course under "Bukhansan
  // National Park", which no question the club types would ever match.
  const korean = (element: { tags?: Record<string, string> }) => {
    const name = text(element.tags?.["name:ko"]) ?? text(element.tags?.name);
    return name && /[가-힣]/.test(name) ? name : null;
  };

  const contained = (body.elements ?? []).filter((element) => element.type === "area");
  for (const element of contained) {
    const name = korean(element);
    if (name) return name;
  }
  const nearby = new Set(
    (body.elements ?? [])
      .filter((element) => element.type === "relation")
      .map(korean)
      .filter((name): name is string => !!name),
  );
  return nearby.size === 1 ? [...nearby][0] : null;
}

/**
 * The mountain, as the club spells it.
 *
 * OSM carries the park's own name, 북한산국립공원; the club asks about 북한산,
 * and the rows already in the library are filed that way. Dropping the
 * 국립공원 suffix is the whole transformation - 한려해상 and 경주 keep whatever
 * is left, because those parks are not named after a mountain and pretending
 * otherwise would file them where nobody looks.
 *
 * The spaces go with it. OSM writes some of these with a space and some
 * without - "북한산국립공원" but "태안 해안 국립공원" - while the agency writes
 * 태안해안국립공원 either way, and a question typed as 태안해안 should not miss
 * a row filed as "태안 해안".
 */
function mountainFrom(parkName: string): string {
  const stripped = parkName.replace(/국립\s*공원$/, "").replace(/\s+/g, "");
  return stripped || parkName;
}

/**
 * 북한산국립공원 is three mountains, and the file does not say which.
 *
 * The park office covers 북한산, 도봉산 and 사패산 - the national park takes in
 * all three - so naming a course after its park files 도봉서원, 마당바위,
 * 다락능선 and 포대능선 under 북한산. 37 of that office's 96 courses, 39% of
 * them, are not on 북한산 at all; a member asking about 도봉산 would find none
 * of them and a member asking about 북한산 would be handed them anyway.
 *
 * The table was built from three kinds of evidence computed separately and
 * checked against each other - place names, the centre of each course's
 * surveyed points, and which mountain the courses sharing an endpoint sit on -
 * and then verified against 160,438 individual survey vertices. Three courses
 * are left null: 우이령길 runs along the saddle that divides two of the
 * mountains, and a course on the dividing line filed under one of them is a
 * course the other one can never find.
 */
/**
 * Which park each office looks after, so the answer is asked for once.
 *
 * The office number is all the file carries; the park's name comes from asking
 * Overpass which national park boundary the office's courses sit inside. That
 * is twenty-two queries against a service other people are also using, with a
 * second between each and a retry across mirrors when one answers 504, and it
 * took over twenty minutes on a bad afternoon - every run, for an answer that
 * has not changed since the parks were drawn.
 *
 * So it is written down. An office already in the table is not asked about
 * again; one that is missing is looked up and added, which is what happens the
 * first time the agency opens a new office. Delete the file to ask again.
 */
const PARK_CACHE = "scripts/knps-park-offices.json";

const SPLIT_OFFICE = 1501;
const SPLIT_TABLE = "scripts/bukhansan-park-split.json";

function splitMountains(): Map<number, string | null> {
  const raw = JSON.parse(readFileSync(SPLIT_TABLE, "utf8")) as {
    courses: Record<string, { mountain: string | null }>;
  };
  return new Map(
    Object.entries(raw.courses).map(([id, row]) => [Number(id), row.mountain]),
  );
}

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const limitIndex = args.indexOf("--limit");
const maxPages = limitIndex >= 0 ? Number(args[limitIndex + 1]) : Infinity;
const cacheIndex = args.indexOf("--cache");
const cachePath = cacheIndex >= 0 ? args[cacheIndex + 1] : null;
/**
 * Parks to leave alone, by the name this file files them under - so
 * `--skip 북한산` skips the 북한산 park office.
 *
 * A park we already hold hand-written courses for is a park where this import
 * does not help and can hurt. 북한산 is the case it was written for: the club
 * has thirteen courses there with descriptions a member can read, and the
 * agency's ninety-odd are named in an entirely different style - 백운대매표소
 * ~ 하루재 ~ 위문 ~ 백운대 against 백운탐방지원센터-백운대 코스. Nothing
 * collides, so nothing is overwritten; the two just sit side by side, and the
 * assistant is handed a hundred and eight courses to choose thirteen from.
 *
 * That park office also covers 도봉산 and 사패산 - the national park includes
 * them - so a third of its courses would be filed under 북한산 and found by
 * nobody asking about 도봉산. Splitting those three is its own job.
 */
const skipParks = args.reduce<string[]>((found, arg, i) => (
  arg === "--skip" && args[i + 1] ? [...found, args[i + 1]] : found
), []);
/**
 * How far the agency's stated length may sit from the length of the line the
 * agency surveyed. They agree to three decimals where the file is well formed,
 * so a course where they do not is a course whose distance we cannot print
 * with a straight face - 소공원~희운각대피소 states 4.7km for a surveyed 1.1km.
 * Dropped rather than guessed at: a member reading 4.7km and walking 1.1km is
 * worse served than one who never saw the row.
 */
const AGREE_LOW = 0.9;
const AGREE_HIGH = 1.1;

/**
 * Reading the whole file takes a quarter of an hour of somebody else's
 * bandwidth. --cache keeps the gathered courses in a local file so that
 * checking a dry run twice, or fixing how a waypoint is split, does not ask
 * data.go.kr for 910,000 rows again.
 */
async function gather(): Promise<Course[]> {
  if (cachePath && existsSync(cachePath)) {
    console.log(`${cachePath} 에서 읽습니다 (API 호출 없음).`);
    return JSON.parse(readFileSync(cachePath, "utf8")) as Course[];
  }

  const key = env("DATA_GO_KR_PARK_KEY");
  const courses = new Map<string, Course>();
  /** The previous vertex of each stretch, to add up what was surveyed. */
  const lastVertex = new Map<string, { lat: number; lng: number }>();
  let page = 1;
  let seen = 0;
  let total = Infinity;
  let empties = 0;

  for (;;) {
    if (page > maxPages) break;
    // Bounded by the row count the API reports rather than by the first gap in
    // it, so a flaky page costs a retry instead of most of the country.
    if (seen >= total) break;
    const { rows, total: reported } = await fetchPageWithRetry(key, page);
    if (reported > 0) total = reported;
    if (rows.length === 0) {
      console.log(`  ${page}페이지는 비어 있어 건너뜁니다 (${seen}/${total})`);
      empties++;
      if (empties > 8) break;
      page++;
      continue;
    }
    empties = 0;
    seen += rows.length;

    for (const row of rows) {
      const office = Number(row["공원사무소코드"]);
      const courseId = Number(row["코스ID"]);
      if (!Number.isFinite(office) || !Number.isFinite(courseId)) continue;
      // 코스ID repeats across park offices, so the office is part of the key.
      const slot = `${office}|${courseId}`;
      const course = courses.get(slot) ?? {
        office,
        courseId,
        name: text(row["탐방코스(한글)"]),
        detail: text(row["상세구간"]),
        segments: {},
        latSum: 0,
        lngSum: 0,
        points: 0,
      };

      // Distance, times and difficulty belong to the stretch, not to the
      // vertex, and repeat on every vertex of it - so they have to be counted
      // once per stretch, and the whole question is what identifies one.
      //
      // 국립공원관리번호 looks like the answer and is not. Eight of the
      // twenty-two park offices never fill it in: 북한산 stamps 15000000000 on
      // all 124,000 of its rows, so keying on it collapsed the park's 96
      // courses to one stretch each and called 사기막골입구~백운대 a 230m walk.
      // The endpoint pair is filled in everywhere and does identify a stretch,
      // and the check below - stated length against the length of the vertices
      // they published for it - is what confirms that, park by park.
      const segmentId =
        `${row["시작점_ID"] ?? ""}|${row["종점_ID"] ?? ""}|${row["국립공원관리번호"] ?? ""}`;
      const segment = (course.segments[segmentId] ??= {
        meters: Number(row["GIS 상 거리(m)"]) || 0,
        goMinutes: Number(row["가는시간(분)"]) || 0,
        backMinutes: Number(row["오는시간(분)"]) || 0,
        difficulty: text(row["난이도"]),
        inUse: Number(row["사용여부"]) !== 0,
        closure: text(row["통제구간 설명"]),
        surveyed: 0,
      });

      const lat = Number(row["위도"]);
      const lng = Number(row["경도"]);
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        const previous = lastVertex.get(`${slot}|${segmentId}`);
        // The vertices arrive in walking order about a metre apart. A step far
        // longer than that is the survey jumping to another piece of the park,
        // not a metre of trail, so it is not counted as one.
        if (previous) {
          const step = haversineDistanceMeters(previous, { lat, lng });
          if (step < 200) segment.surveyed += step;
        }
        lastVertex.set(`${slot}|${segmentId}`, { lat, lng });
        course.latSum += lat;
        course.lngSum += lng;
        course.points++;
      }
      courses.set(slot, course);
    }

    if (page % 20 === 0) {
      console.log(`  ${page}페이지 · ${seen}/${total}행 · 코스 ${courses.size}개`);
    }
    page++;
    await pause(250);
  }

  const gathered = [...courses.values()];
  // A run cut short by --limit holds part of the country, and a cache cannot
  // say so: the next run would read it and report the missing parks as parks
  // with no courses. Only a complete read is worth keeping.
  if (cachePath && !Number.isFinite(maxPages)) writeFileSync(cachePath, JSON.stringify(gathered));
  return gathered;
}

const splitByCourse = splitMountains();
const courses = await gather();
console.log(`코스 ${courses.length}개 · 공원사무소 ${new Set(courses.map((c) => c.office)).size}곳`);

/**
 * One Overpass query per park office, on the middle of everything that office
 * surveyed. A park office covers one park, so the answer is the same for every
 * course under it, and asking once per course would be twenty queries turned
 * into seven hundred for no extra fact.
 */
const parkByOffice = new Map<number, string | null>();
const knownParks: Record<string, string> = existsSync(PARK_CACHE)
  ? (JSON.parse(readFileSync(PARK_CACHE, "utf8")) as Record<string, string>)
  : {};
let parksLearned = 0;
const offices = [...new Set(courses.map((course) => course.office))].sort((a, b) => a - b);

/**
 * A park nobody can name is one park missing, not a lost run.
 *
 * Reading the file takes a quarter of an hour, and Overpass is a volunteer
 * service that goes down: letting one exhausted mirror list throw here would
 * throw all of that away at the last step. The office is left unnamed instead,
 * its courses are skipped, and the count of them is printed - so a run during
 * an outage reports what it could not name rather than dying.
 */
async function parkNameOrNull(lat: number, lng: number): Promise<string | null> {
  try {
    return await parkNameAt(lat, lng);
  } catch (error) {
    console.log(`    overpass 실패: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

for (const office of offices) {
  const mine = courses.filter((course) => course.office === office && course.points > 0);
  const remembered = knownParks[String(office)];
  if (remembered) {
    parkByOffice.set(office, remembered);
    console.log(`  사무소 ${office}: ${remembered} (코스 ${mine.length}개, 기억해둔 값)`);
    continue;
  }
  const lat = mine.reduce((sum, c) => sum + c.latSum, 0) / mine.reduce((sum, c) => sum + c.points, 0);
  const lng = mine.reduce((sum, c) => sum + c.lngSum, 0) / mine.reduce((sum, c) => sum + c.points, 0);
  let park = Number.isFinite(lat) && Number.isFinite(lng) ? await parkNameOrNull(lat, lng) : null;
  await pause(1_000);

  // A park drawn around islands or a coastline has a centre that is not inside
  // it - 한려해상 and 다도해해상 both sprawl - so when the middle lands outside
  // every boundary, a point on an actual trail is asked instead.
  for (const course of mine.slice(0, 5)) {
    if (park) break;
    park = await parkNameOrNull(course.latSum / course.points, course.lngSum / course.points);
    await pause(1_000);
  }

  parkByOffice.set(office, park);
  // Only a real answer is kept. A lookup that failed because Overpass was busy
  // must be asked again next run, not remembered as "this office has no park".
  if (park) {
    knownParks[String(office)] = park;
    parksLearned++;
  }
  console.log(`  사무소 ${office}: ${park ?? "국립공원 경계를 찾지 못함"} (코스 ${mine.length}개)`);
}

if (parksLearned > 0) {
  writeFileSync(PARK_CACHE, `${JSON.stringify(knownParks, null, 2)}
`);
  console.log(`${PARK_CACHE} 에 ${parksLearned}곳 새로 적었습니다.`);
}

interface LibraryRow {
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
  /**
   * Set here because an upsert only writes the columns it is given: left out,
   * updated_at would keep the timestamp of the first import and a re-import
   * would look like it never happened. actions.ts sets it for the same reason.
   */
  updated_at: string;
}

const rows = new Map<string, LibraryRow>();
let skippedNoPark = 0;
let skippedRetired = 0;
let skippedNoName = 0;
let skippedUnmatched = 0;
let skippedAsked = 0;
let skippedDisagreed = 0;
let skippedUnsplit = 0;
let collisions = 0;
/** Stated length against surveyed length, to print per park below. */
const stated = new Map<string, number>();
const surveyed = new Map<string, number>();

for (const course of courses) {
  const park = parkByOffice.get(course.office);
  if (!park) {
    skippedNoPark++;
    continue;
  }
  // Settled before --skip is read, so that --skip 북한산 means the 56 courses
  // that are on 북한산 rather than the whole office: the club's own thirteen
  // 북한산 courses stay untouched and 도봉산 and 사패산 still come in.
  let mountain: string;
  if (course.office === SPLIT_OFFICE) {
    if (!splitByCourse.has(course.courseId)) {
      // Silence here would file a course the agency added later under the park
      // name, which is the mistake this table exists to prevent. The table is
      // the only place that would notice, so it says so.
      throw new Error(
        `${SPLIT_TABLE} 에 코스 ${course.courseId} (${course.name}) 이 없습니다. ` +
          `공단이 코스를 추가했으면 표를 다시 만들어야 합니다.`,
      );
    }
    const split = splitByCourse.get(course.courseId) ?? null;
    if (!split) {
      skippedUnsplit++;
      continue;
    }
    mountain = split;
  } else {
    mountain = mountainFrom(park);
  }
  if (skipParks.includes(mountain)) {
    skippedAsked++;
    continue;
  }
  const name = course.name;
  if (!name) {
    skippedNoName++;
    continue;
  }
  // 비매칭코스 - "unmatched course" - is the file's own bin for surveyed line
  // that it could not attach to a course. 북한산 files 24km of trail under
  // that one name. It is a leftovers bucket, not somewhere anyone walks.
  if (name === "비매칭코스") {
    skippedUnmatched++;
    continue;
  }
  const segments = Object.values(course.segments);
  // 사용여부 0 is a stretch the agency has taken out of service. A course with
  // nothing left in service is not a course the club can walk this year.
  if (segments.length > 0 && segments.every((segment) => !segment.inUse)) {
    skippedRetired++;
    continue;
  }

  const live = segments.filter((segment) => segment.inUse);
  const meters = live.reduce((sum, segment) => sum + segment.meters, 0);
  const walked = live.reduce((sum, segment) => sum + segment.surveyed, 0);
  // Stated against surveyed, per course rather than per park: a park's totals
  // can agree while one course inside it is wrong, and dropping the park for
  // that would throw away every good course beside it.
  if (walked > 0 && (meters / walked <= AGREE_LOW || meters / walked >= AGREE_HIGH)) {
    skippedDisagreed++;
    continue;
  }
  const goMinutes = live.reduce((sum, segment) => sum + segment.goMinutes, 0);
  const backMinutes = live.reduce((sum, segment) => sum + segment.backMinutes, 0);
  const closures = [
    ...new Set(
      live
        .map((segment) => segment.closure)
        .filter((closure): closure is string => !!closure && closure !== "탐방가능구간"),
    ),
  ];

  stated.set(mountain, (stated.get(mountain) ?? 0) + meters);
  surveyed.set(
    mountain,
    (surveyed.get(mountain) ?? 0) + walked,
  );
  const row: LibraryRow = {
    mountain,
    name,
    waypoints: waypointsFor(course),
    distance_text: distanceText(meters),
    duration_text: durationText(goMinutes, backMinutes),
    difficulty: difficultyText(
      live.map((segment) => segment.difficulty).filter((value): value is string => !!value),
    ),
    // The file carries no prose about a course, and a description we wrote
    // ourselves would read as the agency's. Left empty for a member to fill.
    description: null,
    notes: closures.length ? `통제 구간: ${closures.join(", ")}` : null,
    sources: [DATASET_PAGE],
    // Not "search" and not "club": these came from the agency, and a member
    // correcting one by hand should be able to tell which is which.
    origin: "knps",
    updated_at: new Date().toISOString(),
  };

  // (mountain, name) is the library's key, so two courses a park names the
  // same have to become one row. The one with more of the walk written down
  // wins; losing the shorter one is reported rather than done quietly.
  const slot = `${mountain}|${name}`;
  const existing = rows.get(slot);
  if (existing) {
    collisions++;
    if (existing.waypoints.length >= row.waypoints.length) continue;
  }
  rows.set(slot, row);
}

const list = [...rows.values()];
const byMountain = new Map<string, number>();
for (const row of list) byMountain.set(row.mountain, (byMountain.get(row.mountain) ?? 0) + 1);

console.log(`\n저장 대상 ${list.length}개 · 산 ${byMountain.size}곳`);
for (const [mountain, count] of [...byMountain].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${mountain}: ${count}개`);
}
const withMiddle = list.filter((row) => row.waypoints.length >= 3).length;
const withEnds = list.filter((row) => row.waypoints.length === 2).length;
console.log(
  `경유지: 중간 지점까지 ${withMiddle}개 · 시작/끝만 ${withEnds}개 · 없음 ` +
    `${list.filter((row) => row.waypoints.length === 0).length}개`,
);
console.log(
  `거리 있음 ${list.filter((r) => r.distance_text).length}개 · ` +
    `시간 있음 ${list.filter((r) => r.duration_text).length}개 · ` +
    `난이도 있음 ${list.filter((r) => r.difficulty).length}개`,
);
if (skippedNoPark) console.log(`국립공원 경계를 찾지 못해 건너뜀: ${skippedNoPark}개`);
if (skippedRetired) console.log(`사용여부 0으로 건너뜀: ${skippedRetired}개`);
if (skippedNoName) console.log(`코스명이 없어 건너뜀: ${skippedNoName}개`);
if (skippedUnmatched) console.log(`비매칭코스라 건너뜀: ${skippedUnmatched}개`);
if (skippedAsked) console.log(`--skip ${skipParks.join(" ")} 이라 건너뜀: ${skippedAsked}개`);
if (skippedUnsplit) {
  console.log(`어느 산인지 가를 수 없어 건너뜀: ${skippedUnsplit}개 (우이령길 등 경계 위 코스)`);
}
if (skippedDisagreed) {
  console.log(`적힌 거리와 측량 길이가 어긋나 건너뜀: ${skippedDisagreed}개`);
}
if (collisions) console.log(`이름이 같아 하나로 합침: ${collisions}개`);

/**
 * What the agency states against what the agency surveyed.
 *
 * The two agree to three decimals where the file is well formed, so a park
 * where they do not agree is a park whose stated distances are not being read
 * correctly - which is exactly how the 북한산 stretch key was found to be
 * wrong. Printed rather than silently trusted, every run.
 */
console.log("\n--- 공단이 적은 거리 vs 공단이 측량한 좌표 길이 ---");
for (const [mountain] of [...byMountain].sort((a, b) => b[1] - a[1])) {
  const said = (stated.get(mountain) ?? 0) / 1000;
  const walked = (surveyed.get(mountain) ?? 0) / 1000;
  const ratio = walked > 0 ? said / walked : 0;
  const flag = ratio > 0.9 && ratio < 1.1 ? "" : "  <- 어긋남";
  console.log(`  ${mountain}: ${said.toFixed(1)}km vs ${walked.toFixed(1)}km (${ratio.toFixed(2)})${flag}`);
}

if (dryRun) {
  // Two per park rather than the first ten rows, which would all be 지리산 and
  // would show nothing about how the other twenty parks came out.
  const perPark = new Map<string, number>();
  const sample = list.filter((row) => {
    const taken = perPark.get(row.mountain) ?? 0;
    if (taken >= 2) return false;
    perPark.set(row.mountain, taken + 1);
    return true;
  });
  console.log(`\n--- 들어갈 내용 (산마다 2개씩, ${sample.length}개) ---`);
  for (const row of sample) {
    console.log(
      `${row.mountain} / ${row.name}\n` +
        `  경유지: ${row.waypoints.join(" → ") || "(없음)"}\n` +
        `  거리: ${row.distance_text ?? "-"} · 시간: ${row.duration_text ?? "-"} · 난이도: ${row.difficulty ?? "-"}` +
        (row.notes ? `\n  ${row.notes}` : ""),
    );
  }
  console.log("\n시험 모드이므로 저장하지 않았습니다.");
  process.exit(0);
}

if (list.length === 0) {
  console.log("저장할 코스가 없습니다.");
  process.exit(0);
}

const supabaseUrl = env("NEXT_PUBLIC_SUPABASE_URL");
const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");

// Twenty at a time, on the plain (mountain, name) constraint that
// 20260916030000_course_library_upsert_key.sql added for exactly this: the
// upsert is idempotent, so a failure halfway through is recoverable by
// running it again.
for (let i = 0; i < list.length; i += 20) {
  const response = await fetch(
    `${supabaseUrl}/rest/v1/course_library?on_conflict=mountain,name`,
    {
      method: "POST",
      headers: {
        apikey: serviceKey,
        authorization: `Bearer ${serviceKey}`,
        "content-type": "application/json",
        prefer: "resolution=merge-duplicates",
      },
      body: JSON.stringify(list.slice(i, i + 20)),
    },
  );
  if (!response.ok) {
    throw new Error(`저장 실패 (${response.status}): ${(await response.text()).slice(0, 300)}`);
  }
  console.log(`  ${Math.min(i + 20, list.length)}/${list.length}`);
}
console.log(`${list.length}개 저장 완료`);
