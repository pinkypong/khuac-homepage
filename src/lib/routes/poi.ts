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
  if (got.includes(wanted) || wanted.includes(got)) return true;
  if (sharesRun(wanted, got)) return true;
  // One character apart is a spelling, but only where there is enough name for
  // one character to be a spelling. 위문 and 관문 are also one apart, and they
  // are twenty kilometres apart on the ground.
  return wanted.length >= 3 && got.length >= 3 && editDistance(wanted, got) <= 1;
}
