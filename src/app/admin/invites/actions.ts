"use server";

import { revalidatePath } from "next/cache";
import { requireAdminSession } from "@/lib/supabase/require-admin";

export async function createInvite(formData: FormData) {
  const { supabase, adminId } = await requireAdminSession();

  const label = (formData.get("label") as string | null)?.trim() || null;
  const maxUsesRaw = (formData.get("maxUses") as string | null)?.trim();
  const maxUses = maxUsesRaw ? Number(maxUsesRaw) : null;
  const expiresAtRaw = (formData.get("expiresAt") as string | null)?.trim();
  // <input type="date"> gives "YYYY-MM-DD"; treat it as end-of-day local time.
  const expiresAt = expiresAtRaw ? new Date(`${expiresAtRaw}T23:59:59`).toISOString() : null;

  // Not DB-generated (no pgcrypto dependency): 122 bits from the Web Crypto
  // API, which Cloudflare Workers supports natively.
  const token = crypto.randomUUID().replace(/-/g, "");

  const { error } = await supabase.from("invites").insert({
    token,
    label,
    max_uses: maxUses,
    expires_at: expiresAt,
    created_by: adminId,
  });
  if (error) throw error;
  revalidatePath("/admin/invites");
}

export async function revokeInvite(inviteId: string) {
  const { supabase } = await requireAdminSession();
  const { error } = await supabase
    .from("invites")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", inviteId);
  if (error) throw error;
  revalidatePath("/admin/invites");
}
