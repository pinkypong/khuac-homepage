import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { deleteObject, listObjects } from "@/lib/r2/client";

// Plain module, not "use server": these helpers are shared by the photo and
// admin actions, and exporting them from an action file would publish them as
// callable endpoints.

type Supabase = Awaited<ReturnType<typeof createClient>>;

// Workers caps the number of subrequests one invocation may open, and a
// location can hold hundreds of photos times however many derived variants -
// so R2 deletes go out in small batches instead of one giant Promise.all.
const DELETE_BATCH_SIZE = 10;

export async function photoKeysForHikes(
  supabase: Supabase,
  hikeIds: string[],
): Promise<string[]> {
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
export async function deleteStorageObjects(storageKeys: string[]): Promise<void> {
  if (storageKeys.length === 0) return;

  let variantPrefixes: string[] = [];
  try {
    variantPrefixes = (await listObjects("derived/", "/")).prefixes;
  } catch (err) {
    console.error("[map/photo-storage] listing derived variants failed:", err);
  }

  const keys = storageKeys.flatMap((storageKey) => [
    storageKey,
    ...variantPrefixes.map((prefix) => `${prefix}${storageKey}.webp`),
  ]);

  for (let i = 0; i < keys.length; i += DELETE_BATCH_SIZE) {
    await Promise.all(
      keys.slice(i, i + DELETE_BATCH_SIZE).map((key) =>
        deleteObject(key).catch((err) => {
          console.error(`[map/photo-storage] R2 delete failed for ${key}:`, err);
        }),
      ),
    );
  }
}
