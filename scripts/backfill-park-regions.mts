/**
 * Writes the administrative area of each national park onto its library rows.
 *
 *   node scripts/backfill-park-regions.mts [--dry-run]
 *
 * course_library.region tells two mountains of one name apart. 산림청's rows
 * arrived with it filled in; 국립공원공단's 402 rows did not, because the park
 * import predates the column - and a null there is not merely missing, it is
 * wrong in a way that shows. 계룡산 is a park near 공주 and also a hill in
 * 거제, and the library now holds all three sets of courses: seventeen from the
 * park with no region, two from 산림청 for the same mountain with 공주 in the
 * region, and two for 거제. Asked about 계룡산, libraryFor would offer three
 * mountains where there are two, two of which are the same place.
 *
 * Where the region comes from: the same Overpass boundary lookup the park
 * import already uses to name a park, asked one level down. A park sits inside
 * administrative areas, so the areas containing the park's own centre are its
 * region - admin_level 4 for the 시/도 and 6 for the 시/군/구. Nothing is typed
 * in from memory here; a park whose boundaries do not answer is left null
 * rather than guessed at, and says so.
 *
 * Read from the same course cache the park import writes, so this does not ask
 * data.go.kr for 910,000 rows again.
 */
import { existsSync, readFileSync } from "node:fs";

const PARK_CACHE = "scripts/knps-park-offices.json";
const COURSE_CACHE = process.env.KNPS_CACHE ?? "";
const OVERPASS_URLS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.osm.jp/api/interpreter",
];
const USER_AGENT = "khuac-homepage/1.0 (club site; park region backfill)";

const dryRun = process.argv.includes("--dry-run");

function env(name: string): string {
  const match = readFileSync(".env.local", "utf8").match(new RegExp(`^${name}=(.*)$`, "m"));
  const value = match?.[1]?.trim().replace(/^["']|["']$/g, "");
  if (!value) throw new Error(`${name} is not set in .env.local`);
  return value;
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** 지리산 국립공원 is 지리산, the same way the park import spells it. */
function mountainFrom(parkName: string): string {
  return parkName.replace(/국립\s*공원$/, "").replace(/\s+/g, "") || parkName;
}

/**
 * The administrative areas a point stands in, largest first.
 *
 * Both levels in one request. A park that spans provinces - 지리산 runs through
 * three - returns each of them, and every one is a word a member might use to
 * say which mountain they mean.
 */
async function regionAt(lat: number, lng: number): Promise<string | null> {
  const here = `${lat.toFixed(6)},${lng.toFixed(6)}`;
  const query =
    `[out:json][timeout:90];` +
    `is_in(${here})->.a;` +
    `area.a["boundary"="administrative"]["admin_level"~"^(4|6)$"];out tags;`;

  let lastError = "";
  for (let round = 0; round < 2; round++) {
    for (const url of OVERPASS_URLS) {
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": USER_AGENT },
          body: new URLSearchParams({ data: query }),
          signal: AbortSignal.timeout(120_000),
        });
        if (!response.ok) {
          lastError = `${url}: HTTP ${response.status}`;
          continue;
        }
        const body = (await response.json()) as {
          elements?: { tags?: Record<string, string> }[];
        };
        const named = (body.elements ?? [])
          .map((element) => ({
            level: Number(element.tags?.admin_level ?? 0),
            name: element.tags?.["name:ko"] ?? element.tags?.name ?? "",
          }))
          .filter((area) => area.name)
          // Province before district, so the string reads the way an address does.
          .sort((a, b) => a.level - b.level);
        const words = [...new Set(named.map((area) => area.name))];
        return words.length > 0 ? words.join(" ") : null;
      } catch (error) {
        lastError = `${url}: ${error instanceof Error ? error.message : String(error)}`;
      }
    }
    await pause(5_000);
  }
  console.log(`    overpass 실패: ${lastError}`);
  return null;
}

interface Course {
  office: number;
  latSum: number;
  lngSum: number;
  points: number;
}

