/**
 * How far a course's origin is to be trusted.
 *
 *   gpx     somebody walked it with a recorder running
 *   knps    the park surveyed it
 *   forest  산림청 wrote it down in prose, and we read the prose - not a
 *           measured line before it was filed
 *   club    a member wrote it down
 *   search  a grounded web search said so, and nothing has checked it
 *
 * search sits last and is still kept, because for 불암산 or 수락산 it is all
 * there is: nothing holds those mountains, and an unchecked answer beats no
 * answer. It is the row a better source is expected to replace later.
 *
 * Lives here rather than beside its first caller because a "use server" file
 * cannot export a plain object, so the second caller that needed it would
 * have had to keep its own copy - and a second copy of this table is exactly
 * how the 502 `forest` rows once ended up outranked by web searches.
 */
export const ORIGIN_RANK: Record<string, number> = { gpx: 5, knps: 4, club: 3, forest: 2, search: 1 };

/**
 * An origin nobody listed ranks with `search`, not below it.
 *
 * It used to fall to 0, which is lower than every real source - so a row filed
 * under an origin added later would sort last and, worse, `rememberCourses`
 * would let a web search overwrite it, because its guard asks whether the held
 * row outranks `search`. That is exactly what happened to the 502 rows imported
 * as `forest` before it was named here.
 */
export const rankOf = (origin: string | null | undefined): number =>
  ORIGIN_RANK[origin ?? "search"] ?? ORIGIN_RANK.search;
