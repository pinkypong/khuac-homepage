"use server";

import { revalidatePath } from "next/cache";
import { requireApprovedMember } from "@/lib/supabase/require-role";
import { sanitizeTrack } from "@/lib/gps/track";

// The GPX file itself is parsed in the browser (Workers have no XML parser),
// so what arrives here is already just coordinates - validate them anyway.
export async function saveHikeTrack(hikeId: string, points: unknown) {
  const { supabase } = await requireApprovedMember();

  const track = sanitizeTrack(points);
  if (!track) throw new Error("유효한 좌표가 없는 GPX 파일입니다.");

  // hikes_update RLS still applies: only the hike's creator or an admin.
  const { error } = await supabase.from("hikes").update({ track }).eq("id", hikeId);
  if (error) throw error;

  revalidatePath("/map");
  return { pointCount: track.length };
}

export async function clearHikeTrack(hikeId: string) {
  const { supabase } = await requireApprovedMember();
  const { error } = await supabase.from("hikes").update({ track: null }).eq("id", hikeId);
  if (error) throw error;
  revalidatePath("/map");
}