if (!COURSE_CACHE || !existsSync(COURSE_CACHE)) {
  throw new Error("KNPS_CACHE 에 코스 캐시 경로를 주세요 (import-knps-courses.mts --cache 가 쓴 파일).");
}
if (!existsSync(PARK_CACHE)) throw new Error(`${PARK_CACHE} 가 없습니다.`);

const courses = JSON.parse(readFileSync(COURSE_CACHE, "utf8")) as Course[];
const parks = JSON.parse(readFileSync(PARK_CACHE, "utf8")) as Record<string, string>;

// One centre per mountain, not per office: 다도해해상 is surveyed by two
// offices and is one row's worth of mountain in the library.
const centres = new Map<string, { lat: number; lng: number }>();
const sums = new Map<string, { lat: number; lng: number; points: number }>();
for (const course of courses) {
  const park = parks[String(course.office)];
  if (!park || course.points <= 0) continue;
  const mountain = mountainFrom(park);
  const sum = sums.get(mountain) ?? { lat: 0, lng: 0, points: 0 };
  sums.set(mountain, {
    lat: sum.lat + course.latSum,
    lng: sum.lng + course.lngSum,
    points: sum.points + course.points,
  });
}
for (const [mountain, sum] of sums) {
  centres.set(mountain, { lat: sum.lat / sum.points, lng: sum.lng / sum.points });
}

// 북한산국립공원 was split into three mountains, and each of them wants its own
// answer rather than the park's.
const split = existsSync("scripts/bukhansan-park-split.json")
  ? (JSON.parse(readFileSync("scripts/bukhansan-park-split.json", "utf8")) as {
      courses: Record<string, { mountain: string | null }>;
    })
  : null;
if (split) {
  const splitSums = new Map<string, { lat: number; lng: number; points: number }>();
  for (const course of courses as (Course & { courseId: number })[]) {
    if (course.office !== 1501 || course.points <= 0) continue;
    const mountain = split.courses[String(course.courseId)]?.mountain;
    if (!mountain) continue;
    const sum = splitSums.get(mountain) ?? { lat: 0, lng: 0, points: 0 };
    splitSums.set(mountain, {
      lat: sum.lat + course.latSum,
      lng: sum.lng + course.lngSum,
      points: sum.points + course.points,
    });
  }
  centres.delete("북한산");
  for (const [mountain, sum] of splitSums) {
    centres.set(mountain, { lat: sum.lat / sum.points, lng: sum.lng / sum.points });
  }
}

console.log(`산 ${centres.size}곳의 행정구역을 찾습니다.`);

const found = new Map<string, string>();
for (const [mountain, centre] of [...centres].sort()) {
  const region = await regionAt(centre.lat, centre.lng);
  console.log(`  ${mountain}: ${region ?? "찾지 못함 — null 로 남깁니다"}`);
  if (region) found.set(mountain, region);
  await pause(1_000);
}

console.log(`\n${found.size}/${centres.size}곳 확인.`);
if (dryRun) {
  console.log("시험 모드이므로 저장하지 않았습니다.");
  process.exit(0);
}

const supabaseUrl = env("NEXT_PUBLIC_SUPABASE_URL");
const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
for (const [mountain, region] of found) {
  // Only the park's own rows. A 산림청 row for the same mountain already
  // carries the region its own agency wrote, and overwriting it here would
  // replace one agency's words with another's for no gain.
  const url =
    `${supabaseUrl}/rest/v1/course_library` +
    `?mountain=eq.${encodeURIComponent(mountain)}&origin=eq.knps`;
  const response = await fetch(url, {
    method: "PATCH",
    headers: {
      apikey: serviceKey,
      authorization: `Bearer ${serviceKey}`,
      "content-type": "application/json",
      prefer: "return=representation",
    },
    body: JSON.stringify({ region }),
  });
  if (!response.ok) {
    throw new Error(`${mountain} 저장 실패 (${response.status}): ${(await response.text()).slice(0, 200)}`);
  }
  const updated = (await response.json()) as unknown[];
  console.log(`  ${mountain}: ${updated.length}행`);
}
console.log("완료");
