"use server";

import { revalidatePath } from "next/cache";
import { requireAdminSession } from "@/lib/supabase/require-role";
import { deleteStorageObjects, photoKeysForHikes } from "./photo-storage";

export async function deleteActivity(hikeId: string): Promise<void> {
  const { supabase } = await requireAdminSession();

  const storageKeys = await photoKeysForHikes(supabase, [hikeId]);

  // photos.hike_id is ON DELETE SET NULL, not CASCADE, so the photo rows have
  // to be removed explicitly or they survive as unattached orphans.
  // (hike_participants does cascade and needs no help.)
  const { error: photosError } = await supabase.from("photos").delete().eq("hike_id", hikeId);
  if (photosError) throw photosError;

  const { error } = await supabase.from("hikes").delete().eq("id", hikeId);
  if (error) throw error;

  await deleteStorageObjects(storageKeys);

  revalidatePath("/map");
}

export async function deleteLocation(locationId: string): Promise<void> {
  const { supabase } = await requireAdminSession();

  // hikes.location_id is also ON DELETE SET NULL, so dropping the location on
  // its own would leave its hikes alive but detached - invisible on the map
  // and still billing for their photos. Walk the tree deepest-first instead.
  const { data: hikeRows, error: hikesError } = await supabase
    .from("hikes")
    .select("id")
    .eq("location_id", locationId);
  if (hikesError) throw hikesError;

  const hikeIds = ((hikeRows ?? []) as { id: string }[]).map((h) => h.id);
  const storageKeys = await photoKeysForHikes(supabase, hikeIds);

  if (hikeIds.length > 0) {
    const { error: photosError } = await supabase.from("photos").delete().in("hike_id", hikeIds);
    if (photosError) throw photosError;

    const { error: hikeError } = await supabase.from("hikes").delete().in("id", hikeIds);
    if (hikeError) throw hikeError;
  }

  const { error } = await supabase.from("locations").delete().eq("id", locationId);
  if (error) throw error;

  await deleteStorageObjects(storageKeys);

  revalidatePath("/map");
}
