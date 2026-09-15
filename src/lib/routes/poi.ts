/**
 * Matching waypoint names against the club's own gazetteer.
 *
 * Kept free of any Supabase or server-only import so the matching rule itself
 * can be tested: it is what decides whether a course draws through the right
 * rock, and the rule has to survive the ways people actually type these names.
 */

export interface ClubPoi {
  name: string;
  aliases: string[];
  lat: number;
  lng: number;
}

/**
 * Collapses the spacing and decoration that should not stop a name matching.
 *
 * Answers write the same place as 백운대 탐방지원센터, 백운대탐방지원센터 and
 * 백운대탐방지원센터(도선사) depending on the sentence, and a member typing a
 * correction will not reproduce whichever one the model happened to use.
 * Bracketed asides are dropped rather than kept, since they are nearly always
 * a second name for the same thing - which belongs in `aliases`.
 */
export function normalisePoiName(name: string): string {
  return name
    .replace(/[（([][^)\]）]*[)\]）]/g, " ")
    .replace(/[·・.,'"]/g, " ")
    .replace(/\s+/g, "")
    .trim()
    .toLowerCase();
}

/** Every spelling one row answers to. */
function keysFor(poi: ClubPoi): string[] {
  return [poi.name, ...poi.aliases].map(normalisePoiName).filter(Boolean);
}

/**
 * The club's point for this name, or null when it has none.
 *
 * Exact match only, after normalising. A fuzzy match here would be a guess
 * wearing our own table's authority - the whole reason this exists is that
 * guessing put a waypoint on the wrong side of the mountain.
 */
export function findClubPoi(name: string, pois: ClubPoi[]): ClubPoi | null {
  const target = normalisePoiName(name);
  if (!target) return null;
  for (const poi of pois) {
    if (keysFor(poi).includes(target)) return poi;
  }
  return null;
}

/**
 * Words that say what kind of place it is rather than which place it is.
 *
 * Every trailhead on 북한산 ends in 탐방지원센터, so comparing whole names makes
 * 밤골탐방지원센터 and 북한산성탐방지원센터 look alike when they are opposite
 * sides of the mountain. What distinguishes them is the part left over.
 */
const GENERIC_PARTS = [
  "국립공원", "탐방지원센터", "탐방안내소", "탐방센터", "공원지킴터",
  "탐방로입구", "주차장", "매표소", "입구", "정류장",
  // Temples are listed under their order, and 영취사 arrives as
  // 대한불교조계종 영취사. Left in, the order's name swamps the comparison and
  // the right temple is rejected while a wrong one a single character away is
  // accepted in its place.
  "대한불교조계종", "한국불교태고종", "대한불교",
];

/** The part of a place name that says which place it is. */
function distinctivePart(name: string, place: string): string {
  let core = normalisePoiName(name);
  const mountain = normalisePoiName(place);
  if (mountain && core.startsWith(mountain) && core !== mountain) core = core.slice(mountain.length);
  for (const generic of GENERIC_PARTS) core = core.split(normalisePoiName(generic)).join("");
  return core;
}

/** Characters that have to change to turn one string into the other. */
function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[b.length];
}

/** True when two strings share a run of at least two characters. */
function sharesRun(a: string, b: string): boolean {
  for (let i = 0; i + 2 <= a.length; i++) {
    if (b.includes(a.slice(i, i + 2))) return true;
  }
  return false;
}

/**
 * Whether a search result is plausibly the place that was asked for.
 *
 * Places answers every query with its best guess and says nothing about how
 * good it was. Asked for 밤골탐방지원센터 - which it does not carry, the park
 * calls it 밤골공원지킴터 - it returned 북한산성탐방지원센터, a real trailhead
 * 2.5km away on the other side of the ridge. The course then began in the wrong
 * valley and every leg after it was drawn faithfully from there, which is worse
 * than a course that says it could not find its start.
 *
 * Tolerant on purpose. 영추사 and 영취사 are the same temple spelled two ways,
 * and one character apart is the kind of difference a name picks up in the
 * telling; 밤골 and 북한산성 are four apart and share no run of two characters.
 * Anything without a distinctive part left - a bare 북한산 - is accepted, since
 * there is nothing to disagree with.
 */
