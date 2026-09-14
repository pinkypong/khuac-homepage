"use server";

import { revalidatePath } from "next/cache";
import { requireApprovedMember } from "@/lib/supabase/require-role";
import { sanitizeTrack } from "@/lib/gps/track";
import { fetchTrailsInBounds, fetchTrailsNear } from "@/lib/routes/overpass";
import { stitchSegments, type TrailSegment } from "@/lib/routes/trails";
import { snapRouteToTrails, type RouteLeg, type SnapDiagnostics } from "@/lib/routes/snap";
import type { ClubPoi } from "@/lib/routes/poi";
import { groupSegmentsByTile, mergeTileSegments, tilesForBounds, tilesFullyInside } from "@/lib/routes/tiles";
import type { TrailBounds } from "@/lib/routes/overpass";
import { isValidGps } from "@/lib/gps/validate";

/**
 * The mapped paths around an activity, for the member to pick their route from.
 *
 * Most outings have no GPX - nobody remembers to record one - and the map had
 * nothing to draw for them. These are real coordinates from OpenStreetMap, so
 * choosing from them gives a line that follows the ground rather than cutting
 * across it.
 */
export async function loadTrails(lat: number, lng: number): Promise<TrailSegment[]> {
  await requireApprovedMember();
  return fetchTrailsNear(lat, lng);
}

/**
 * Saves the chosen paths as this activity's route.
 *
 * The stitching is redone here rather than trusting a track posted from the
 * browser: the client sends which segments, in what order, and the geometry is
 * rebuilt from a fresh copy so nothing arbitrary can be written into the field
 * the map draws from.
 */
export async function saveTrailRoute(
  hikeId: string,
  lat: number,
  lng: number,
  segmentIds: number[],
): Promise<{ pointCount: number }> {
  const { supabase } = await requireApprovedMember();

  if (segmentIds.length === 0) throw new Error("구간을 하나 이상 선택해주세요.");

  const available = await fetchTrailsNear(lat, lng);
  const byId = new Map(available.map((segment) => [segment.id, segment]));
  const chosen = segmentIds
    .map((id) => byId.get(id))
    .filter((segment): segment is TrailSegment => segment !== undefined);

  if (chosen.length === 0) throw new Error("선택한 구간을 찾지 못했습니다. 다시 시도해주세요.");

  const track = sanitizeTrack(stitchSegments(chosen));
  if (!track) throw new Error("이어지는 경로를 만들지 못했습니다.");

  const { error } = await supabase.from("hikes").update({ track }).eq("id", hikeId);
  if (error) throw error;

  revalidatePath("/map");
  return { pointCount: track.length };
}

/**
 * Pulls a suggested course onto the trails that actually connect its waypoints.
 *
 * The assistant names places; geocoding turns those into points; joining the
 * points with straight lines draws a route over ground nobody walks. This
 * fetches the mapped paths around the course and routes between the waypoints
 * along them, so the line follows switchbacks instead of cutting across them.
 *
 * Server-side because Overpass asks callers to identify themselves and behave,
 * and because the raw response is far larger than the legs it produces.
 */
export interface SnapResult {
  legs: RouteLeg[];
  /** Why a leg might be dashed, so the map can say rather than leave the
      member guessing between "no trail here" and "could not look". */
  trailsLoaded: boolean;
}

export async function snapSuggestedRoute(
  waypoints: { lat: number; lng: number }[],
): Promise<SnapResult> {
  const { supabase } = await requireApprovedMember();
  if (waypoints.length < 2) return { legs: [], trailsLoaded: true };

  // A box around the whole course rather than a circle around its middle. The
  // circle was capped at a 3km radius, so a 6km course from 밤골 to 도선사 had
  // the middle of the mountain outside the query and came back entirely dashed
  // for want of data rather than for want of a path.
  const lats = waypoints.map((w) => w.lat);
  const lngs = waypoints.map((w) => w.lng);
  // Roughly 900m of margin, so a trailhead just outside the course still has
  // the path leading onto it.
  const margin = 0.008;

  const bounds: TrailBounds = {
    south: Math.min(...lats) - margin,
    west: Math.min(...lngs) - margin,
    north: Math.max(...lats) + margin,
    east: Math.max(...lngs) + margin,
  };

  const segments = await trailsForBounds(supabase, bounds);
  if (segments.length === 0) {
    // Nothing to route along, from cache or from Overpass. Straight legs say
    // so honestly rather than the map pretending it looked.
    return {
      legs: waypoints.slice(1).map((point, i) => ({
        points: [[waypoints[i].lat, waypoints[i].lng], [point.lat, point.lng]] as [number, number][],
        onTrail: false,
      })),
      trailsLoaded: false,
    };
  }
  // Logged because none of this is visible from the map: a dashed leg looks
  // the same whether a waypoint was 500m from the nearest path or the path
  // simply does not connect.
  const diagnostics: SnapDiagnostics = { snapDistances: [], legs: [] };
  const legs = snapRouteToTrails(waypoints, segments, diagnostics);
  console.log("[route-actions] snap", JSON.stringify({
    ways: segments.length,
    snapM: diagnostics.snapDistances,
    legs: diagnostics.legs,
  }));
  return { legs, trailsLoaded: true };
}

