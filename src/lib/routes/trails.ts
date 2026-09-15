import { haversineDistanceMeters } from "../gps/haversine";
import { downsampleTrack, type TrackPoint } from "../gps/track";

/**
 * One mapped path, straight out of OpenStreetMap.
 *
 * OSM is where real trail geometry comes from. Naver's map draws hiking routes
 * as rendered tiles with no way to read the coordinates back, and a line drawn
 * between named waypoints is a straight join, not a path - the same fiction the
 * photo-derived polyline was.
 */
export interface TrailSegment {
  id: number;
  name: string | null;
  /** The OSM highway value: path, footway, track, steps. */
  kind: string;
  points: TrackPoint[];
}

/** Imported survey rows sometimes concatenate disconnected pieces. Never
 * interpret those jumps as climbable geometry. OSM ways are not subjected to
 * this spacing rule because sparse roads legitimately have long edges. */
export function splitSurveyGaps(segments: TrailSegment[]): TrailSegment[] {
  return segments.flatMap((segment) => {
    const parts: TrackPoint[][] = [[]];
    for (const point of segment.points) {
      const last = parts.at(-1)!;
      const previous = last.at(-1);
      if (previous && haversineDistanceMeters({ lat: previous[0], lng: previous[1] }, { lat: point[0], lng: point[1] }) > 150) {
        parts.push([point]);
      } else last.push(point);
    }
    const kept = parts.filter((points) => points.length >= 2);
    // A segment with no gaps in it keeps its id. Renumbering unconditionally
    // meant every row from official_trails came out with a new identity, and
    // the id is how a line traced from GPS is recognised as one - so those
    // lines lost the allowance that ties them into the network and sat beside
    // it unused. Only a segment that really was cut needs new ids.
    if (kept.length === 1) return [{ ...segment, points: kept[0] }];
    return kept.map((points, i) => ({
      ...segment, id: -(Math.abs(segment.id) * 10000 + i), points,
    }));
  });
}

/** Two segment ends closer than this are treated as the same junction. */
const JOIN_TOLERANCE_M = 60;

interface OverpassWay {
  type: string;
  id: number;
  tags?: Record<string, string>;
  geometry?: { lat: number; lon: number }[];
}

export function parseOverpassWays(payload: unknown): TrailSegment[] {
  const elements = (payload as { elements?: OverpassWay[] } | null)?.elements;
  if (!Array.isArray(elements)) return [];

  return elements
    .filter((el) => el.type === "way" && Array.isArray(el.geometry) && el.geometry.length >= 2)
    .map((el) => ({
      id: el.id,
      name: el.tags?.name ?? null,
      kind: el.tags?.highway ?? "path",
      points: (el.geometry as { lat: number; lon: number }[]).map(
        (g) => [g.lat, g.lon] as TrackPoint,
      ),
    }));
}

/**
 * Joins chosen segments into one line.
 *
 * OSM stores a way in whichever direction it was drawn, which has nothing to do
 * with the direction anyone walks it. Each segment is therefore flipped or not
 * based on which of its ends is nearer the point reached so far, and a segment
 * that starts nowhere near that point is dropped rather than teleported to -
 * an unreachable segment means the wrong one was picked, and a line that jumps
 * across a valley is worse than a short one.
 */
export function stitchSegments(segments: TrailSegment[]): TrackPoint[] {
  const usable = segments.filter((s) => s.points.length >= 2);
  if (usable.length === 0) return [];

  const track: TrackPoint[] = [...usable[0].points];

  for (const segment of usable.slice(1)) {
    const tail = track[track.length - 1];
    const start = segment.points[0];
    const end = segment.points[segment.points.length - 1];

    const toStart = haversineDistanceMeters(
      { lat: tail[0], lng: tail[1] },
      { lat: start[0], lng: start[1] },
    );
    const toEnd = haversineDistanceMeters(
      { lat: tail[0], lng: tail[1] },
      { lat: end[0], lng: end[1] },
    );

    const nearest = Math.min(toStart, toEnd);
    if (nearest > JOIN_TOLERANCE_M) continue;

    const oriented = toEnd < toStart ? [...segment.points].reverse() : segment.points;
    // Drop the duplicated junction point where the two segments meet.
    track.push(...oriented.slice(1));
  }

  return downsampleTrack(track);
}

/** Metres of trail, used to sanity-check a suggestion before it is offered. */
export function segmentLengthMeters(segment: TrailSegment): number {
  let total = 0;
  for (let i = 1; i < segment.points.length; i++) {
    const a = segment.points[i - 1];
    const b = segment.points[i];
    total += haversineDistanceMeters({ lat: a[0], lng: a[1] }, { lat: b[0], lng: b[1] });
  }
  return total;
}

/**
 * Trimmed down for a language model: names, length and endpoints only.
 *
 * Handing over every coordinate would be most of a megabyte of numbers it has
 * no use for - it is choosing *which* paths were walked and in what order, and
 * the geometry is stitched here afterwards.
 */
export function describeSegments(segments: TrailSegment[]) {
  return segments.map((s) => ({
    id: s.id,
    name: s.name,
    kind: s.kind,
    lengthM: Math.round(segmentLengthMeters(s)),
    start: s.points[0],
    end: s.points[s.points.length - 1],
  }));
}
