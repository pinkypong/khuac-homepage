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

const HANGUL_BASE = 0xac00;
const HANGUL_LAST = 0xd7a3;

/**
 * One Hangul block as the three letters it is built from, or null for anything
 * that is not one.
 *
 * A Korean syllable is a single visual block for a sound made of two or three
 * letters, so comparing whole blocks makes every one-block difference look the
 * same size. It is not: 영취사 written 영추사 is one temple spelled two ways,
 * and 인수암 read as 인수봉 is a hermitage read as the rock peak 375m from it.
 */
function syllable(char: string): { initial: number; medial: number; final: number } | null {
  const code = char.codePointAt(0) ?? 0;
  if (code < HANGUL_BASE || code > HANGUL_LAST) return null;
  const offset = code - HANGUL_BASE;
  return {
    initial: Math.floor(offset / (21 * 28)),
    medial: Math.floor((offset % (21 * 28)) / 28),
    final: offset % 28,
  };
}

/**
 * Whether two names are one name spelled two ways.
 *
 * Only a vowel may move, and only in one syllable. 영추사 and 영취사 hold their
 * consonants and disagree on ㅜ against ㅟ, which is what a transliteration or
 * a slip of the pen does to a name.
 *
 * A 받침 is not a spelling. 불암사 and 불암산 differ by one letter on any count
 * that treats letters as letters - the ㄴ that 사 lacks and 산 carries - and
 * they are a temple and the mountain standing over it, 600m apart; 호암사 and
 * 호암산 are the same pair, and a course naming the temple was drawn to the
 * mountain. Korean hangs the word on that final consonant, so a name that
 * gains or loses one is a different name, and an initial consonant says which
 * word it is at all.
 */
function spelledTheSameWay(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let differing = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === b[i]) continue;
    if (++differing > 1) return false;
    const one = syllable(a[i]);
    const other = syllable(b[i]);
    // Outside Hangul there is no vowel to have spelled differently.
    if (!one || !other) return false;
    if (one.initial !== other.initial || one.final !== other.final) return false;
  }
  return differing === 1;
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
 * Tolerant on purpose, but only by a single character. 영추사 and 영취사 are
 * the same temple spelled two ways, and one character apart is the kind of
 * difference a name picks up in the telling; 밤골 and 북한산성 are four apart
 * and nothing here confuses them. Nor does 인수암 and 인수봉 - a hermitage and
 * a rock peak 375m apart that share only their first two characters - which a
 * looser rule used to accept on that shared prefix alone. Anything without a
 * distinctive part left - a bare 북한산 - is accepted, since there is nothing
 * to disagree with.
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
  // 망월사 갈림길 answered with 망월사 - names the same feature less fully, and
  // the answer is close enough to be worth taking.
  //
  // Close enough to name it, not close enough to route through: the temple is
  // 426m off the 다락능선 ridge its junction sits on, and walking down to it
  // and back added 1,601m to a 3.33km course. Which is why a name of that
  // shape is not routed through at all any more - see placeHints in snap.ts,
  // where the junction is put on the line where the line passes the temple.
  if (wanted.endsWith(got) && wanted !== got) return false;
  if (got.includes(wanted) || wanted.includes(got)) return true;
  // Sharing a couple of characters used to be enough on its own - any run of
  // two - which is how 인수암 (a hermitage) and 인수봉 (the rock peak 375m
  // away) came out "plausible": both start 인수, and a run of two characters
  // is all the old rule asked for. That is a prefix match wearing a different
  // name, the exact shape CLAUDE.md already warns about, and it would have
  // taken any two names sharing a first syllable as the same place. Character
  // overlap without position or length review is gone.
  //
  // What is left is the one difference that is a spelling rather than a
  // different word: a single syllable whose vowel moved. Counting letters and
  // allowing any one of them to change was close but not it - 불암사 and 불암산
  // are one letter apart by that count, and they are a temple and the mountain
  // above it. Which letter moved is the whole question.
  return wanted.length >= 3 && got.length >= 3 && spelledTheSameWay(wanted, got);
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
 *
 * The same shape broke a bare "정상" two different ways: Places' only answer
 * to "불암산 정상" was 불암산 itself, which isPlausibleMatch refuses (a mountain's
 * bare name shares no text with the word 정상), so the search fell back to
 * "정상" alone and took 정상어학원 중계분원 - a cram school 3km away that starts
 * with the same two syllables. 수락산 hit the identical hagwon for the same
 * reason. Both routed legs on either side of it came back with no path at all.
 * A hagwon is never a hiking waypoint regardless of what it is named, so it
 * belongs excluded here rather than left for the name comparison to catch.
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
  // 학원 chains: educational_institution is the type Places gives an academy;
  // child_care_agency showed up on one branch of the same chain.
  "educational_institution",
  "school",
  "child_care_agency",
]);

/** Names that are asking for a station, so the rule above does not apply. */
const ASKING_FOR_TRANSIT = /역$|역\s|버스\s*종점|정류장|터미널|station/i;
/** Names that are asking for a station specifically. */
const STATION_NAME = /역$|역\s/;

/**
 * A waypoint that names the top of the hill rather than a place on it.
 *
 * These are the one class of waypoint whose right answer is the mountain
 * itself. Places has no separate entry for 불암산's summit - asked for
 * "불암산 정상" it offers 불암산, tagged mountain_peak - and the name comparison
 * throws that away, because 불암산 and 정상 share no letters at all. The search
 * then falls back to the bare word and finds whatever nearby business is
 * called 정상, which is how a cram school ended up in the middle of a course.
 *
 * Only these words, and only against a peak: a bare mountain name is the right
 * answer to "the summit" and the wrong answer to almost anything else, so
 * "주차장" answered with 불암산 stays refused.
 */
const SUMMIT_WORD = /^(정상|정상부|산정|꼭대기)$/;
/** What Places calls a summit. */
const PEAK_TYPE = "mountain_peak";

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
  // The summit, answered with the mountain. Checked here rather than inside
  // isPlausibleMatch because it turns on the type, which the name comparison
  // never sees.
  if (
    SUMMIT_WORD.test(asked.trim())
    && types.includes(PEAK_TYPE)
    && normalisePoiName(found) === normalisePoiName(place)
  ) return true;
  return isPlausibleMatch(asked, found, place);
}
