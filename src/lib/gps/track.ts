import { haversineDistanceMeters, type LatLng } from "./haversine";
import { isValidGps } from "./validate";

/** A route as stored in hikes.track: [[lat, lng], ...] */
export type TrackPoint = [number, number];

export const MAX_TRACK_POINTS = 500;

export function toLatLng(point: TrackPoint): LatLng {
  return { lat: point[0], lng: point[1] };
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
