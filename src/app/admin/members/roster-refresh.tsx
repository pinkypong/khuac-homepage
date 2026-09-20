"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Matches the heartbeat, so a dot is at most one beat behind the truth. */
const REFRESH_MS = 60_000;

/**
 * Re-reads the roster while an admin is looking at it.
 *
 * The page is a server component, so without this the dots are frozen at
 * whenever it was opened - a list of who is here that never changes is worse
 * than no list, because it looks live and is not.
 *
 * Only while the tab is visible, for the same reason the heartbeat is: an
 * admin's forgotten tab should not keep asking all night.
 */
export function RosterRefresh() {
  const router = useRouter();
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    const timer = setInterval(tick, REFRESH_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [router]);
  return null;
}
