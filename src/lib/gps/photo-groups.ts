import { isValidGps } from "./validate";

const EARTH_RADIUS_M = 6_371_000;
const rad = (degrees: number) => (degrees * Math.PI) / 180;

/** Flat-earth distance, which is exact enough over the few hundred metres this folds across. */
function metresBetween(a: Position, b: Position): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng) * Math.cos(rad((a.lat + b.lat) / 2));
  return Math.hypot(dLat, dLng) * EARTH_RADIUS_M;
}

interface Position { lat: number; lng: number }
interface Photo { id: string; exifLat: number | null; exifLng: number | null }
export interface PhotoGroup<T> { key: string; position: Position; photos: T[] }

/**
 * The photos of one outing, folded into the pins a map can actually show.
 *
 * `radiusMeters` is how far apart two photos have to be to earn separate pins.
 * Zero keeps the old behaviour - only exactly equal coordinates fold - which is
 * no folding at all in practice: a phone records a different position for every
 * shot taken while walking, so 200 photos became 200 pins, each loading its own
 * thumbnail, none of them allowed to hide.
 *
 * The caller passes a radius derived from the zoom rather than a fixed distance,
 * because a fixed one cannot serve both albums we have. Framed on a phone, a
 * 44px pin covers 598m of the 숨은벽 course - so folding at 30m or at 60m leaves
 * everything between 31m and 598m still piled on top of itself. The 인수봉
 * climbing album is 550m across and opens on a desktop with a pin covering 30m,
 * where folding at 60m would merge the approach's end with the route's start,
 * two points a member can plainly tell apart on that screen.
 *
 * Distance is measured to the group's first photo rather than to its nearest
 * member, which bounds a group to the radius. Measuring to the nearest member
 * chains: photos taken every 18m along a trail would link end to end and fold a
 * whole ridge into one pin however far apart its ends were.
 *
 * The key is the leading photo's id, not a coordinate, so it survives the
 * regrouping that a zoom causes - an open group stays open while the map moves.
 */
export function groupPhotosByPosition<T extends Photo>(
  photos: T[],
  radiusMeters = 0,
): PhotoGroup<T>[] {
  const groups: { key: string; anchor: Position; photos: T[]; positions: Position[] }[] = [];

  for (const photo of photos) {
    if (!isValidGps(photo.exifLat, photo.exifLng)) continue;
    const position = { lat: photo.exifLat as number, lng: photo.exifLng as number };

    const near = groups.find((group) =>
      radiusMeters > 0
        ? metresBetween(group.anchor, position) <= radiusMeters
        : group.anchor.lat === position.lat && group.anchor.lng === position.lng);

    if (near) {
      near.photos.push(photo);
      near.positions.push(position);
    } else {
      groups.push({ key: photo.id, anchor: position, photos: [photo], positions: [position] });
    }
  }

  // The pin sits in the middle of what it stands for. A group drawn on its first
  // photo would sit off to one edge of the shots it covers.
  return groups.map((group) => ({
    key: group.key,
    position: {
      lat: group.positions.reduce((sum, p) => sum + p.lat, 0) / group.positions.length,
      lng: group.positions.reduce((sum, p) => sum + p.lng, 0) / group.positions.length,
    },
    photos: group.photos,
  }));
}

/**
 * How far apart two things must be to not overlap on screen, in metres.
 *
 * The photo pin is 44px square with a 2px border, so anything closer than about
 * this is drawn on top of its neighbour whatever the folding rule says.
 */
export const PHOTO_PIN_PIXELS = 52;

/** Web Mercator ground resolution: how much ground one pixel covers at this zoom. */
export function metresPerPixel(latitude: number, zoom: number): number {
  return (156_543.03392 * Math.cos(rad(latitude))) / Math.pow(2, zoom);
}
