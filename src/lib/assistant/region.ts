/**
 * Telling two mountains of one name apart, by where they are.
 *
 * Thirty-three names in course_library belong to more than one mountain - 계룡산
 * is a national park near 공주 and also a hill in 거제, 백운산 is four separate
 * mountains - and the library is read by name. Without this, a question about
 * 계룡산 is answered from every 계룡산's courses at once, presented as one
 * mountain's list, and neither the model nor the member can see that it
 * happened.
 *
 * Comparing the region strings does not work. A mountain stands in several
 * districts and each source writes down a different part of it: the park rows
 * say 경상남도 함양군 for 지리산, from the single point at the centre of what
 * the agency surveyed, while 산림청 writes 전라북도 남원시, 전라남도 구례군,
 * 경상남도 하동군ㆍ산청군ㆍ함양군 for the same mountain. What says they are one
 * mountain is that both name 함양군.
 *
 * Measured over all 917 rows: 14 of the 33 shared names are one mountain
 * written down differently and 19 are genuinely separate. Checked a second way
 * against OSM peak coordinates - for every pair this calls separate, the two
 * peaks of that name are at least 41km apart, and no pair it calls the same is
 * far apart.
 */

/**
 * Every spelling of a province, and the one this code calls it.
 *
 * The disagreement is not cosmetic. Park rows get their region from OSM, which
 * says 전북특별자치도 and 강원특별자치도; 산림청 still writes 전라북도 and
 * 강원도, and shortens either to 전북 and 강원 from one row to the next.
 *
 * 광주광역시 and 전라남도 became 광주전남특별시 on 2026-07-01. OSM answers with
 * the merged name and 산림청 has not caught up, so both mean one province here -
 * and it is a province, holding 여수, 순천 and 담양, not another name for 광주
 * the city.
 */
export const PROVINCES: [string, string[]][] = [
  ["전남광주", ["광주전남특별시", "광주전남특별통합시", "전남광주통합특별시", "전라남도", "광주광역시", "전남"]],
  ["전북", ["전북특별자치도", "전라북도", "전북"]],
  ["강원", ["강원특별자치도", "강원도", "강원"]],
  ["제주", ["제주특별자치도", "제주도", "제주"]],
  ["경남", ["경상남도", "경남"]], ["경북", ["경상북도", "경북"]],
  ["충남", ["충청남도", "충남"]], ["충북", ["충청북도", "충북"]],
  ["경기", ["경기도", "경기"]], ["서울", ["서울특별시", "서울시", "서울"]],
  ["부산", ["부산광역시"]], ["대구", ["대구광역시"]], ["인천", ["인천광역시"]],
  ["대전", ["대전광역시"]], ["울산", ["울산광역시"]], ["세종", ["세종특별자치시"]],
];

/**
 * The city a bare 구 belongs to, inside each province.
 *
 * A mountain crosses borough lines - 무등산 stands in 광주's 동구 and 북구, and
 * 산림청 names the first while the park's own centre falls in the second - so a
 * borough is folded into its city, or one mountain reads as two.
 */
const BOROUGH_CITY: Record<string, string> = {
  전남광주: "광주", 서울: "서울", 부산: "부산", 대구: "대구",
  인천: "인천", 대전: "대전", 울산: "울산",
};

/** 전남 and 경북 carry no suffix, so they are matched as whole words. */
const PLACE_TOKEN =
  /(?:전남|전북|경남|경북|충남|충북|강원|경기|제주|서울)(?![가-힣])|[가-힣]{1,7}(?:특별자치도|특별통합시|통합특별시|특별자치시|특별시|광역시|도|시|군|구)/g;

/**
 * Where a region string says the mountain is, as province-qualified districts.
 *
 * Province-qualified because a district name alone is not a place: 경기도 광주시
 * and the 광주 inside 전남광주 are 107km apart, and a 태화산 stands near each.
 *
 * Districts rather than provinces because provinces are what the sources spell
 * differently, and because a province is too coarse to separate two mountains
 * of one name inside it.
 */
