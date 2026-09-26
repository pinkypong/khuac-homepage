import { requireApprovedMember } from "@/lib/supabase/require-role";
import { rankOf } from "./origin";
import type { RouteSuggestion } from "./routes";

type Client = Awaited<ReturnType<typeof requireApprovedMember>>["supabase"];

/**
 * The key a course is matched back on.
 *
 * (mountain, name) is what the library makes unique, and every caller here is
 * already working within one mountain, so the name alone settles it.
 */
export const courseKey = (name: string) => name.trim().toLowerCase();

/**
 * Files what a search found, so the next question about this mountain is fast.
 * Hands back the id of every course it filed or found already held, so the
 * album a member makes from one can point at it.
 *
 * Lives here rather than beside the assistant's own action because a
 * "use server" file can only export endpoints, and the album screen needs to
 * call this too - it offers the same search when a place holds no courses yet.
 * A second copy of the guard below is not something to have twice.
 */
export async function rememberCourses(
  supabase: Client,
  mountain: string | null,
  routes: RouteSuggestion[],
  /** Where the asking folder is, when one asked. Written onto the new rows so
      they group with that folder's mountain: filed with no region, a row joins
      whichever one mountain of its name already has a place - and for 삼성산
      that is the one in 경산시, so every course the album screen found for
      the 관악구·안양시 삼성산 would have been filed as the Gyeongsan one's and
      then, correctly, hidden from the folder that asked for it. */
  region?: string | null,
): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  if (!mountain || routes.length === 0) return ids;

  // What a search found must not overwrite what a survey or a member filed.
  // The upsert below keys on (mountain, name), so a search answer that lands on
  // an existing name replaces it - and the row it replaced may be the one whose
  // distance was checked against a measured line. Read the names first and drop
  // the ones already held by a better source.
  //
  // Two searches racing here can still both pass this check and the later write
  // wins; that costs one search row overwriting another, which is what would
  // have happened anyway. It is the knps/club/gpx rows this is protecting.
  const { data: existing } = await supabase
    .from("course_library")
    .select("id, name, origin")
    .eq("mountain", mountain)
    .in("name", routes.map((route) => route.name));
  const held = (existing ?? []) as { id: string; name: string; origin: string | null }[];
  const heldBetter = new Set(
    held.filter((row) => rankOf(row.origin) > rankOf("search")).map((row) => row.name),
  );
  // A course we refused to overwrite is still the course this answer is about,
  // and its row is the one an album should point at.
  for (const row of held) ids.set(courseKey(row.name), row.id);

  const rows = routes.filter((route) => !heldBetter.has(route.name)).map((route) => ({
    mountain,
    name: route.name,
    waypoints: route.waypoints,
    distance_text: route.distanceText,
    duration_text: route.durationText,
    difficulty: route.difficulty,
    description: route.description,
    notes: route.notes,
    sources: route.sourceUrls ?? [],
    origin: "search",
    updated_at: new Date().toISOString(),
    // Only when given: the assistant's own filing has no folder behind it, and
    // an upsert that wrote null here would wipe a region a better pass set.
    ...(region ? { region } : {}),
  }));
  if (rows.length === 0) return ids;
  const { data: written, error } = await supabase
    .from("course_library")
    .upsert(rows, { onConflict: "mountain,name" })
    .select("id, name");
  if (error) {
    console.error("[assistant/library] store failed", error.message);
    return ids;
  }
  for (const row of (written ?? []) as { id: string; name: string }[]) {
    ids.set(courseKey(row.name), row.id);
  }
  return ids;
}
