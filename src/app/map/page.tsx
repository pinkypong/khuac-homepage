import { createClient } from "@/lib/supabase/server";
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
      uploader: { name: string } | null;
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
  const { data, error } = await supabase
    .from("locations")
    .select(
      "id, name, type, region, elevation, lat, lng, " +
        "hikes(id, title, date, description, activity_type, lat, lng, track, " +
        "photos(id, storage_key_original, taken_at, exif_lat, exif_lng, uploader:members!uploader_id(name)))",
    )
    .not("lat", "is", null)
    .not("lng", "is", null)
    .order("name");
  if (error) throw error;

  const locations: MapLocation[] = (data as unknown as LocationRow[]).map((row) => {
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
            uploaderName: p.uploader?.name ?? "알 수 없음",
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
      hikes,
      photoCount: hikes.reduce((sum, h) => sum + h.photos.length, 0),
    };
  });

  return (
    <MapShell
      locations={locations}
      viewerName={viewer?.name ?? ""}
      isAdmin={viewer?.role === "admin"}
    />
  );
}