/**
 * The club's trail geometry for a box, filling any gaps from Overpass.
 *
 * Cached tiles answer first. Overpass is asked only about ground nobody has
 * looked at yet, and if it refuses - which it does; the main instance returned
 * 504 twice in one day while this was written - whatever tiles we already hold
 * are used anyway. Stale trail data is still trail data: paths do not move.
 */
async function trailsForBounds(
  supabase: Awaited<ReturnType<typeof requireApprovedMember>>["supabase"],
  bounds: TrailBounds,
): Promise<TrailSegment[]> {
  const keys = tilesForBounds(bounds);
  const cached = new Map<string, TrailSegment[]>();

  // Both sources at once. 산림청 and 국립공원공단 surveyed these routes and OSM
  // volunteers walked them, and neither is reliably the better record - the
  // forest service data has documented gaps of its own - so a path missing
  // from one is supplied by the other rather than argued with.
  const [osm, official] = await Promise.all([
    supabase.from("trail_tiles").select("tile_key, segments").in("tile_key", keys),
    supabase.from("official_trails").select("segments").in("tile_key", keys),
  ]);
  for (const row of (osm.data ?? []) as unknown as { tile_key: string; segments: TrailSegment[] }[]) {
    cached.set(row.tile_key, row.segments ?? []);
  }
  const officialSegments = ((official.data ?? []) as unknown as { segments: TrailSegment[] }[])
    .flatMap((row) => row.segments ?? []);

  const missing = keys.filter((key) => !cached.has(key));
  if (missing.length === 0) return mergeTileSegments([...cached.values(), officialSegments]);

  try {
    const fetched = await fetchTrailsInBounds(bounds);
    const byTile = groupSegmentsByTile(fetched);
    // Only the tiles this box fully contained. An empty tile is a real answer
    // worth keeping - "no paths here" saves the next preview a fetch - but a
    // tile the box merely clipped would be cached with the ways that fell
    // inside and none of the ones continuing past the edge, which is a hole a
    // later course would read as fact.
    const complete = tilesFullyInside(bounds);
    const rows = keys
      .filter((key) => complete.has(key))
      .map((key) => ({
        tile_key: key,
        segments: byTile.get(key) ?? [],
        fetched_at: new Date().toISOString(),
      }));
    if (rows.length > 0) {
      const { error } = await supabase.from("trail_tiles").upsert(rows, { onConflict: "tile_key" });
      if (error) console.error("[route-actions] trail tile write failed", error.message);
    }
    return mergeTileSegments([[...fetched], officialSegments]);
  } catch {
    console.error("[route-actions] Overpass unavailable; drawing from what we hold");
    return mergeTileSegments([...cached.values(), officialSegments]);
  }
}

/**
 * The club's own points for a set of waypoint names.
 *
 * Consulted before any search: route answers name places the way climbers do,
 * and those names are local usage rather than map labels. Looking 해골바위 up
 * by name put it on the far side of 북한산; a row here is the club saying
 * where it actually is, and it keeps saying so.
 */
export async function loadClubPois(): Promise<ClubPoi[]> {
  const { supabase } = await requireApprovedMember();
  const { data } = await supabase.from("route_pois").select("name, aliases, lat, lng");
  return ((data ?? []) as unknown as ClubPoi[]).map((row) => ({
    name: row.name,
    aliases: row.aliases ?? [],
    lat: row.lat,
    lng: row.lng,
  }));
}

/**
 * Records where a named place actually is.
 *
 * Any approved member, not just an admin: the person who walked the route is
 * the one who knows, and making them file a request is how the table stays
 * empty. Saving the same name again moves the existing point rather than
 * creating a rival row, so a name never becomes ambiguous.
 */
export async function saveClubPoi(input: {
  name: string;
  lat: number;
  lng: number;
  aliases?: string[];
  kind?: string | null;
  note?: string | null;
}): Promise<void> {
  const { supabase, memberId } = await requireApprovedMember();

  const name = input.name.trim();
  if (!name) throw new Error("이름을 입력해주세요.");
  if (!isValidGps(input.lat, input.lng)) throw new Error("지도에서 위치를 지정해주세요.");

  const existing = await supabase
    .from("route_pois")
    .select("id")
    .ilike("name", name)
    .maybeSingle();

  const row = {
    name,
    aliases: (input.aliases ?? []).map((a) => a.trim()).filter(Boolean),
    lat: input.lat,
    lng: input.lng,
    kind: input.kind ?? null,
    note: input.note ?? null,
    updated_at: new Date().toISOString(),
  };

  const id = (existing.data as { id: string } | null)?.id;
  const { error } = id
    ? await supabase.from("route_pois").update(row).eq("id", id)
    : await supabase.from("route_pois").insert({ ...row, created_by: memberId });
  if (error) throw error;

  revalidatePath("/map");
}
