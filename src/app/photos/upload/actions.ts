"use server";

import { requireApprovedMember } from "@/lib/supabase/require-role";
import { buildStorageKey, deleteObject, headObject, presignPutUrl } from "@/lib/r2/client";
import { MAX_PHOTO_BYTES, PHOTO_LIMITS_HINT, isAllowedPhotoType } from "@/lib/photos/limits";
import { isValidGps } from "@/lib/gps/validate";
import { matchPhotoLocation, type LocationCandidate } from "@/lib/gps/match-photo-location";
import type { PhotoLocationMatchStatus } from "@/types/database";
import { uploadPhotoId } from "@/lib/photos/storage-key";

export async function presignPhotoUpload(input: { filename: string; contentType: string }) {
  const { memberId } = await requireApprovedMember();
  if (!isAllowedPhotoType(input.contentType)) {
    throw new Error(PHOTO_LIMITS_HINT);
  }
  const storageKey = buildStorageKey(input.filename, memberId);
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

export interface ClientExif {
  lat: number | null;
  lng: number | null;
  takenAt: string | null;
  width: number | null;
  height: number | null;
}

// Bounds a camera cannot credibly report, so a malformed or invented value is
// stored as "unknown" rather than as a date the gallery would sort by.
const EARLIEST_PHOTO = Date.parse("1990-01-01T00:00:00Z");

function sanitiseExif(raw: ClientExif | undefined) {
  const lat = raw?.lat ?? null;
  const lng = raw?.lng ?? null;
  const gpsOk = isValidGps(lat, lng);

  const parsed = raw?.takenAt ? Date.parse(raw.takenAt) : NaN;
  const takenAt =
    Number.isFinite(parsed) && parsed > EARLIEST_PHOTO && parsed < Date.now() + 86_400_000
      ? new Date(parsed)
      : null;

  const dimension = (value: number | null | undefined) =>
    typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 100_000
      ? value
      : null;

  return {
    lat: gpsOk ? lat : null,
    lng: gpsOk ? lng : null,
    takenAt,
    width: dimension(raw?.width),
    height: dimension(raw?.height),
  };
}

export async function processUploadedPhoto(input: {
  storageKey: string;
  hikeId: string | null;
  exif?: ClientExif;
  /** From src/lib/photos/face-detect.ts. Undefined and null are both stored
      as unset - see has_face's column comment for why that reads as "has a
      face" wherever anything gates on it. Not trusted as a security boundary:
      a browser could report anything here. */
  hasFace?: boolean | null;
}): Promise<ProcessPhotoResult> {
  const { supabase, memberId } = await requireApprovedMember();
  const photoId = uploadPhotoId(input.storageKey, memberId);
  if (!photoId) throw new Error("업로드 정보가 올바르지 않습니다. 사진을 다시 선택해주세요.");

  async function existingPhoto(): Promise<ProcessPhotoResult | null> {
    const { data, error } = await supabase.from("photos")
      .select("id, uploader_id, storage_key_original, hike_id, location_match_status")
      .eq("id", photoId!).maybeSingle();
    if (error) throw error;
    if (!data) return null;
    if (data.uploader_id !== memberId || data.storage_key_original !== input.storageKey || data.hike_id !== input.hikeId) {
      throw new Error("이미 다른 앨범에 등록된 업로드입니다.");
    }
    return { photoId: data.id, status: data.location_match_status as PhotoLocationMatchStatus };
  }
  const existing = await existingPhoto();
  if (existing) return existing;

  const object = await headObject(input.storageKey);
  if (!object) throw new Error("Uploaded object not found in R2");

  // A presigned PUT can't constrain what the client actually sends, so the
  // real check happens here - and anything rejected is removed rather than
  // left paying for storage. HEAD is enough: this checks what the object says
  // it is and how big it is, which is exactly what reading every byte told us.
  if (!isAllowedPhotoType(object.contentType) || !Number.isFinite(object.size) || object.size <= 0 || object.size > MAX_PHOTO_BYTES) {
    await deleteObject(input.storageKey);
    throw new Error(PHOTO_LIMITS_HINT);
  }

  // EXIF is read in the browser now. Pulling the whole file back into the
  // Worker to read a header that sits in its first few KB was the slowest step
  // in the upload, and on a phone it doubled the bytes each photo had to move.
  // These values are not trusted on arrival - a member could equally mislead by
  // uploading a photo of somewhere else - so they are range-checked here.
  const exif = sanitiseExif(input.exif);

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
      // The upload UUID is also the row ID: concurrent retries cannot insert twice.
      id: photoId,
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
      has_face: input.hasFace ?? null,
    })
    .select("id")
    .single();

  if (error) {
    // A lost response or a concurrent retry may have committed the row already.
    // Never delete its original merely because this request reported an error.
    const committed = await existingPhoto();
    if (committed) return committed;
    throw error;
  }
  return { photoId: (photo as { id: string }).id, status: match.status };
}
