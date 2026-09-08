import { findNearestLocation, type LatLng } from "./haversine";
import type { PhotoLocationMatchStatus } from "@/types/database";

const MATCH_RADIUS_METERS = 500;

export type LocationCandidate = LatLng & { id: string };

export interface MatchPhotoLocationInput {
  /** Parsed + validated EXIF GPS, or null if absent/invalid. */
  exifGps: LatLng | null;
  /** The hike selected at upload time, if any. */
  hikeId: string | null;
  /** That hike's location, only if it both exists and has coordinates. */
  hikeLocation: LocationCandidate | null;
  /** Every registered location that has coordinates, for radius search. */
  candidateLocations: readonly LocationCandidate[];
}

export interface MatchPhotoLocationResult {
  status: PhotoLocationMatchStatus;
  matchedLocationId: string | null;
}

/**
 * Four cases from the spec, in order:
 *  - EXIF GPS within 500m of a registered location -> auto_matched
 *  - EXIF GPS present but nothing registered nearby -> manual_pending
 *  - No EXIF GPS, but the selected hike already has a location -> manual_matched
 *  - No EXIF GPS, hike has no location -> manual_pending
 *
 * A fifth case the spec's prose doesn't name directly but the schema clearly
 * anticipates (photos.hike_id is nullable): no EXIF GPS and no hike was even
 * selected, so there's nothing to fall back to yet -> no_gps. This keeps all
 * four enum values meaningfully distinct instead of 'no_gps' being dead code.
 */
export function matchPhotoLocation({
  exifGps,
  hikeId,
  hikeLocation,
  candidateLocations,
}: MatchPhotoLocationInput): MatchPhotoLocationResult {
  if (exifGps) {
    const nearest = findNearestLocation(exifGps, candidateLocations);
    if (nearest && nearest.distanceMeters <= MATCH_RADIUS_METERS) {
      return { status: "auto_matched", matchedLocationId: nearest.location.id };
    }
    return { status: "manual_pending", matchedLocationId: null };
  }

  if (!hikeId) {
    return { status: "no_gps", matchedLocationId: null };
  }

  if (hikeLocation) {
    return { status: "manual_matched", matchedLocationId: hikeLocation.id };
  }

  return { status: "manual_pending", matchedLocationId: null };
}
