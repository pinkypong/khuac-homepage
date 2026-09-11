"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdminSession } from "@/lib/supabase/require-role";

export async function approveMember(memberId: string) {
  const { supabase } = await requireAdminSession();
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

/**
 * Removes an already-approved member.
 *
 * Mechanically the same as rejectMember, but kept separate because it is a
 * different decision with a different blast radius: the photos, activities and
 * comments this person left behind stay, and lose their name. The FK actions
 * that make that true are in 20260911190000_member_removal.sql.
 */
export async function removeMember(authUserId: string) {
  const { supabase, adminId } = await requireAdminSession();

  // Removing yourself deletes your own auth user, which logs you out of an
  // account that no longer exists - and if you were the only admin, nobody can
  // approve anyone again. Demoting or removing an admin has to go through
  // another admin.
  const { data, error: lookupError } = await supabase
    .from("members")
    .select("id")
    .eq("auth_user_id", authUserId)
    .single();
  if (lookupError) throw lookupError;
  if ((data as { id: string }).id === adminId) {
    throw new Error("자기 자신은 방출할 수 없습니다.");
  }

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.deleteUser(authUserId);
  if (error) throw error;
  revalidatePath("/admin/members");
  revalidatePath("/members");
}
