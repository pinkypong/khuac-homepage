import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { trackDistanceMeters, formatDistance, type TrackPoint } from "@/lib/gps/track";
import { ACTIVITY_LABEL } from "@/app/map/activity";
import type { ActivityType } from "@/types/database";

type Supabase = Awaited<ReturnType<typeof createClient>>;

interface HikeRow {
  id: string;
  title: string;
  date: string;
  activity_type: ActivityType;
  track: TrackPoint[] | null;
}

/**
 * What the club itself knows about a place, as a short block of Korean text
 * ready to hand to the model as context.
 *
 * This is deliberately not a database dump. The model needs "다녀온 적 있고,
 * 최근에는 언제, 어떤 활동으로" - a sentence a member would say - not a row
 * count.
 */
export async function buildClubHistoryContext(
  supabase: Supabase,
  locationId: string,
  locationName: string,
): Promise<string> {
  const { data, error } = await supabase
    .from("hikes")
    .select("id, title, date, activity_type, track")
    .eq("location_id", locationId)
    .order("date", { ascending: false });

  if (error || !data || data.length === 0) {
    return `${locationName}: 동아리 기록이 없는 곳입니다.`;
  }

  const hikes = data as unknown as HikeRow[];
  const latest = hikes[0];

  const byType = new Map<ActivityType, number>();
  for (const hike of hikes) {
    byType.set(hike.activity_type, (byType.get(hike.activity_type) ?? 0) + 1);
  }
  const typeSummary = [...byType.entries()]
    .map(([type, count]) => `${ACTIVITY_LABEL[type]} ${count}건`)
    .join(", ");

  const withTrack = hikes.find((h) => h.track && h.track.length >= 2);
  const distanceLine = withTrack?.track
    ? `등록된 경로 거리: 약 ${formatDistance(trackDistanceMeters(withTrack.track))}`
    : "등록된 경로 없음";

  const photoCount = await countPhotos(
    supabase,
    hikes.map((h) => h.id),
  );

  return [
    `${locationName}: 동아리 활동 기록 ${hikes.length}건 (${typeSummary})`,
    `가장 최근 활동: ${latest.date} "${latest.title}"`,
    distanceLine,
    `등록된 사진 ${photoCount}장`,
  ].join("\n");
}

async function countPhotos(supabase: Supabase, hikeIds: string[]): Promise<number> {
  if (hikeIds.length === 0) return 0;
  const { count } = await supabase
    .from("photos")
    .select("id", { count: "exact", head: true })
    .in("hike_id", hikeIds);
  return count ?? 0;
}
