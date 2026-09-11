"use server";

import { revalidatePath } from "next/cache";
import { requireMember } from "@/lib/supabase/require-role";
import { MAX_NAME_LENGTH } from "./name";

/**
 * Renames the caller. members_update already restricts a member to their own
 * row and prevent_self_role_change guards the one column that matters, so this
 * needs no privileges beyond being signed in.
 */
export async function updateMyName(name: string): Promise<string> {
  const { supabase, memberId } = await requireMember();

  // Collapse runs of whitespace: a name pasted out of a Google profile often
  // carries a double space, and it would show up on every photo caption.
  const trimmed = name.trim().replace(/\s+/g, " ");
  if (!trimmed) throw new Error("이름을 입력해주세요.");
  if (trimmed.length > MAX_NAME_LENGTH) {
    throw new Error(`이름은 ${MAX_NAME_LENGTH}자까지 쓸 수 있습니다.`);
  }

  const { error } = await supabase.from("members").update({ name: trimmed }).eq("id", memberId);
  if (error) throw error;

  // The name is stamped on every photo and comment the map renders.
  revalidatePath("/map");
  return trimmed;
}
