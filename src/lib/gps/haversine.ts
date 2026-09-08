export interface LatLng {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_METERS = 6_371_000;

export function haversineDistanceMeters(a: LatLng, b: LatLng): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  // Clamp against float rounding pushing h fractionally above 1 for near-antipodal points.
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(Math.min(1, h)));
}

export function findNearestLocation<T extends LatLng>(
  point: LatLng,
  candidates: readonly T[],
): { location: T; distanceMeters: number } | null {
  let best: { location: T; distanceMeters: number } | null = null;
  for (const candidate of candidates) {
    const distanceMeters = haversineDistanceMeters(point, candidate);
    if (!best || distanceMeters < best.distanceMeters) {
      best = { location: candidate, distanceMeters };
    }
  }
  return best;
}
