import "server-only";
import { createClient } from "@/lib/supabase/server";

// Shared by every admin-only server action. Middleware already blocks
// non-admins from /admin/* pages, but actions re-check independently since
// they're reachable as their own POST targets.
export async function requireAdminSession() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { data: member } = await supabase
    .from("members")
    .select("id, role")
    .eq("auth_user_id", user.id)
    .single();

  if (member?.role !== "admin") throw new Error("Forbidden: admin only");
  return { supabase, adminId: member.id as string };
}
