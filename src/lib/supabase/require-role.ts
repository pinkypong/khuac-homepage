import "server-only";
import { createClient } from "@/lib/supabase/server";

export class RoleError extends Error {
  status: 401 | 403;
  constructor(status: 401 | 403) {
    super(status === 401 ? "Not authenticated" : "Forbidden");
    this.status = status;
  }
}

async function currentMember() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { supabase, member: null };

  const { data: member } = await supabase
    .from("members")
    .select("id, role")
    .eq("auth_user_id", user.id)
    .single();

  return { supabase, member: member as { id: string; role: string } | null };
}

// Any signed-in, approved (non-pending) member. Used by anything gating
// actual app content - e.g. photo upload, the resized-image route.
export async function requireApprovedMember() {
  const { supabase, member } = await currentMember();
  if (!member) throw new RoleError(401);
  if (member.role !== "member" && member.role !== "admin") throw new RoleError(403);
  // isAdmin rides along because the role was already read: actions that gate
  // one branch on it (deleting someone else's comment) would otherwise pay for
  // a second lookup of the same row.
  return { supabase, memberId: member.id, isAdmin: member.role === "admin" };
}

// Any signed-in member, approval pending or not. Deliberately weaker than
// requireApprovedMember: someone waiting in the queue still has to be able to
// fix the name Google picked for them, and that is the moment an admin reads
// it to decide whether to let them in.
export async function requireMember() {
  const { supabase, member } = await currentMember();
  if (!member) throw new RoleError(401);
  return { supabase, memberId: member.id, role: member.role };
}

// Shared by every admin-only server action. Middleware already blocks
// non-admins from /admin/* pages, but actions re-check independently since
// they're reachable as their own POST targets.
export async function requireAdminSession() {
  const { supabase, member } = await currentMember();
  if (!member) throw new RoleError(401);
  if (member.role !== "admin") throw new RoleError(403);
  return { supabase, adminId: member.id };
}
