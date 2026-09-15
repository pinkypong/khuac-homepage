"use server";

import { revalidatePath } from "next/cache";
import { requireApprovedMember } from "@/lib/supabase/require-role";
import { isValidGps } from "@/lib/gps/validate";
import { sanitizeTrack } from "@/lib/gps/track";
import type { TrackPoint } from "@/lib/gps/track";

export interface RouteWaypoint {
  name: string;
  lat: number;
  lng: number;
}

/** Made, or the reason it was not. */
export type AlbumResult =
  | { ok: true; locationId: string; hikeId: string }
  | { ok: false; reason: string };

/**
 * A refusal, said in a way that survives the trip back.
 *
 * Two things were swallowing the reason. Supabase hands back a plain
 * `{ message, code, details, hint }` object rather than an Error, and thrown
 * out of a server action it serialised to nothing - a bare 500, with
 * `err instanceof Error` false on the other side, so even the fallback text
 * lost it. And a built Worker is a production build, where Next replaces any
 * message thrown from a server action with a generic one before it reaches the
 * browser; the reason would have been hidden even from a proper Error.
 *
 * So the failure is returned rather than thrown. It is an ordinary outcome of
 * pressing the button - the row policy may refuse, the mountain may already be
 * filed under a different spelling - and a member who cannot make an album
 * should be told which.
 *
 * Logged too, because the code is the part that identifies it - 42501 is the
 * row policy, 23502 a missing column, 23505 a duplicate - and the member does
 * not need to read it.
 */
function refuse(step: string, error: { message: string; code?: string; details?: string; hint?: string }): AlbumResult {
  console.error(`[route-album] ${step} 실패`, error.code, error.message, error.details, error.hint);
  return { ok: false, reason: `${step}에 실패했습니다: ${error.message}` };
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
  /** The snapped line, leg by leg, as drawn. Absent when any leg is unmapped. */
  track: TrackPoint[] | null;
  distanceText: string | null;
  notes: string | null;
}): Promise<AlbumResult> {
  const { supabase, memberId } = await requireApprovedMember();

  const routeName = input.routeName.trim();
  const placeName = input.placeName.trim();
  if (!routeName) return { ok: false, reason: "코스 이름이 없습니다." };
  if (!placeName) return { ok: false, reason: "장소 이름이 없습니다." };

  const points = input.waypoints.filter((p) => isValidGps(p.lat, p.lng));
  if (points.length === 0) {
    return { ok: false, reason: "코스 위치를 지도에서 찾지 못해 앨범을 만들 수 없습니다." };
  }

  const { data: existing, error: lookupError } = await supabase
    .from("locations")
    .select("id")
    .eq("name", placeName)
    .limit(1)
    .maybeSingle();
  if (lookupError) return refuse("장소 조회", lookupError);

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
    if (createError) return refuse("장소 등록", createError);
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
      track: sanitizeTrack(input.track),
      // The named points, with coordinates, so the map can put each label
      // where it belongs instead of listing them all on the opening pin.
      route_waypoints: points.map((p) => ({ name: p.name, lat: p.lat, lng: p.lng })),
      created_by: memberId,
    })
    .select("id")
    .single();
  if (hikeError) return refuse("앨범 등록", hikeError);

  revalidatePath("/map");
  return { ok: true, locationId, hikeId: (hike as { id: string }).id };
}
