import { createClient } from "@/lib/supabase/server";
import { asCourseInfo } from "./course-info";
import { UNKNOWN_MEMBER_NAME, memberDirectory } from "@/lib/supabase/member-names";
import type { TrackPoint } from "@/lib/gps/track";
import type { ActivityType, ClimbingStyle, LocationType } from "@/types/database";
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
    climbing_style: ClimbingStyle | null;
    lat: number | null;
    lng: number | null;
    track: TrackPoint[] | null;
    route_waypoints: { name: string; lat: number; lng: number }[] | null;
    course_info: unknown;
    course_id: string | null;
    track_source: string | null;
    updated_at: string;
    photos: {
      id: string;
      storage_key_original: string;
      taken_at: string | null;
      created_at: string;
      exif_lat: number | null;
      exif_lng: number | null;
      uploader_id: string | null;
    }[];
  }[];
}

export default async function MapPage() {
  const supabase = await createClient();

  // getSession reads the cookie; getUser would spend a network round trip
  // validating it against the auth server. Nothing here is an authorisation
  // decision - the middleware already refused anyone who does not belong on
  // this route, and RLS decides what the id below is allowed to read.
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const userId = session?.user.id;

  // The album tree does not depend on who is looking at it, so waiting for the
  // viewer's row before asking for it just adds one round trip to every load.
  const [memberResult, locationsResult] = await Promise.all([
    userId
      ? supabase.from("members").select("name, role").eq("auth_user_id", userId).single()
      : Promise.resolve({ data: null }),
    supabase
      .from("locations")
      .select(
        "id, name, type, region, elevation, lat, lng, created_at, " +
          "hikes(id, title, date, description, activity_type, climbing_style, lat, lng, track, track_source, updated_at, route_waypoints, course_info, course_id, " +
          "photos(id, storage_key_original, taken_at, created_at, exif_lat, exif_lng, uploader_id))",
      )
      .not("lat", "is", null)
      .not("lng", "is", null)
      .order("name"),
  ]);

  const { data, error } = locationsResult;
  if (error) throw error;

  const viewer = (memberResult.data as { name: string; role: string } | null) ?? null;
  const isAdmin = viewer?.role === "admin";
  const rows = data as unknown as LocationRow[];

  // Both of these needed the results above, and neither needs the other.
  const [pendingResult, names] = await Promise.all([
    // Only admins can act on this, and members_select would hand a non-admin an
    // empty result anyway - so the round trip is skipped rather than wasted.
    isAdmin
      ? supabase.from("members").select("id", { count: "exact", head: true }).eq("role", "pending")
      : Promise.resolve({ count: 0 }),
    // Names come from the member_names view, not a join: members itself stays
    // unreadable to anyone but its owner and admins because it holds email.
    memberDirectory(
      supabase,
      rows.flatMap((r) =>
        (r.hikes ?? []).flatMap((h) => (h.photos ?? []).map((p) => p.uploader_id)),
      ),
    ),
  ]);
  const pendingCount = pendingResult.count;

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
            // When it was added, which is what decides the album's cover -
            // the order below is when it was taken, which is what the grid
            // and the lightbox read by.
            uploadedAt: p.created_at,
            exifLat: p.exif_lat,
            exifLng: p.exif_lng,
            uploaderName:
              (p.uploader_id ? names.get(p.uploader_id)?.name : null) ?? UNKNOWN_MEMBER_NAME,
          }));

        return {
          id: hike.id,
          locationId: row.id,
          title: hike.title,
          date: hike.date,
          description: hike.description,
          activityType: hike.activity_type,
          climbingStyle: hike.climbing_style,
          lat: hike.lat,
          lng: hike.lng,
          // Only a real GPX track draws a line now. A polyline through photo
          // points was a straight-line join of wherever someone happened to
          // stop and shoot, in time order - it looked like a route and was not
          // one, and could run clean through a mountain. The photos speak for
          // themselves as pins on the map instead.
          track: hike.track,
          routeWaypoints: hike.route_waypoints,
          courseInfo: asCourseInfo(hike.course_info),
          courseId: hike.course_id,
          // What an edit is made against, so two members editing at once is
          // caught rather than silently resolved in favour of whoever saved last.
          updatedAt: hike.updated_at,
          // Read from the column now. This used to say "gpx" for any track at
          // all, which made a line this app drew indistinguishable from a walk
          // somebody recorded - so editing a course could not redraw the line
          // without risking the only copy of a member's GPX.
          trackSource: hike.track_source === "gpx" ? "gpx" : null,
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
