"use server";

import { requireMember, RoleError } from "@/lib/supabase/require-role";

/**
 * Records that this member is here, now.
 *
 * Deliberately not revalidating anything. It runs about once a minute per open
 * tab, and a revalidatePath on that schedule would throw away the map's cached
 * render all day for a column nothing on that page reads.
 *
 * Nothing is returned and nothing throws. A signed-out visitor sitting on a
 * page that still has this mounted is not an error worth reporting, and a
 * failed heartbeat costs one minute of staleness on a screen only an admin
 * looks at.
 */
export async function touchPresence(): Promise<void> {
  try {
    const { supabase, memberId } = await requireMember();
    await supabase
      .from("members")
      .update({ last_seen: new Date().toISOString() })
      .eq("id", memberId);
  } catch (err) {
    if (err instanceof RoleError) return;
    console.error("[presence] heartbeat failed:", err);
  }
}
