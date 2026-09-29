import { sanitizeTrack, type TrackPoint } from "@/lib/gps/track";
import { haversineDistanceMeters } from "@/lib/gps/haversine";
import { cumulativeMetres, pointAt } from "./band-paths";
import type { CourseProfile } from "./elevation";
import type { HazardKind } from "./hazards";

export type MarkerKind = HazardKind | "start" | "end" | "summit";

/** One glyph per kind, used on the map pins and in the legend so they match. */
export const MARKER_GLYPH: Record<MarkerKind, string> = {
  isolation: "🚫",
  washout: "🕳️",
  flood: "🌊",
  rope: "🪢",
  rail: "🚧",
  start: "🚩",
  end: "🏁",
  summit: "⛰️",
};

/**
 * Where the walk begins and ends. `end` is null for a loop that comes back to
 * within `loopMeters` of the start: two pins on top of each other say nothing.
 */
export function routeEnds(
  track: readonly TrackPoint[],
  loopMeters = 50,
): { start: TrackPoint; end: TrackPoint | null } | null {
  if (track.length < 2) return null;
  const start = track[0];
  const end = track[track.length - 1];
  const apart = haversineDistanceMeters(
    { lat: start[0], lng: start[1] },
    { lat: end[0], lng: end[1] },
  );
  return { start, end: apart <= loopMeters ? null : end };
}

/**
 * The highest sample of the profile, placed on the line.
 *
 * The profile is measured along the sanitized track, so the position is
 * interpolated on that same line at the sample's `along` distance.
 */
export function summitOf(
  track: TrackPoint[],
  profile: CourseProfile | null,
): { lat: number; lng: number; elevation: number } | null {
  if (!profile || profile.points.length === 0) return null;
  const line = sanitizeTrack(track);
  if (!line) return null;
  let top = profile.points[0];
  for (const point of profile.points) if (point.elevation > top.elevation) top = point;
  const [lat, lng] = pointAt(line, cumulativeMetres(line), top.along);
  return { lat, lng, elevation: top.elevation };
}

/** The middle height of the walk, for aiming the camera at the mountain and not at sea level. */
export function medianElevation(profile: CourseProfile | null): number | null {
  if (!profile || profile.points.length === 0) return null;
  const sorted = profile.points.map((p) => p.elevation).sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
