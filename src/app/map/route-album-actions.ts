"use server";

import { revalidatePath } from "next/cache";
import { requireApprovedMember } from "@/lib/supabase/require-role";
import { isValidGps } from "@/lib/gps/validate";

export interface RouteWaypoint {
  name: string;
  lat: number;
  lng: number;
}

/**
 * Turns a course the assistant suggested into an album ready to hold photos.
 *
 * The place comes first: a suggested course names a mountain the club may or
 * may not already have a folder for, so an existing folder is reused by name
 * before a new one is created - otherwise asking about 관악산 twice would
 * leave two 관악산 pins on the map.
 *
 * The geocoded waypoints are deliberately NOT written to hikes.track. They are
 * place names resolved one by one and joined with straight lines, which would
 * draw a route nobody walked; that column stays for a real GPX file or a
 * member's own tap-picked trail. The course is recorded as text in the
 * description instead, where it reads as the plan it is.
 */
export async function createAlbumFromRoute(input: {
  routeName: string;
  placeName: string;
  waypoints: RouteWaypoint[];
  distanceText: string | null;
  notes: string | null;
}) {
  const { supabase, memberId } = await requireApprovedMember();

  const routeName = input.routeName.trim();
  const placeName = input.placeName.trim();
  if (!routeName) throw new Error("코스 이름이 없습니다.");
  if (!placeName) throw new Error("장소 이름이 없습니다.");

  const points = input.waypoints.filter((p) => isValidGps(p.lat, p.lng));
  if (points.length === 0) {
    throw new Error("코스 위치를 지도에서 찾지 못해 앨범을 만들 수 없습니다.");
  }

  const { data: existing, error: lookupError } = await supabase
    .from("locations")
    .select("id")
    .eq("name", placeName)
    .limit(1)
    .maybeSingle();
  if (lookupError) throw lookupError;

  let locationId = (existing as { id: string } | null)?.id ?? null;

  if (!locationId) {
    // The first waypoint is the trailhead, which is where someone setting out
    // actually goes - a better pin for a folder than the midpoint of a line.
    const { data: created, error: createError } = await supabase
      .from("locations")
      .insert({
        name: placeName,
        type: "mountain",
        region: null,
        elevation: null,
        lat: points[0].lat,
        lng: points[0].lng,
        created_by: memberId,
      })
      .select("id")
      .single();
    if (createError) throw createError;
    locationId = (created as { id: string }).id;
  }

  // The summit end of the course is the activity's own spot, matching how a
  // hike created by hand is placed on its peak rather than at its trailhead.
  const spot = points[points.length - 1];

  const description = [
    `AI 추천 코스: ${points.map((p) => p.name).join(" → ")}`,
    input.distanceText,
    input.notes,
  ]
    .filter(Boolean)
    .join("\n");

  const { data: hike, error: hikeError } = await supabase
    .from("hikes")
    .insert({
      location_id: locationId,
      title: routeName,
      date: new Date().toISOString().slice(0, 10),
      activity_type: "hiking",
      description,
      lat: spot.lat,
      lng: spot.lng,
      created_by: memberId,
    })
    .select("id")
    .single();
  if (hikeError) throw hikeError;

  revalidatePath("/map");
  return { locationId, hikeId: (hike as { id: string }).id };
}
