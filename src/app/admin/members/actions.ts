"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

async function requireAdminSession() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { data: member } = await supabase
    .from("members")
    .select("role")
    .eq("auth_user_id", user.id)
    .single();

  if (member?.role !== "admin") throw new Error("Forbidden: admin only");
  return supabase;
}

export async function approveMember(memberId: string) {
  const supabase = await requireAdminSession();
  // RLS still applies here: members_update allows this because the caller is
  // an admin, and prevent_self_role_change likewise only exempts admins.
  const { error } = await supabase
    .from("members")
    .update({ role: "member" })
    .eq("id", memberId);
  if (error) throw error;
  revalidatePath("/admin/members");
}

export async function rejectMember(authUserId: string) {
  await requireAdminSession();
  // Deleting the auth user (not just the members row) requires the service-role
  // Admin API; auth_user_id -> members has ON DELETE CASCADE, so the pending
  // members row disappears with it. Someone rejected this way has to sign up
  // again from scratch if they want to retry.
  const admin = createAdminClient();
  const { error } = await admin.auth.admin.deleteUser(authUserId);
  if (error) throw error;
  revalidatePath("/admin/members");
}
