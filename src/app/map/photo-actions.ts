"use server";

import { revalidatePath } from "next/cache";
import { requireApprovedMember } from "@/lib/supabase/require-role";
import { deleteStorageObjects } from "./photo-storage";

// Deleting a single photo is open to any approved member - the club treats the
// shared album as communal, so it is not restricted to the uploader or admins.
// Activity and folder deletion stay in admin-actions.ts.
export async function deletePhoto(photoId: string): Promise<void> {
  const { supabase } = await requireApprovedMember();

  const { data, error } = await supabase
    .from("photos")
    .select("storage_key_original")
    .eq("id", photoId)
    .maybeSingle();
  if (error) throw error;

  const photo = data as { storage_key_original: string } | null;
  if (!photo) throw new Error("사진을 찾을 수 없습니다.");

  const { error: deleteError } = await supabase.from("photos").delete().eq("id", photoId);
  if (deleteError) throw deleteError;

  // After the row is gone: if this failed first, the row would survive
  // pointing at a file that no longer exists.
  await deleteStorageObjects([photo.storage_key_original]);

  revalidatePath("/map");
}
