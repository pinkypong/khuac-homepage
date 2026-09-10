"use server";

import { revalidatePath } from "next/cache";
import { requireAdminSession } from "@/lib/supabase/require-role";
import { deleteObject, listObjects } from "@/lib/r2/client";

type Supabase = Awaited<ReturnType<typeof requireAdminSession>>["supabase"];

// Workers caps the number of subrequests one invocation may open, and a
// location can hold hundreds of photos times however many derived variants -
// so R2 deletes go out in small batches instead of one giant Promise.all.
const DELETE_BATCH_SIZE = 10;

async function photoKeysForHikes(supabase: Supabase, hikeIds: string[]): Promise<string[]> {
  if (hikeIds.length === 0) return [];
  const { data, error } = await supabase
    .from("photos")
    .select("storage_key_original")
    .in("hike_id", hikeIds);
  if (error) throw error;
  return ((data ?? []) as { storage_key_original: string }[]).map((p) => p.storage_key_original);
}

/**
 * Removes each original plus every cached thumbnail derived from it.
 *
 * Derived files live at `derived/w<width>q<quality>/<storage key>.webp`, so no
 * single prefix covers one photo's variants. Listing `derived/` with a
 * delimiter returns just the variant folders (a handful), and each photo's
 * entry inside them is then addressable by name.
 *
 * Nothing here throws: an orphaned object only costs storage, while letting an
 * R2 hiccup abort the caller would leave a half-deleted record behind.
 */
async function deleteStorageObjects(storageKeys: string[]): Promise<void> {
  if (storageKeys.length === 0) return;

  let variantPrefixes: string[] = [];
  try {
    variantPrefixes = (await listObjects("derived/", "/")).prefixes;
  } catch (err) {
    console.error("[map/admin-actions] listing derived variants failed:", err);
  }

  const keys = storageKeys.flatMap((storageKey) => [
    storageKey,
    ...variantPrefixes.map((prefix) => `${prefix}${storageKey}.webp`),
  ]);

  for (let i = 0; i < keys.length; i += DELETE_BATCH_SIZE) {
    await Promise.all(
      keys.slice(i, i + DELETE_BATCH_SIZE).map((key) =>
        deleteObject(key).catch((err) => {
          console.error(`[map/admin-actions] R2 delete failed for ${key}:`, err);
        }),
      ),
    );
  }
}

export async function deletePhoto(photoId: string): Promise<void> {
  const { supabase } = await requireAdminSession();

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
