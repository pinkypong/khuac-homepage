"use server";

import { revalidatePath } from "next/cache";
import { requireAdminSession } from "@/lib/supabase/require-role";

export async function matchExistingLocation(photoId: string, formData: FormData) {
  const { supabase } = await requireAdminSession();
  const locationId = formData.get("locationId") as string | null;
  if (!locationId) throw new Error("locationId required");

  const { error } = await supabase
    .from("photos")
    .update({ matched_location_id: locationId, location_match_status: "manual_matched" })
    .eq("id", photoId);
  if (error) throw error;
  revalidatePath("/admin/photos/unmatched");
}

export async function createLocationAndMatch(photoId: string, formData: FormData) {
  const { supabase, adminId } = await requireAdminSession();

  const name = (formData.get("name") as string | null)?.trim();
  if (!name) throw new Error("name required");
  const latRaw = (formData.get("lat") as string | null)?.trim();
  const lngRaw = (formData.get("lng") as string | null)?.trim();
  const lat = latRaw ? Number(latRaw) : null;
  const lng = lngRaw ? Number(lngRaw) : null;

  const { data: location, error: insertError } = await supabase
    .from("locations")
    .insert({ name, lat, lng, created_by: adminId })
    .select("id")
    .single();
  if (insertError) throw insertError;

  const { error: updateError } = await supabase
    .from("photos")
    .update({
      matched_location_id: (location as { id: string }).id,
      location_match_status: "manual_matched",
    })
    .eq("id", photoId);
  if (updateError) throw updateError;

  revalidatePath("/admin/photos/unmatched");
}
