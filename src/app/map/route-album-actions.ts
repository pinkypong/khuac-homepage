"use server";

import { revalidatePath } from "next/cache";
import { requireApprovedMember } from "@/lib/supabase/require-role";
import { isValidGps } from "@/lib/gps/validate";
import { refused, refusedByDatabase, type ActionResult } from "@/lib/actions/result";
import { ACTIVITY_TYPES, activityForCourse } from "./activity";
import { sanitizeTrack, unflattenTrack } from "@/lib/gps/track";
import { groupByMountain, pickMountainGroup } from "@/lib/assistant/region";
import { rankOf } from "@/lib/assistant/origin";
import { rememberCourses } from "@/lib/assistant/library";
import { extractRoutes, searchRoutes } from "@/lib/assistant/routes";
import type { ActivityType, ClimbingStyle, LocationType } from "@/types/database";

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
  /** The course_library row this album is a walk of, when the answer knew it.
      Null is ordinary - a course the model renamed while merging two of ours
      matches nothing, and an unlinked album is better than a wrongly linked
      one. */
  courseId?: string | null;
  distanceText: string | null;
  durationText?: string | null;
  difficulty?: string | null;
  notes: string | null;
  sources?: { url: string; label: string }[];
  /** What was asked to get this course, when it is still to hand. The course's
      own name usually says whether it is a climb, and sometimes only the
      question does - "북한산 인수봉 어프로치" names a mountain and a rock face
      and the course that comes back may mention neither. */
  question?: string | null;
  /** Set when a member started from a folder's own 새 앨범 만들기 rather than
      from an answer: they are already inside the place, and they have already
      said what they did and when. Guessing any of those back from the course's
      name - or filing today's date for last Saturday's climb - would undo what
      they just chose. */
  locationId?: string | null;
  activityType?: ActivityType | null;
  /** Ignored unless activityType is climbing, same as createHike - the
      database enforces it either way. */
  climbingStyle?: ClimbingStyle | null;
  date?: string | null;
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

  let locationId = input.locationId ?? null;
  if (!locationId) {
    const { data: existing, error: lookupError } = await supabase
      .from("locations")
      .select("id")
      .eq("name", placeName)
      .limit(1)
      .maybeSingle();
    if (lookupError) return refusedByDatabase("장소 조회", lookupError);
    locationId = (existing as { id: string } | null)?.id ?? null;
  }

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

  // No description is written. It used to hold the waypoints as a sentence,
  // which route_waypoints already holds properly, and the distance as prose -
  // leaving nothing readable and no room for what a member wants to say. The
  // course's own facts go in course_info; description stays theirs.
  const courseInfo = {
    distanceText: input.distanceText,
    durationText: input.durationText ?? null,
    difficulty: input.difficulty ?? null,
    notes: input.notes,
    sources: input.sources ?? [],
  };

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
  const activityType =
    input.activityType && ACTIVITY_TYPES.includes(input.activityType)
      ? input.activityType
      : activityForCourse(
          input.question, routeName, placeName, input.notes, points.map((point) => point.name).join(" "));
  const date = input.date && /^\d{4}-\d{2}-\d{2}$/.test(input.date)
    ? input.date
    : new Date().toISOString().slice(0, 10);

  const { data: hike, error: hikeError } = await supabase
    .from("hikes")
    .insert({
      location_id: locationId,
      title: routeName,
      date,
      activity_type: activityType,
      climbing_style: activityType === "climbing" ? (input.climbingStyle ?? null) : null,
      course_info: courseInfo,
      // Deliberately not validated against the library here. It is a foreign
      // key: an id that names no course is refused by the database, which is
      // the check, and paying a round trip to repeat it would slow every album.
      course_id: input.courseId ?? null,
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

/** A course we already hold for a place, offered so a member picks instead of
    tracing. */
export interface KnownCourse {
  id: string;
  name: string;
  waypoints: string[];
  distanceText: string | null;
  durationText: string | null;
  difficulty: string | null;
  origin: string | null;
}

interface LibraryRow {
  id: string;
  mountain: string;
  name: string;
  region: string | null;
  origin: string | null;
  waypoints: string[] | null;
  distance_text: string | null;
  duration_text: string | null;
  difficulty: string | null;
}

/**
 * The courses already on file for a place.
 *
 * Drawing a route by tapping trail segments asks a member to trace ground the
 * library often already describes: 북한산 holds thirteen courses, four of them
 * approaches ending at 인수봉 고독길 들머리, and three of those share the same
 * spine - 하루재, 인수암, the 들머리 - differing only in where they set off
 * from. Picking one from a list of four is a truer fit for that than drawing
 * it again by hand.
 *
 * Costs nothing but this read. Resolving the names to points and pulling them
 * onto real trails is the browser's existing course preview, which is the same
 * work it already does for an answer's courses - and no model is asked
 * anything, so this is cheaper than the route that produced these rows.
 */
export async function coursesForLocation(
  mountain: string,
  region: string | null,
): Promise<KnownCourse[]> {
  const { supabase } = await requireApprovedMember();
  const name = mountain.trim();
  if (name.length < 2) return [];

  const { data } = await supabase
    .from("course_library")
    .select("id, mountain, name, region, origin, waypoints, distance_text, duration_text, difficulty");
  const all = (data ?? []) as unknown as LibraryRow[];
  if (all.length === 0) return [];

  // Courses filed under this very mountain.
  //
  // Thirty-three names in the library belong to more than one mountain, so
  // these are gathered into actual mountains first and the folder's own region
  // picks between them. Nothing at all beats offering 계룡산 in 거제 to
  // somebody filing a walk up the one near 공주.
  const sameName = all.filter((row) => row.mountain === name);
  let direct: LibraryRow[] = [];
  if (sameName.length > 0) {
    const picked = pickMountainGroup(groupByMountain(sameName), region);
    direct = picked ? picked.rows : [];
  }

  // Courses that lead here without being filed here.
  //
  // 인수봉 is a face on 북한산, so a folder for it holds climbs while every way
  // in is filed under the mountain - four of them, each ending at 인수봉 고독길
  // 들머리. Matching only on the folder's own name found none of them, which is
  // the whole approach a climbing album actually wants drawn.
  //
  // Only for a place the library does not itself keep as a mountain. 지리산 is
  // a mountain here and also a waypoint on a course over on 사량도, 200km away:
  // reading the mention as "this course leads to your 지리산" offered that one
  // when the region - "경남/전남", provinces with no 시·군 in them - was too
  // coarse to tell the two apart. Where the name is a mountain of its own, the
  // grouping above is the only honest answer, empty included.
  const isKnownMountain = all.some((row) => row.mountain === name);
  const mentions = (row: LibraryRow) =>
    row.name.includes(name) || (row.waypoints ?? []).some((point) => point.includes(name));
  const seen = new Set(direct.map((row) => row.id));
  const leadingHere = isKnownMountain ? [] : all.filter((row) => !seen.has(row.id) && mentions(row));

  return [...direct, ...leadingHere]
    .sort((a, b) => rankOf(b.origin) - rankOf(a.origin) || a.name.localeCompare(b.name))
    .map((row) => ({
      id: row.id,
      name: row.name,
      waypoints: row.waypoints ?? [],
      distanceText: row.distance_text,
      durationText: row.duration_text,
      difficulty: row.difficulty,
      origin: row.origin,
    }));
}

/**
 * Puts a course's drawn line onto an album that already exists.
 *
 * createAlbumFromRoute makes a new album out of a course; this is the same
 * ending for an album a member made themselves - the climbing day filed by
 * hand that still wants its approach drawn. The line, the named points and
 * which course it came from are written together, because an album showing a
 * route with no record of which course it is cannot be found again from that
 * course's side.
 */
export async function attachCourseToHike(input: {
  hikeId: string;
  courseId: string | null;
  waypoints: RouteWaypoint[];
  /** Flattened [lat, lng, lat, lng, ...] - see flattenTrack for why. */
  track: number[] | null;
}): Promise<ActionResult<{ pointCount: number }>> {
  const { supabase } = await requireApprovedMember();

  const track = sanitizeTrack(unflattenTrack(input.track));
  if (!track) {
    return refused("지도에 그릴 경로를 만들지 못했습니다. 잠시 후 다시 시도해주세요.");
  }
  const points = input.waypoints.filter((point) => isValidGps(point.lat, point.lng));

  const { error } = await supabase
    .from("hikes")
    .update({
      track,
      // Snapped from the course's waypoints, so editing them may redraw it -
      // unlike a member's own GPX, which is the only copy of what they walked.
      track_source: "course",
      route_waypoints: points.map((point) => ({ name: point.name, lat: point.lat, lng: point.lng })),
      course_id: input.courseId,
    })
    .eq("id", input.hikeId);
  if (error) return refusedByDatabase("경로 저장", error);

  revalidatePath("/map");
  return { ok: true, value: { pointCount: track.length } };
}

/** Places whose courses are climbs, so the search asks about rock rather than
    trails. 외벽 is an artificial wall and 실내클라이밍짐 is indoors - neither
    has an approach worth searching for - so only real rock is listed. */
const CLIMBS: LocationType[] = ["multi_pitch", "hard_free"];

/**
 * Asks KHUAC AI for this place's courses, files them, and hands back the list.
 *
 * Only when a member presses for it. A grounded search takes about 27 seconds
 * and is billed per call, so running one every time somebody opens an album's
 * route section - most of which never need a line drawn - would spend both on
 * nothing. Pressed once, though, the answer is filed in course_library under
 * origin "search" and every album at this place can pick from it afterwards
 * without searching again.
 *
 * rememberCourses is the assistant's own filing function rather than a second
 * copy: it is what refuses to let a web answer overwrite a surveyed or walked
 * row, and that guard existing twice is how it would eventually stop matching.
 */
export async function searchCoursesForLocation(
  mountain: string,
  region: string | null,
  locationType: LocationType,
  /** What the member picked in the form. A mountain now holds its climbs as
      well as its walks - 삼성산's 숨은암장 is filed under 삼성산 - so the
      folder's own type can no longer say which to search for; asking
      "삼성산 등산 코스" for somebody recording a climb would only ever file
      walks. */
  activityType?: ActivityType,
): Promise<ActionResult<KnownCourse[]>> {
  const { supabase } = await requireApprovedMember();
  const name = mountain.trim();
  if (name.length < 2) return refused("장소 이름이 없습니다.");

  const climbing = activityType === "climbing" || CLIMBS.includes(locationType);
  const question = climbing
    ? `${name} 암벽등반 어프로치와 등반 루트`
    : `${name} 등산 코스`;
  try {
    const found = await searchRoutes(name, question, null, climbing);
    const result = await extractRoutes(found.text, found.sources, name);
    if (result.routes.length === 0) {
      return refused("이 장소의 코스를 찾지 못했습니다. KHUAC AI에 직접 물어봐주세요.");
    }
    await rememberCourses(supabase, name, result.routes, region);
  } catch {
    return refused("코스를 찾는 데 실패했습니다. 잠시 후 다시 시도해주세요.");
  }
  return { ok: true, value: await coursesForLocation(name, region) };
}
