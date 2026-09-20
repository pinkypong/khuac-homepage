"use client";

import { useEffect } from "react";
import { touchPresence } from "./presence-actions";

/** How often an open tab says it is still here. */
const BEAT_MS = 60_000;

/**
 * Tells the server this member is on the site, while they are looking at it.
 *
 * Only while the tab is visible. A browser left open on a phone in somebody's
 * pocket would otherwise report them present for days, which is not presence -
 * it is a tab. Coming back to the tab beats immediately rather than waiting out
 * the interval, so switching back shows as present at once.
 *
 * Mounted inside the map shell rather than the root layout: that is where
 * members actually are, and the layout also serves the login page, where a
 * heartbeat is a request that can only be refused.
 */
export function PresenceBeat() {
  useEffect(() => {
    let stopped = false;
    const beat = () => {
      if (stopped || document.visibilityState !== "visible") return;
      void touchPresence();
    };

    beat();
    const timer = setInterval(beat, BEAT_MS);
    document.addEventListener("visibilitychange", beat);
    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", beat);
    };
  }, []);

  return null;
}
