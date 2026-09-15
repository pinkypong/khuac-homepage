/**
 * How a server action says no.
 *
 * A built Worker is a production build, and Next replaces the message of
 * anything a server action throws before it reaches the browser:
 *
 *   "An error occurred in the Server Components render. The specific message
 *    is omitted in production builds to avoid leaking sensitive details."
 *
 * That sentence is in the bundle we are running. Every `throw new Error("구간을
 * 하나 이상 선택해주세요.")` in this app has been landing as that paragraph, in
 * English, on a member who is trying to work out what to do next - and the
 * `err instanceof Error ? err.message : "…"` on the other side, written to pass
 * the reason through, faithfully passes through the placeholder instead.
 *
 * So an expected refusal is a value, not an exception. Exceptions stay for what
 * they are for: a bug, or a request that should not have arrived at all (not
 * being signed in is the app's business, not the member's).
 */
export type ActionResult<T = void> =
  | ({ ok: true } & (T extends void ? { value?: never } : { value: T }))
  | { ok: false; reason: string };

/** A refusal with the reason spelled out for whoever pressed the button. */
export function refused(reason: string): ActionResult<never> {
  return { ok: false, reason };
}

/**
 * A database refusal, in a sentence, with its code kept where it is useful.
 *
 * Supabase hands back a plain `{ message, code, details, hint }` object rather
 * than an Error, so even before production masking it serialised to nothing at
 * all. The code is the part that identifies it - 42501 is the row policy, 23502
 * a missing column, 23505 a duplicate - and the member does not need to read it.
 */
export function refusedByDatabase(
  step: string,
  error: { message: string; code?: string; details?: string; hint?: string },
): ActionResult<never> {
  console.error(`[${step}] 실패`, error.code, error.message, error.details, error.hint);
  return { ok: false, reason: `${step}에 실패했습니다: ${error.message}` };
}
