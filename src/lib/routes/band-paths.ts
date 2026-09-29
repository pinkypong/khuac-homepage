import { haversineDistanceMeters } from "@/lib/gps/haversine";
import { sanitizeTrack, type TrackPoint } from "@/lib/gps/track";
import type { CourseProfile, GradientBand } from "./elevation";
import { gradientBands } from "./elevation";
import { TIER_OF, type Tier } from "./grade-style";

export interface BandPath {
  tier: Tier;
  path: TrackPoint[];
}

const metres = (a: TrackPoint, b: TrackPoint) =>
  haversineDistanceMeters({ lat: a[0], lng: a[1] }, { lat: b[0], lng: b[1] });

/** Metres walked from the start to each vertex of the line. */
export function cumulativeMetres(line: TrackPoint[]): number[] {
  const cumulative = [0];
  for (let i = 1; i < line.length; i++) cumulative.push(cumulative[i - 1] + metres(line[i - 1], line[i]));
  return cumulative;
}

/** The point `along` metres in, interpolated inside the segment it falls on. */
export function pointAt(line: TrackPoint[], cumulative: number[], along: number): TrackPoint {
  if (along <= 0) return line[0];
  const last = line.length - 1;
  if (along >= cumulative[last]) return line[last];
  let i = 1;
  while (cumulative[i] < along) i++;
  const span = cumulative[i] - cumulative[i - 1];
  const t = span > 0 ? (along - cumulative[i - 1]) / span : 0;
  return [
    line[i - 1][0] + (line[i][0] - line[i - 1][0]) * t,
    line[i - 1][1] + (line[i][1] - line[i - 1][1]) * t,
  ];
}

/**
 * The line cut into one path per stretch of a single tier.
 *
 * Cut on distance rather than by index, and at the exact boundary: the bands
 * come from a 90m sample, and the drawn line has a vertex every few metres, so
 * picking whole vertices would leave the colour change up to a segment off.
 * Neighbours share their boundary point so the line is unbroken across a change
 * of colour. The first band is stretched back to the start and the last to the
 * end, since the profile can stop short of a line that was too long to sample.
 */
export function pathsByBand(line: TrackPoint[], bands: GradientBand[]): BandPath[] {
  if (line.length < 2 || bands.length === 0) return [];
  const cumulative = cumulativeMetres(line);

  const out: BandPath[] = [];
  bands.forEach((band, index) => {
    const from = index === 0 ? 0 : band.fromAlong;
    const to = index === bands.length - 1 ? cumulative[line.length - 1] : band.toAlong;
    if (to <= from) return;
    const path: TrackPoint[] = [pointAt(line, cumulative, from)];
    for (let i = 0; i < line.length; i++) {
      if (cumulative[i] > from && cumulative[i] < to) path.push(line[i]);
    }
    path.push(pointAt(line, cumulative, to));
    if (path.length < 2) return;
    const tier = TIER_OF[band.steepness];
    const previous = out[out.length - 1];
    // Flat and gentle are both easy, so their bands are one blue line.
    if (previous && previous.tier === tier) previous.path.push(...path.slice(1));
    else out.push({ tier, path });
  });
  return out;
}

/**
 * Coloured paths for a drawn track, or null when there is nothing to colour by.
 *
 * The profile is measured on the sanitized line, so it is cut on the same one.
 */
export function bandPathsFor(track: TrackPoint[], profile: CourseProfile | null): BandPath[] | null {
  if (!profile) return null;
  const line = sanitizeTrack(track);
  if (!line) return null;
  const paths = pathsByBand(line, gradientBands(profile));
  return paths.length > 0 ? paths : null;
}
