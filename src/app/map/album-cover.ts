import type { MapPhoto } from "./map-shell";

/**
 * The one photo that stands for an album.
 *
 * The album's photos are held in the order the day happened - sorted by when
 * each was taken - which is right for the grid and for stepping through the
 * lightbox, and wrong for the cover. Taking photos[0] meant the cover was the
 * earliest shot of the day and never changed again: a member uploaded at dawn,
 * somebody else added a hundred pictures that afternoon, and the album on the
 * front page still showed the first one. Nothing on screen acknowledged the
 * new photos at all.
 *
 * So the cover is the most recently uploaded, which is the one thing that did
 * just change. `uploadedAt` rather than `takenAt` on purpose: a photo taken
 * years ago and added today is news, and a photo taken today and added last
 * week is not.
 *
 * Ties break on id so the cover cannot flicker between two photos that landed
 * in the same instant.
 */
export function albumCover(photos: MapPhoto[]): MapPhoto | undefined {
  let best: MapPhoto | undefined;
  for (const photo of photos) {
    if (!best) { best = photo; continue; }
    const order = photo.uploadedAt.localeCompare(best.uploadedAt) || photo.id.localeCompare(best.id);
    if (order > 0) best = photo;
  }
  return best;
}

/** The album's photos newest-upload-first, for the strips that show a few. */
export function newestFirst(photos: MapPhoto[]): MapPhoto[] {
  return [...photos].sort((a, b) =>
    b.uploadedAt.localeCompare(a.uploadedAt) || b.id.localeCompare(a.id));
}

/**
 * How long an upload stays worth pointing at.
 *
 * Three days rather than one: the club hikes at the weekend and the photos
 * come in over the days after, so a badge that expires overnight would be gone
 * before most members next opened the site.
 */
export const NEW_PHOTO_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * How many of an album's photos arrived recently.
 *
 * The lists order by the outing's date, which is what "최근 활동" says and what
 * a reader expects - a walk from the 15th does not become the most recent
 * thing the club did because somebody uploaded it late. But ordering alone left
 * an upload invisible: a hundred photos could land on an older album and no
 * screen would move. This is the other half - the order stays honest about
 * when the outing was, and the badge says where the new pictures are.
 */
export function newPhotoCount(photos: MapPhoto[], now = Date.now()): number {
  return photos.filter((photo) => {
    const at = Date.parse(photo.uploadedAt);
    return Number.isFinite(at) && now - at < NEW_PHOTO_WINDOW_MS;
  }).length;
}
