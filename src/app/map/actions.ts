"use server";

import { revalidatePath } from "next/cache";
import { refused, refusedByDatabase, type ActionResult } from "@/lib/actions/result";
import { requireApprovedMember } from "@/lib/supabase/require-role";
import { sanitizeTrack } from "@/lib/gps/track";
import { isValidGps } from "@/lib/gps/validate";
import type { ActivityType, LocationType } from "@/types/database";
import { ACTIVITY_HAS_OWN_SPOT, ACTIVITY_TYPES } from "@/app/map/activity";
import { asCourseInfo } from "@/app/map/course-info";

// The GPX file itself is parsed in the browser (Workers have no XML parser),
// so what arrives here is already just coordinates - validate them anyway.
export async function saveHikeTrack(hikeId: string, points: unknown) {
  const { supabase } = await requireApprovedMember();

  const track = sanitizeTrack(points);
  if (!track) throw new Error("유효한 좌표가 없는 GPX 파일입니다.");

  // hikes_update RLS still applies: only the hike's creator or an admin.
  const { error } = await supabase.from("hikes").update({ track }).eq("id", hikeId);
  if (error) throw error;

  revalidatePath("/map");
  return { pointCount: track.length };
}

export async function clearHikeTrack(hikeId: string) {
  const { supabase } = await requireApprovedMember();
  const { error } = await supabase.from("hikes").update({ track: null }).eq("id", hikeId);
  if (error) throw error;
  revalidatePath("/map");
}

export async function createLocation(input: {
  name: string;
  type: LocationType;
  region: string | null;
  elevation: number | null;
  lat: number;
  lng: number;
}) {
  const { supabase, memberId } = await requireApprovedMember();

  const name = input.name.trim();
  if (!name) throw new Error("장소 이름을 입력해주세요.");
  if (!isValidGps(input.lat, input.lng)) throw new Error("지도에서 위치를 지정해주세요.");

  const { data, error } = await supabase
    .from("locations")
    .insert({
      name,
      type: input.type,
      region: input.region?.trim() || null,
      elevation: input.elevation,
      lat: input.lat,
      lng: input.lng,
      created_by: memberId,
    })
    .select("id")
    .single();
  if (error) throw error;

  revalidatePath("/map");
  return { locationId: (data as { id: string }).id };
}

export async function createHike(input: {
  locationId: string;
  title: string;
  date: string;
  activityType: ActivityType;
  description: string | null;
  lat: number | null;
  lng: number | null;
}) {
  const { supabase, memberId } = await requireApprovedMember();

  const title = input.title.trim();
  if (!title) throw new Error("활동 이름을 입력해주세요.");
  if (!input.date) throw new Error("날짜를 선택해주세요.");

  const hasSpot = input.lat != null && isValidGps(input.lat, input.lng);
  // A hike or a climb sits somewhere specific inside its folder - 대청봉 and
  // 울산바위 are both 설악산 - so without a point the map can say no more than
  // "somewhere on this mountain". A gym or wall session happens at the venue
  // itself, so it is exempt.
  if (ACTIVITY_HAS_OWN_SPOT[input.activityType] && !hasSpot) {
    throw new Error("산행·등반은 봉우리나 코스 위치를 검색해 지정해주세요.");
  }

  const { data, error } = await supabase
    .from("hikes")
    .insert({
      location_id: input.locationId,
      title,
      date: input.date,
      activity_type: input.activityType,
      description: input.description?.trim() || null,
      lat: hasSpot ? input.lat : null,
      lng: hasSpot ? input.lng : null,
      created_by: memberId,
    })
    .select("id")
    .single();
  if (error) throw error;

  revalidatePath("/map");
  return { hikeId: (data as { id: string }).id };
}

// Any approved member may rename an album, not just its creator: names often
// come straight from a Google Places search and arrive wrong.
export async function renameLocation(locationId: string, name: string) {
  const { supabase } = await requireApprovedMember();

  const trimmed = name.trim();
  if (!trimmed) throw new Error("장소 이름을 입력해주세요.");

  const { error } = await supabase
    .from("locations")
    .update({ name: trimmed })
    .eq("id", locationId);
  if (error) throw error;

  revalidatePath("/map");
}

/**
 * Corrects an activity's name, its date and what kind of outing it was.
 *
 * The kind is editable because it is guessed. An album made from a suggested
 * course is filed by reading the words in it - 어프로치 and 암벽 mean rock,
 * everything else means walking - and a guess from words is wrong sometimes.
 * The member who was there knows, and the row policy already lets any approved
 * member correct a name that Places got wrong; this is the same kind of repair.
 */
/** As long as a course description is allowed to be. Long enough for the
    walk, the water, the reservation and what to watch for; short enough that
    the box stays a box. */
const MAX_NOTES = 4000;

