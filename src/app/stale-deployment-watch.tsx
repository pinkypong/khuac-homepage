"use client";

import { useEffect } from "react";
import { recoverFromStaleDeployment } from "./stale-deployment";

/**
 * Catches a stale page anywhere, not only where somebody remembered to look.
 *
 * Server actions are addressed by an id built into the bundle a page loaded
 * with, and a deploy retires the old ids. The course preview was taught to
 * recover from that by hand, which fixed the course preview and nothing else:
 * the same failure came back as a red error on an unrelated button, because
 * every other action still turned a retired id into whatever its own error
 * handling did.
 *
 * There is nothing to catch per call. The page is simply older than what it is
 * talking to, and the answer is the same everywhere - reload, at most once a
 * minute so a reload that does not help cannot become a loop.
 */
export function StaleDeploymentWatch() {
  useEffect(() => {
    const onRejection = (event: PromiseRejectionEvent) => {
      if (recoverFromStaleDeployment(event.reason)) event.preventDefault();
    };
    const onError = (event: ErrorEvent) => {
      if (recoverFromStaleDeployment(event.error ?? event.message)) event.preventDefault();
    };
    window.addEventListener("unhandledrejection", onRejection);
    window.addEventListener("error", onError);
    return () => {
      window.removeEventListener("unhandledrejection", onRejection);
      window.removeEventListener("error", onError);
    };
  }, []);

  return null;
}
