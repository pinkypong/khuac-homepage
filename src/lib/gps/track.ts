import { haversineDistanceMeters, type LatLng } from "./haversine";
import { isValidGps } from "./validate";

/** A route as stored in hikes.track: [[lat, lng], ...] */
export type TrackPoint = [number, number];

export const MAX_TRACK_POINTS = 500;

export function toLatLng(point: TrackPoint): LatLng {
  return { lat: point[0], lng: point[1] };
}

/**
 * A track as one flat run of numbers, for sending to a server action.
 *
 * [[lat, lng], ...] cannot be sent. React's reply decoder refuses it:
 *
 *   Error: Maximum array nesting exceeded. Large nested arrays can be
 *   dangerous. Try adding intermediate objects.
 *
 * and refuses it before any of our code runs, so "코스로 앨범 만들기" answered
 * with a 500 that nothing we wrote could explain. It is not a size limit - 500
 * points of distinct coordinates pass at 11.6KB. It is repetition: the decoder
 * adds a referenced array's whole count to the total every time the encoder
 * emits a reference to it, which grows as the square of the repeats. 200 points
 * walked once and back trip it at 8.1KB.
 *
 * And our tracks repeat by construction. A leg is `path.map(id =>
 * graph.nodes[id])` and graph.nodes holds one object per node, so two legs
 * meeting at a junction share that junction's object, and a course that comes
 * back on itself shares a whole run of them.
 *
 * Numbers have no identity, so a flat run of them has nothing to reference and
 * nothing to nest. The pairing is positional: even index latitude, odd
 * longitude.
 */
export function flattenTrack(points: TrackPoint[]): number[] {
  const out = new Array<number>(points.length * 2);
  for (let i = 0; i < points.length; i++) {
    out[i * 2] = points[i][0];
    out[i * 2 + 1] = points[i][1];
  }
  return out;
}

/** The pairs back out of a flat run. Null for anything that is not one. */
export function unflattenTrack(input: unknown): TrackPoint[] | null {
  if (!Array.isArray(input) || input.length % 2 !== 0) return null;
  const out: TrackPoint[] = [];
  for (let i = 0; i < input.length; i += 2) {
    const lat = input[i];
    const lng = input[i + 1];
    if (typeof lat !== "number" || typeof lng !== "number") return null;
    out.push([lat, lng]);
  }
  return out;
}

/**
 * Pulls <trkpt lat lon> out of a GPX file. Runs in the browser (DOMParser):
 * Workers have no XML parser, so the file is parsed client-side and only the
 * resulting coordinates are sent to the server.
 */
export function parseGpxPoints(xmlText: string): TrackPoint[] {
  const doc = new DOMParser().parseFromString(xmlText, "application/xml");
  if (doc.querySelector("parsererror")) {
    throw new Error("GPX 파일을 읽을 수 없습니다.");
  }

  const points: TrackPoint[] = [];
  for (const node of doc.querySelectorAll("trkpt, rtept")) {
    const lat = Number(node.getAttribute("lat"));
    const lng = Number(node.getAttribute("lon"));
    if (isValidGps(lat, lng)) points.push([lat, lng]);
  }
  return points;
}

/** GPX tracks routinely hold thousands of points; keep every nth plus the end. */
export function downsampleTrack(points: TrackPoint[], max = MAX_TRACK_POINTS): TrackPoint[] {
  if (points.length <= max) return points;
  const stride = Math.ceil(points.length / max);
  const out = points.filter((_, i) => i % stride === 0);
  const last = points[points.length - 1];
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}

export function trackDistanceMeters(points: TrackPoint[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += haversineDistanceMeters(toLatLng(points[i - 1]), toLatLng(points[i]));
  }
  return total;
}

export function formatDistance(meters: number): string {
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)}km` : `${Math.round(meters)}m`;
}


/** Server-side guard for coordinates arriving from the browser. */
export function sanitizeTrack(input: unknown): TrackPoint[] | null {
  if (!Array.isArray(input)) return null;
  const points: TrackPoint[] = [];
  for (const item of input) {
    if (!Array.isArray(item) || item.length !== 2) return null;
    const [lat, lng] = item;
    if (typeof lat !== "number" || typeof lng !== "number") return null;
    if (!isValidGps(lat, lng)) return null;
    points.push([lat, lng]);
  }
  if (points.length < 2) return null;
  return downsampleTrack(points);
}
