"use server";

import { requireApprovedMember } from "@/lib/supabase/require-role";
import { presignGetUrl } from "@/lib/r2/presign";

// The original stays private in R2; members get a short-lived signed URL
// rather than the bucket being made public.
export async function getOriginalUrl(photoId: string): Promise<string> {
  const { supabase } = await requireApprovedMember();

  const { data, error } = await supabase
    .from("photos")
    .select("storage_key_original")
    .eq("id", photoId)
    .single();
  if (error) throw error;

  return presignGetUrl((data as { storage_key_original: string }).storage_key_original);
}
