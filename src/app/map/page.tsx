import { createClient } from "@/lib/supabase/server";
import { UNKNOWN_MEMBER_NAME, memberDirectory } from "@/lib/supabase/member-names";
import { photoPointsToTrack, type TrackPoint } from "@/lib/gps/track";
import type { ActivityType, LocationType } from "@/types/database";
import { MapShell, type MapLocation, type MapHike } from "./map-shell";

interface LocationRow {
  id: string;
  name: string;
  type: LocationType;
  region: string | null;
  elevation: number | null;
  lat: number;
  lng: number;
  created_at: string;
  hikes: {
    id: string;
    title: string;
    date: string;
    description: string | null;
    activity_type: ActivityType;
    lat: number | null;
    lng: number | null;
    track: TrackPoint[] | null;
    photos: {
      id: string;
      storage_key_original: string;
      taken_at: string | null;
      exif_lat: number | null;
      exif_lng: number | null;
      uploader_id: string | null;
    }[];
  }[];
}

export default async function MapPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: member } = user
    ? await supabase.from("members").select("name, role").eq("auth_user_id", user.id).single()
    : { data: null };
  const viewer = (member as { name: string; role: string } | null) ?? null;
  const isAdmin = viewer?.role === "admin";

  // Only admins can act on this, and members_select would hand a non-admin an
  // empty result anyway - so the round trip is skipped rather than wasted.
  const { count: pendingCount } = isAdmin
    ? await supabase
        .from("members")
        .select("id", { count: "exact", head: true })
        .eq("role", "pending")
    : { count: 0 };
  const { data, error } = await supabase
    .from("locations")
    .select(
      "id, name, type, region, elevation, lat, lng, created_at, " +
        "hikes(id, title, date, description, activity_type, lat, lng, track, " +
        "photos(id, storage_key_original, taken_at, exif_lat, exif_lng, uploader_id))",
    )
    .not("lat", "is", null)
    .not("lng", "is", null)
    .order("name");
  if (error) throw error;

  const rows = data as unknown as LocationRow[];
  // Names come from the member_names view, not a join: members itself stays
  // unreadable to anyone but its owner and admins because it holds email.
  const names = await memberDirectory(
    supabase,
    rows.flatMap((r) => (r.hikes ?? []).flatMap((h) => (h.photos ?? []).map((p) => p.uploader_id))),
  );

  const locations: MapLocation[] = rows.map((row) => {
    const hikes: MapHike[] = [...(row.hikes ?? [])]
      .sort((a, b) => b.date.localeCompare(a.date))
      .map((hike) => {
        const photos = [...(hike.photos ?? [])]
          .sort((a, b) => (a.taken_at ?? "").localeCompare(b.taken_at ?? ""))
          .map((p) => ({
            id: p.id,
            storageKey: p.storage_key_original,
            takenAt: p.taken_at,
            exifLat: p.exif_lat,
            exifLng: p.exif_lng,
            uploaderName:
              (p.uploader_id ? names.get(p.uploader_id)?.name : null) ?? UNKNOWN_MEMBER_NAME,
          }));

        // A gym has no walking route at all; elsewhere fall back to the
        // photos' own GPS trail when no GPX has been uploaded.
        const fallback = row.type === "climbing_gym" ? null : photoPointsToTrack(photos);

        return {
          id: hike.id,
          locationId: row.id,
          title: hike.title,
          date: hike.date,
          description: hike.description,
          activityType: hike.activity_type,
          lat: hike.lat,
          lng: hike.lng,
          track: hike.track ?? fallback,
          trackSource: hike.track ? "gpx" : fallback ? "photos" : null,
          photos,
        };
      });

    return {
      id: row.id,
      name: row.name,
      type: row.type,
      region: row.region,
      elevation: row.elevation,
      lat: row.lat,
      lng: row.lng,
      createdAt: row.created_at,
      hikes,
      photoCount: hikes.reduce((sum, h) => sum + h.photos.length, 0),
    };
  });

  return (
    <MapShell
      locations={locations}
      viewerName={viewer?.name ?? ""}
      isAdmin={isAdmin}
      pendingCount={pendingCount ?? 0}
    />
  );
}
