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
