"use server";

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { requireApprovedMember } from "@/lib/supabase/require-role";
import { buildStorageKey, presignPutUrl } from "@/lib/r2/presign";
import { parseExif } from "@/lib/gps/exif";
import { matchPhotoLocation, type LocationCandidate } from "@/lib/gps/match-photo-location";
import type { PhotoLocationMatchStatus } from "@/types/database";

export async function presignPhotoUpload(input: { filename: string; contentType: string }) {
  await requireApprovedMember();
  const storageKey = buildStorageKey(input.filename);
  const uploadUrl = await presignPutUrl(storageKey);
  return { storageKey, uploadUrl, contentType: input.contentType };
}

export interface ProcessPhotoResult {
  photoId: string;
  status: PhotoLocationMatchStatus;
}

interface HikeLocationRow {
  location: { id: string; lat: number | null; lng: number | null } | null;
}

export async function processUploadedPhoto(input: {
  storageKey: string;
  hikeId: string | null;
}): Promise<ProcessPhotoResult> {
  const { supabase, memberId } = await requireApprovedMember();

  const { env } = getCloudflareContext();
  const object = await env.PHOTOS_BUCKET.get(input.storageKey);
  if (!object) throw new Error("Uploaded object not found in R2");

  const bytes = await object.arrayBuffer();
  const exif = await parseExif(bytes);

  let hikeLocation: LocationCandidate | null = null;
  if (input.hikeId) {
    const { data } = await supabase
      .from("hikes")
      .select("location:locations!location_id(id, lat, lng)")
      .eq("id", input.hikeId)
      .single();
    const hike = data as unknown as HikeLocationRow | null;
    const location = hike?.location;
    if (location?.lat != null && location?.lng != null) {
      hikeLocation = { id: location.id, lat: location.lat, lng: location.lng };
    }
  }

  const { data: locationsData } = await supabase
    .from("locations")
    .select("id, lat, lng")
    .not("lat", "is", null)
    .not("lng", "is", null);

  const candidateLocations: LocationCandidate[] = ((locationsData ?? []) as {
    id: string;
    lat: number | null;
    lng: number | null;
  }[])
    .filter((l) => l.lat != null && l.lng != null)
    .map((l) => ({ id: l.id, lat: l.lat as number, lng: l.lng as number }));

  const match = matchPhotoLocation({
    exifGps: exif.lat != null && exif.lng != null ? { lat: exif.lat, lng: exif.lng } : null,
    hikeId: input.hikeId,
    hikeLocation,
    candidateLocations,
  });

  const { data: photo, error } = await supabase
    .from("photos")
    .insert({
      hike_id: input.hikeId,
      uploader_id: memberId,
      storage_key_original: input.storageKey,
      taken_at: exif.takenAt ? exif.takenAt.toISOString() : null,
      exif_lat: exif.lat,
      exif_lng: exif.lng,
      location_match_status: match.status,
      matched_location_id: match.matchedLocationId,
      width: exif.width,
      height: exif.height,
    })
    .select("id")
    .single();

  if (error) throw error;
  return { photoId: (photo as { id: string }).id, status: match.status };
}
