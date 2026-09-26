/**
 * Warns before a new location's name collides with one already on file.
 *
 * One folder per mountain is the rule: 숨은암장 is a climb filed under 삼성산,
 * 인수봉 a climb filed under 북한산, not places of their own. The way that rule
 * breaks is a member who does not see 삼성산 in the list and makes "삼성산
 * 숨은암장" beside it - two folders for one mountain, its walks in one and its
 * climbs in the other, which is the split the one-folder rule exists to stop.
 *
 * It warns rather than refuses because the same hit comes from two unrelated
 * places that happen to share a word, and only a person can tell those apart.
 * (Two mountains that share a whole name - 삼성산 near 관악산 and 삼성산 in
 * 경산시 - are told apart by region in pickMountainGroup, not here.)
 */

/** Below this many characters, a shared substring is noise - "산" alone sits
    inside most Korean mountain names and would flag nearly everything. */
const MIN_OVERLAP = 2;

function normalise(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, "");
}

/**
 * The closest existing name this one could be confused with or a duplicate
 * of, or null if nothing is close enough to mention. Checks containment
 * either direction after normalising - "삼성산" inside "삼성산 숨은암장",
 * or the reverse - so it catches both "someone typed the short form of an
 * existing place" and "someone typed a more specific version of one".
 */
export function similarLocationName(name: string, existing: string[]): string | null {
  const candidate = normalise(name);
  if (candidate.length < MIN_OVERLAP) return null;

  for (const other of existing) {
    const known = normalise(other);
    if (known.length < MIN_OVERLAP) continue;
    if (candidate === known) return other;
    if (candidate.includes(known) || known.includes(candidate)) return other;
  }
  return null;
}
