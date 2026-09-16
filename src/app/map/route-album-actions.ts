"use server";

import { revalidatePath } from "next/cache";
import { requireApprovedMember } from "@/lib/supabase/require-role";
import { isValidGps } from "@/lib/gps/validate";
import { refused, refusedByDatabase, type ActionResult } from "@/lib/actions/result";
import { activityForCourse } from "./activity";
import { sanitizeTrack, unflattenTrack } from "@/lib/gps/track";

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
 * The drawn line is saved to hikes.track, but the geocoded waypoints are not.
 * The distinction is the whole point: waypoints are place names joined by
 * straight lines, which would draw a route nobody walked, while `track` is the
 * geometry the router pulled onto mapped trails and is the same kind of thing
 * a GPX file holds. Without it an album made from a course opened as a bare
 * pin with no way to see the course it was made from.
 *
 * A course whose legs could not all be mapped saves no track at all rather
 * than a partial one: half a route in the column the map draws as "the route"
 * would read as the whole of it.
 */
export async function createAlbumFromRoute(input: {
  routeName: string;
  placeName: string;
  waypoints: RouteWaypoint[];
  /** The snapped line as drawn, flattened to [lat, lng, lat, lng, ...].

      Flat because React's reply decoder refuses a nested array that repeats -
      and our lines repeat by construction, since two legs meeting at a junction
      share that junction's point object. See flattenTrack. */
  track: number[] | null;
  distanceText: string | null;
  notes: string | null;
  /** What was asked to get this course, when it is still to hand. The course's
      own name usually says whether it is a climb, and sometimes only the
      question does - "북한산 인수봉 어프로치" names a mountain and a rock face
      and the course that comes back may mention neither. */
  question?: string | null;
}): Promise<ActionResult<{ locationId: string; hikeId: string }>> {
  const { supabase, memberId } = await requireApprovedMember();

  const routeName = input.routeName.trim();
  const placeName = input.placeName.trim();
  if (!routeName) return refused("코스 이름이 없습니다.");
  if (!placeName) return refused("장소 이름이 없습니다.");

  const points = input.waypoints.filter((p) => isValidGps(p.lat, p.lng));
  if (points.length === 0) {
    return refused("코스 위치를 지도에서 찾지 못해 앨범을 만들 수 없습니다.");
  }

  const { data: existing, error: lookupError } = await supabase
    .from("locations")
    .select("id")
    .eq("name", placeName)
    .limit(1)
    .maybeSingle();
  if (lookupError) return refusedByDatabase("장소 조회", lookupError);

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
    if (createError) return refusedByDatabase("장소 등록", createError);
    locationId = (created as { id: string }).id;
  }

  // The start, which is the one point on a course a member can act on: it is
  // where they get off the bus. The last waypoint was used before, on the
  // reasoning that a hike belongs on its peak - but a course does not end on
  // its peak, it ends at whichever gate it came down to, so the 숨은벽 course
  // was pinned on 도선사 three kilometres from the 밤골 it starts at.
  //
  // The line matters more than the pin now that the course is saved with one:
  // the map frames the whole route, and the pin only says where it begins.
  const spot = points[0];

  const description = [
    `AI 추천 코스: ${points.map((p) => p.name).join(" → ")}`,
    input.distanceText,
    input.notes,
  ]
    .filter(Boolean)
    .join("\n");

  // A line that arrived and could not be read is a bug, and saving the album
  // without it hides that: the album opens as a pin and looks like a course
  // that simply had no route. Nothing to refuse the member over - the album is
  // still worth having - but it is worth saying out loud.
  const track = sanitizeTrack(unflattenTrack(input.track));
  if (input.track && !track) {
    console.error("[route-album] 보내온 선을 읽지 못했습니다", input.track.length);
  }

  // Filed by what it is rather than always as a walk. Read from everything
  // said about the course, because the word that settles it turns up in a
  // different place each time: in the question, in the course's name, or only
  // down in its notes.
  const activityType = activityForCourse(
    input.question, routeName, placeName, input.notes, points.map((p) => p.name).join(" "));

  const { data: hike, error: hikeError } = await supabase
    .from("hikes")
    .insert({
      location_id: locationId,
      title: routeName,
      date: new Date().toISOString().slice(0, 10),
      activity_type: activityType,
      description,
      lat: spot.lat,
      lng: spot.lng,
      track,
      // The named points, with coordinates, so the map can put each label
      // where it belongs instead of listing them all on the opening pin.
      route_waypoints: points.map((p) => ({ name: p.name, lat: p.lat, lng: p.lng })),
      created_by: memberId,
    })
    .select("id")
    .single();
  if (hikeError) return refusedByDatabase("앨범 등록", hikeError);

  revalidatePath("/map");
  return { ok: true, value: { locationId, hikeId: (hike as { id: string }).id } };
}
