"use server";

import { revalidatePath } from "next/cache";
import { requireApprovedMember } from "@/lib/supabase/require-role";
import { sanitizeTrack } from "@/lib/gps/track";
import { isValidGps } from "@/lib/gps/validate";
import type { ActivityType, LocationType } from "@/types/database";
import { ACTIVITY_HAS_OWN_SPOT } from "@/app/map/activity";

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

export async function renameActivity(hikeId: string, title: string) {
  const { supabase } = await requireApprovedMember();

  const trimmed = title.trim();
  if (!trimmed) throw new Error("활동 이름을 입력해주세요.");

  const { error } = await supabase.from("hikes").update({ title: trimmed }).eq("id", hikeId);
  if (error) throw error;

  revalidatePath("/map");
}
