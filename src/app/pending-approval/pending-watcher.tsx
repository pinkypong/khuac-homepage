"use client";

import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";

// Approval is a human pressing a button somewhere else, so there is nothing to
// react to - the page has to ask. Slow enough that waiting all afternoon costs
// nothing, and the focus check below covers the case that actually happens:
// someone leaves the tab, gets approved, and comes back.
const POLL_MS = 15000;

/**
 * Sends a member on once an admin approves them.
 *
 * Without this the waiting screen is a dead end: the approval lands in the
 * database and nothing on screen changes, so the member is left wondering
 * whether to reload, sign out, or ask again.
 */
export function PendingWatcher() {
  useEffect(() => {
    const supabase = createClient();
    let stopped = false;

    async function check() {
      if (stopped || document.visibilityState !== "visible") return;

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        // Signed out in another tab; let the middleware sort out where to go.
        window.location.assign("/");
        return;
      }

      // members_select always allows reading your own row, approved or not.
      const { data } = await supabase
        .from("members")
        .select("role")
        .eq("auth_user_id", user.id)
        .single();

      const role = (data as { role: string } | null)?.role;
      if (role === "member" || role === "admin") {
        // "/" rather than /login: they are already signed in, and the
        // middleware routes an approved member to the map from here.
        window.location.assign("/");
      }
    }

    const id = window.setInterval(check, POLL_MS);
    document.addEventListener("visibilitychange", check);

    return () => {
      stopped = true;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", check);
    };
  }, []);

  return null;
}
