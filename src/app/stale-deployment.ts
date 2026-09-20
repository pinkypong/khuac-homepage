"use client";

/**
 * Recovers a tab that was left open across a deploy.
 *
 * Server actions are addressed by an id built into the bundle the page was
 * loaded with, and a deploy retires the old ids. A phone with khuac.com still
 * open then asks for an action that no longer exists, the Worker answers 404
 * with "Failed to find Server Action", and the feature simply does nothing -
 * no error on screen, no line on the map. It cost most of an afternoon to
 * recognise, because every check of the deployed code said it was correct.
 *
 * Members will meet this far more often than we will: a course looked at in
 * the morning, a deploy at lunch, and the map quietly stops drawing until
 * something makes them reload. So the page reloads itself, which is what a
 * reader would have to do by hand and cannot be expected to guess.
 *
 * Once a minute at most. A reload that does not fix the problem must not
 * become a loop, and one minute is far longer than a reload takes while being
 * far shorter than the gap between two deploys anyone would notice.
 */
const MARK = "khuac:reloaded-for-deploy";
const COOLDOWN_MS = 60_000;

/** True when this error is the deployment mismatch rather than a real fault. */
export function isStaleDeployment(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  // Next names the action in its own message; the 404 is what reaches the
  // browser when the Worker could not find it.
  // Only the two sentences that name this exact failure. "status: 404" and
  // "Unexpected response" were in here too, which was survivable while this
  // was called from one place and is not now that it listens to every
  // rejection on the page: a photo that 404s or any other unlucky wording
  // would reload the page under somebody mid-sentence, and a reload nobody
  // asked for is worse than the error it replaces.
  return message.includes("Failed to find Server Action")
    // What the browser is shown; the Worker's own log words it differently.
    || message.includes("was not found on the server");
}

/**
 * Reloads if this error means the page is older than the deployment, and
 * reports whether it did, so the caller can leave its own error handling alone.
 */
export function recoverFromStaleDeployment(error: unknown): boolean {
  if (typeof window === "undefined" || !isStaleDeployment(error)) return false;
  try {
    const last = Number(sessionStorage.getItem(MARK) ?? 0);
    if (Date.now() - last < COOLDOWN_MS) return false;
    sessionStorage.setItem(MARK, String(Date.now()));
  } catch {
    // Private browsing refuses storage. Reloading once is still the right
    // answer; without the mark this can repeat, which the cooldown above
    // exists to prevent and this case has to do without.
  }
  window.location.reload();
  return true;
}

/**
 * What to say instead of reloading, when the member has something typed.
 *
 * Reloading is the right answer for a page that failed on its way in - nothing
 * is lost and a reader cannot be expected to guess. It is the wrong answer the
 * moment there is a half-written comment or a course being edited on screen:
 * the reload takes the work with it, and a recovery that destroys what it was
 * protecting is worse than the error.
 *
 * So call sites holding unsaved input use this and stay put; the rest call
 * recoverFromStaleDeployment and let the page come back fresh.
 */
export const STALE_DEPLOYMENT_NOTICE =
  "새 버전이 배포되었습니다. 새로고침한 뒤 다시 시도해주세요. 적으신 내용은 그대로 있습니다.";

/** The notice when this error is the deploy mismatch, null when it is a real fault. */
export function staleDeploymentMessage(error: unknown): string | null {
  return isStaleDeployment(error) ? STALE_DEPLOYMENT_NOTICE : null;
}