export function isPlausibleMatch(asked: string, found: string, place: string): boolean {
  const wanted = distinctivePart(asked, place);
  // Nothing distinctive was asked for - a bare 북한산 - so there is nothing to
  // disagree with.
  if (!wanted) return true;
  const got = distinctivePart(found, place);
  // Something specific was asked for and something generic came back: asked
  // for 북한동역사관, which Places does not carry, it offered 북한산국립공원.
  // That is the park itself, not the place, and accepting it put a waypoint on
  // a centroid in the middle of the mountain.
  if (!got) return false;
  if (got === wanted) return true;
  // What was asked for, with a qualifier on the front that the answer dropped:
  // 원도봉 answered with 도봉, 신사 with 사. Korean place names are
  // distinguished by what comes first, so a name missing its opening is a
  // different place - 원도봉탐방지원센터 and 도봉탐방지원센터 are separate
  // trailheads on opposite sides of the mountain.
  //
  // Only in that direction. A name that is a shortening from the end -
  // 망월사 갈림길 answered with 망월사 - is the same place described less
  // fully, and the temple really is where that junction is.
  if (wanted.endsWith(got) && wanted !== got) return false;
  if (got.includes(wanted) || wanted.includes(got)) return true;
  if (sharesRun(wanted, got)) return true;
  // One character apart is a spelling, but only where there is enough name for
  // one character to be a spelling. 위문 and 관문 are also one apart, and they
  // are twenty kilometres apart on the ground.
  return wanted.length >= 3 && got.length >= 3 && editDistance(wanted, got) <= 1;
}

/**
 * Place types a hiking waypoint is never one of.
 *
 * 보국문 is a gate on the 북한산성 ridge. 북한산보국문 is a station on the
 * 우이신설선, 2.7km away at the bottom of the valley - and it is what Places
 * returns first for "북한산 보국문", because the station's name contains the
 * query exactly while the gate's does not.
 *
 * Worth naming as a class rather than one station at a time: Korean transit is
 * full of stops named after the mountain above them (북한산우이, 도봉산, 관악산).
 */
export const NOT_A_WAYPOINT = new Set([
  "subway_station",
  "train_station",
  "light_rail_station",
  "transit_station",
  "transit_depot",
  "bus_station",
  "bus_stop",
  "airport",
  // The same station listed a second time - "북한산보국문역(우이신설선)" -
  // carries none of the types above, only this one.
  "transportation_service",
]);

/** Names that are asking for a station, so the rule above does not apply. */
const ASKING_FOR_TRANSIT = /역$|역\s|버스\s*종점|정류장|터미널|station/i;
/** Names that are asking for a station specifically. */
const STATION_NAME = /역$|역\s/;

/** Two waypoints closer than this are one place under two names. */
export const SAME_PLACE_M = 60;

/**
 * Whether a search result can stand for the waypoint that was asked for.
 *
 * Every caller that resolves a waypoint needs all of these and they were
 * written out five times, each under a comment promising to keep the others in
 * step. A comment is not a mechanism; this is.
 */
export function isUsableWaypoint(
  asked: string,
  found: string,
  types: readonly string[],
  place: string,
): boolean {
  // No name came back, so there is nothing to disagree with. Refusing here
  // would refuse everything: isPlausibleMatch reads an empty name as a generic
  // answer to a specific question, which is right when a lookup returned
  // 북한산국립공원 and wrong when it returned a name we simply did not ask for.
  if (!found.trim()) return !types.some((type) => NOT_A_WAYPOINT.has(type));
  const isTransit = types.some((type) => NOT_A_WAYPOINT.has(type));
  // Plenty of courses start at a station - 사당역, 도봉산역 - and refusing
  // transit for those found nothing, then took whatever was left: 사당역
  // resolved to 사당역포차, a bar named after it.
  if (isTransit && !ASKING_FOR_TRANSIT.test(asked)) return false;
  // And a name ending in 역 is answered only by an actual station. Google
  // lists Korean stations without the suffix, so 망월사역 comes back as
  // "망월사" - and so does the temple a kilometre up the hill.
  if (STATION_NAME.test(asked) && !isTransit) return false;
  return isPlausibleMatch(asked, found, place);
}
