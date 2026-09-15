"use server";

import { requireApprovedMember } from "@/lib/supabase/require-role";
import { isValidGps } from "@/lib/gps/validate";
import { sanitizeTrack, unflattenTrack } from "@/lib/gps/track";
import {
  buildProfile,
  cellCentre,
  cellKey,
  sampleAlongTrack,
  sectionsOf,
  waypointsAlong,
  type CourseProfile,
  type CourseSection,
} from "@/lib/routes/elevation";

export interface CourseElevation {
  profile: CourseProfile;
  sections: CourseSection[];
  /** Where each named point stands along the line, for the labels under it. */
  waypointAlong: number[];
  names: string[];
}

/** Copernicus DEM GLO-90, free and without a key. 100 points to a request. */
const BATCH = 100;
/** A course is 45-60 samples; a long GPX is thousands, and 500 is plenty. */
const MAX_SAMPLES = 500;

/**
 * The elevation profile of a drawn course, cached cell by cell.
 *
 * Asked for separately rather than returned with the line, because the line is
 * what the member is waiting to see and this is a second of somebody else's
 * network. The picture fills in underneath a map that is already drawn.
 *
 * Heights are cached on the model's own 90m grid, so the second person to look
 * at a course - or the first to look at any course crossing the same ridge -
 * pays nothing. The ground does not move; there is no staleness to manage.
 */
export async function loadCourseElevation(
  /** Flattened to [lat, lng, lat, lng, ...] - see flattenTrack for why. */
  track: number[],
  waypoints: { name: string; lat: number; lng: number }[],
): Promise<CourseElevation | null> {
  const { supabase } = await requireApprovedMember();

  const line = sanitizeTrack(unflattenTrack(track));
  if (!line || line.length < 2) return null;

  const sampled = sampleAlongTrack(line).slice(0, MAX_SAMPLES);
  if (sampled.length < 2) return null;

  // One question per cell. A course doubling back over a pass asks about that
  // pass twice, and the model has one answer for it.
  const keys = [...new Set(sampled.map(({ point }) => cellKey(point[0], point[1])))];
  const known = new Map<string, number>();
  for (let i = 0; i < keys.length; i += 200) {
    const { data } = await supabase
      .from("elevation_cells")
      .select("cell_key, elevation")
      .in("cell_key", keys.slice(i, i + 200));
    for (const row of (data ?? []) as unknown as { cell_key: string; elevation: number }[]) {
      known.set(row.cell_key, row.elevation);
    }
  }

  const missing = keys.filter((key) => !known.has(key));
  if (missing.length > 0) {
    const found = await fetchElevations(missing);
    if (found === null) return null;
    for (const [key, elevation] of found) known.set(key, elevation);
    // Written for whoever looks next. A failure here costs a repeat lookup and
    // nothing else, so it is logged rather than raised.
    const rows = [...found].map(([cell_key, elevation]) => ({ cell_key, elevation: Math.round(elevation) }));
    for (let i = 0; i < rows.length; i += 200) {
      const { error } = await supabase
        .from("elevation_cells")
        .upsert(rows.slice(i, i + 200), { onConflict: "cell_key" });
      if (error) console.error("[elevation] cache write failed", error.message);
    }
  }

  const heights = sampled.map(({ point }) => known.get(cellKey(point[0], point[1])));
  if (heights.some((height) => height === undefined)) return null;

  const profile = buildProfile(line, sampled, heights as number[]);
  if (!profile) return null;

  const placed = waypoints.filter((waypoint) => isValidGps(waypoint.lat, waypoint.lng));
  const along = waypointsAlong(line, placed);
  return {
    profile,
    sections: sectionsOf(profile, placed.map((waypoint) => waypoint.name), along),
    waypointAlong: along,
    names: placed.map((waypoint) => waypoint.name),
  };
}

/**
 * Heights for cells we do not hold, from the middle of each cell.
 *
 * Null rather than a partial answer when the service refuses: half a profile
 * drawn as if it were whole would show a ridge where the missing part is.
 */
async function fetchElevations(keys: string[]): Promise<Map<string, number> | null> {
  const out = new Map<string, number>();
  for (let i = 0; i < keys.length; i += BATCH) {
    const batch = keys.slice(i, i + BATCH);
    const centres = batch.map(cellCentre);
    const url = "https://api.open-meteo.com/v1/elevation"
      + `?latitude=${centres.map((c) => c.lat.toFixed(5)).join(",")}`
      + `&longitude=${centres.map((c) => c.lng.toFixed(5)).join(",")}`;
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const { elevation } = await response.json() as { elevation: number[] };
      if (elevation.length !== batch.length) throw new Error("length mismatch");
      batch.forEach((key, at) => out.set(key, elevation[at]));
    } catch (error) {
      console.error("[elevation] lookup failed", String(error));
      return null;
    }
  }
  return out;
}