export function placesOf(region: string | null): string[] {
  if (!region) return [];
  const places = new Set<string>();
  let province: string | null = null;
  for (const token of region.match(PLACE_TOKEN) ?? []) {
    const canonical = PROVINCES.find(([, spellings]) => spellings.includes(token))?.[0];
    if (canonical) {
      province = canonical;
      // 광주광역시 names a province here and a city as well; both are meant.
      if (token === "광주광역시") places.add("전남광주/광주");
      continue;
    }
    if (token.length < 2) continue;
    if (token.endsWith("구")) {
      const city = province ? BOROUGH_CITY[province] : undefined;
      if (city) places.add(`${province}/${city}`);
      continue;
    }
    if (token.endsWith("시") || token.endsWith("군")) places.add(`${province}/${token}`);
  }
  return [...places];
}

const PROVINCE_ALIAS: Record<string, string[]> = {
  전라남도: ["전남"], 전라북도: ["전북"], 경상남도: ["경남"], 경상북도: ["경북"],
  충청남도: ["충남"], 충청북도: ["충북"], 강원특별자치도: ["강원도", "강원"],
  제주특별자치도: ["제주도", "제주"], 서울특별시: ["서울시", "서울"],
  인천광역시: ["인천"], 대전광역시: ["대전"], 대구광역시: ["대구"],
  부산광역시: ["부산"], 울산광역시: ["울산"], 광주광역시: ["광주"],
  세종특별자치시: ["세종"], 경기도: ["경기"], 강원도: ["강원"],
  광주전남특별시: ["광주전남", "전남광주", "전남"],
};

/**
 * Every way a member might name the place a region string describes.
 *
 * Separate from placesOf because it answers a different question: not "is this
 * the same mountain" but "did the member's sentence mention this place". A
 * member types 거제, not 경상남도 and not 거제시.
 */
export function regionWords(region: string | null): string[] {
  if (!region) return [];
  const words = new Set<string>();
  for (const part of region.split(/[\s,·ㆍ]+/)) {
    const word = part.trim();
    if (word.length < 2) continue;
    words.add(word);
    for (const alias of PROVINCE_ALIAS[word] ?? []) words.add(alias);
    // 거제시 is 거제, 구이면 is 구이. The suffix is how an address is written,
    // not how the place is spoken about.
    const bare = word.replace(/(특별자치도|특별자치시|특별시|광역시|[시군구읍면동리])$/, "");
    if (bare.length >= 2) words.add(bare);
  }
  return [...words];
}

export interface Placed {
  mountain: string;
  region: string | null;
}

export interface MountainGroup<T extends Placed> {
  mountain: string;
  places: Set<string>;
  rows: T[];
}

/**
 * Rows of one name gathered into the mountains they are actually on.
 *
 * Rows that say where they are go first. A row with no region joins them only
 * when exactly one mountain carries its name; where the name is shared it waits
 * with the others like it, because a course filed under the wrong one of two
 * mountains is worse than one the member is asked about.
 *
 * Both halves of that came from running this over the real rows. Letting
 * region-less rows go first had 가야산's seven park courses, which are in 합천,
 * join the 서산 group - whichever came back from PostgREST first. Giving each
 * its own group split 지리산 into fifty-three mountains.
 */
export function groupByMountain<T extends Placed>(rows: T[]): MountainGroup<T>[] {
  const groups: MountainGroup<T>[] = [];
  const withPlaces = rows.map((row) => ({ row, places: new Set(placesOf(row.region)) }));

  for (const { row, places } of withPlaces.filter((entry) => entry.places.size > 0)) {
    const existing = groups.find(
      (candidate) =>
        candidate.mountain === row.mountain &&
        [...places].some((place) => candidate.places.has(place)),
    );
    if (existing) {
      for (const place of places) existing.places.add(place);
      existing.rows.push(row);
    } else {
      groups.push({ mountain: row.mountain, places: new Set(places), rows: [row] });
    }
  }

  const waiting = new Map<string, MountainGroup<T>>();
  for (const { row } of withPlaces.filter((entry) => entry.places.size === 0)) {
    const named = groups.filter((candidate) => candidate.mountain === row.mountain);
    if (named.length === 1) {
      named[0].rows.push(row);
      continue;
    }
    // All of them together, not one group each. They are courses on the same
    // mountain - we just cannot say which mountain of this name it is.
    const already = waiting.get(row.mountain);
    if (already) already.rows.push(row);
    else {
      const group: MountainGroup<T> = { mountain: row.mountain, places: new Set<string>(), rows: [row] };
      waiting.set(row.mountain, group);
      groups.push(group);
    }
  }
  return groups;
}
