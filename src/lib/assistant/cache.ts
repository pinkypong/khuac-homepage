/**
 * Keys for the club-wide answer cache.
 *
 * Kept free of `server-only` and of any Supabase import so the normalisation
 * rule itself can be tested directly - it decides whether two members share an
 * answer, which is the whole point of the cache.
 */

/** Two weeks. Long enough that a season's worth of asking about the same
    mountain is answered once; short enough that a closure notice in a stored
    answer does not outlive the closure by much. */
export const CACHE_TTL_DAYS = 14;

/**
 * Bumped whenever the prompts change in a way that should produce a different
 * answer to the same question.
 *
 * Without this, a fix to the prompt was invisible: "도봉산 등반루트" had been
 * asked before 등반 and 등산 were told apart, and every later ask replayed the
 * old hiking answer from the cache. Versioning the key retires those rows
 * instead of leaving the club reading yesterday's mistake for two weeks.
 *
 * v2: climbing questions answer with crag routes, not hiking trails; answers
 * open without a preamble; small practice crags are screened out.
 * v3: citations are per course and carry the site they came from, and answers
 * offer up to six courses rather than four.
 * v4: waypoints are listed in the order they are walked, and one place is not
 * named twice. The map joins consecutive waypoints, so an order that reads
 * fine in a sentence drew a climb, a descent and a second climb.
 */
export const PROMPT_VERSION = "v4";

/**
 * Collapses the differences that should not cost a second search: spacing,
 * case, and the trailing punctuation people add when they are being polite to
 * a machine. Deliberately conservative - "관악산 코스" and "관악산 겨울 코스"
 * stay separate questions, because they have different answers.
 */
export function cacheKey(question: string): string {
  const normalised = question
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[?!.,～~]+$/u, "")
    .trim();
  return `${PROMPT_VERSION}:${normalised}`;
}

export function isFresh(createdAt: string, now: Date = new Date()): boolean {
  const age = now.getTime() - new Date(createdAt).getTime();
  return Number.isFinite(age) && age >= 0 && age < CACHE_TTL_DAYS * 86_400_000;
}

/** "3일 전", for the badge on a reused answer. */
export function ageLabel(createdAt: string, now: Date = new Date()): string {
  const minutes = Math.floor((now.getTime() - new Date(createdAt).getTime()) / 60_000);
  if (!Number.isFinite(minutes) || minutes < 1) return "방금";
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  return `${Math.floor(hours / 24)}일 전`;
}