export async function updateActivity(input: {
  hikeId: string;
  title: string;
  date: string;
  activityType?: ActivityType;
  /** The course notes. Empty clears them; undefined leaves them alone. */
  description?: string;
}): Promise<ActionResult> {
  const { supabase } = await requireApprovedMember();

  const title = input.title.trim();
  if (!title) return refused("활동 이름을 입력해주세요.");
  if (!input.date) return refused("날짜를 선택해주세요.");
  if (input.activityType !== undefined && !ACTIVITY_TYPES.includes(input.activityType)) {
    return refused("활동 종류를 확인해주세요.");
  }
  const description = input.description?.trim();
  if (description !== undefined && description.length > MAX_NOTES) {
    return refused(`코스 정보는 ${MAX_NOTES.toLocaleString()}자 이내로 적어주세요.`);
  }

  const { error } = await supabase
    .from("hikes")
    .update({
      title,
      date: input.date,
      ...(input.activityType ? { activity_type: input.activityType } : {}),
      // Cleared rather than blanked: an empty box means there is nothing to
      // say, and the column already has a word for that.
      ...(description !== undefined ? { description: description || null } : {}),
    })
    .eq("id", input.hikeId);
  if (error) return refusedByDatabase("활동 수정", error);

  revalidatePath("/map");
  return { ok: true };
}

/** A short field on the course card - "약 6.6km", "4시간", "중급". */
const MAX_FIELD = 60;
/** Enough for a waypoint name and no more; the long text goes in notes. */
const MAX_WAYPOINT_NAME = 60;

/**
 * The course box: the points it passes, the numbers beside them, the caveats,
 * and the member's own memo.
 *
 * Separate from updateActivity because the two 수정 buttons meant the same
 * thing. The header's button and the one inside the course box both opened the
 * title/date/activity form - which does not hold a single field the course box
 * shows - and that form opens at the top of the panel, so pressing the lower
 * button scrolled nothing into view and read as a dead button.
 *
 * Waypoint coordinates are never taken from here. A name is edited in place on
 * the point that already holds its position, so correcting 비둘기샘 - a name a
 * web answer invented - cannot move the line that is drawn through it. Dropping
 * a point is done by clearing its name.
 */
export async function updateCourseDetails(input: {
  hikeId: string;
  /** The member's own memo. Empty clears it. */
  description: string;
  waypointNames: string[];
  distanceText: string;
  durationText: string;
  difficulty: string;
  notes: string;
}): Promise<ActionResult> {
  const { supabase } = await requireApprovedMember();

  const description = input.description.trim();
  if (description.length > MAX_NOTES) {
    return refused(`메모는 ${MAX_NOTES.toLocaleString()}자 이내로 적어주세요.`);
  }
  const notes = input.notes.trim();
  if (notes.length > MAX_NOTES) {
    return refused(`주의할 점은 ${MAX_NOTES.toLocaleString()}자 이내로 적어주세요.`);
  }
  for (const [label, value] of [
    ["거리", input.distanceText], ["소요 시간", input.durationText], ["난이도", input.difficulty],
  ] as const) {
    if (value.trim().length > MAX_FIELD) return refused(`${label}는 ${MAX_FIELD}자 이내로 적어주세요.`);
  }
  if (input.waypointNames.some((name) => name.trim().length > MAX_WAYPOINT_NAME)) {
    return refused(`경유지 이름은 ${MAX_WAYPOINT_NAME}자 이내로 적어주세요.`);
  }

  // Read the points back rather than trusting what the browser sent: the
  // coordinates are the part that must not change, and the only thing this
  // edit is allowed to say about them is which name sits on each.
  const { data, error: readError } = await supabase
    .from("hikes").select("route_waypoints, course_info").eq("id", input.hikeId).maybeSingle();
  if (readError) return refusedByDatabase("코스 정보 읽기", readError);
  const row = data as {
    route_waypoints: { name: string; lat: number; lng: number }[] | null;
    course_info: unknown;
  } | null;
  const held = row?.route_waypoints ?? [];
  if (input.waypointNames.length !== held.length) {
    return refused("코스가 그 사이에 바뀌었습니다. 새로고침 후 다시 시도해주세요.");
  }
  const waypoints = held
    .map((point, i) => ({ ...point, name: input.waypointNames[i].trim() }))
    .filter((point) => point.name);

  // The source links an answer cited are not on this form, so they are carried
  // over rather than dropped - editing a distance should not throw away where
  // the course came from.
  const sources = asCourseInfo(row?.course_info)?.sources ?? [];

  const text = (value: string) => (value.trim() ? value.trim() : null);
  const courseInfo = {
    distanceText: text(input.distanceText),
    durationText: text(input.durationText),
    difficulty: text(input.difficulty),
    notes: text(notes),
    ...(sources.length > 0 ? { sources } : {}),
  };
  const empty = !courseInfo.distanceText && !courseInfo.durationText
    && !courseInfo.difficulty && !courseInfo.notes && sources.length === 0;

  const { error } = await supabase
    .from("hikes")
    .update({
      description: description || null,
      route_waypoints: waypoints.length > 0 ? waypoints : null,
      // An all-blank card is cleared, not stored as four nulls - the album then
      // shows the "코스 정보 적기" prompt again rather than an empty box.
      course_info: empty ? null : courseInfo,
    })
    .eq("id", input.hikeId);
  if (error) return refusedByDatabase("코스 정보 수정", error);

  revalidatePath("/map");
  return { ok: true };
}
