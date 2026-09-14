"use server";

import { revalidatePath } from "next/cache";
import { requireApprovedMember } from "@/lib/supabase/require-role";
import { sanitizeTrack } from "@/lib/gps/track";
import { fetchTrailsInBounds, fetchTrailsNear } from "@/lib/routes/overpass";
import { stitchSegments, type TrailSegment } from "@/lib/routes/trails";
import { snapRouteToTrails, type RouteLeg } from "@/lib/routes/snap";

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
export async function snapSuggestedRoute(
  waypoints: { lat: number; lng: number }[],
): Promise<RouteLeg[]> {
  await requireApprovedMember();
  if (waypoints.length < 2) return [];

  // A box around the whole course rather than a circle around its middle. The
  // circle was capped at a 3km radius, so a 6km course from 밤골 to 도선사 had
  // the middle of the mountain outside the query and came back entirely dashed
  // for want of data rather than for want of a path.
  const lats = waypoints.map((w) => w.lat);
  const lngs = waypoints.map((w) => w.lng);
  // Roughly 900m of margin, so a trailhead just outside the course still has
  // the path leading onto it.
  const margin = 0.008;

  try {
    const segments = await fetchTrailsInBounds({
      south: Math.min(...lats) - margin,
      west: Math.min(...lngs) - margin,
      north: Math.max(...lats) + margin,
      east: Math.max(...lngs) + margin,
    });
    return snapRouteToTrails(waypoints, segments);
  } catch {
    // Overpass is volunteer-run and does go down. A straight dashed line is
    // the honest fallback; failing the whole answer over it is not.
    console.error("[route-actions] trail snapping unavailable; falling back to straight legs");
    return waypoints.slice(1).map((point, i) => ({
      points: [[waypoints[i].lat, waypoints[i].lng], [point.lat, point.lng]],
      onTrail: false,
    }));
  }
}
