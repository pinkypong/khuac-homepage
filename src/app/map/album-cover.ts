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
 * When an album last had anything happen to it.
 *
 * The lists ordered by `hike.date` - the day of the outing - which answers
 * "what did we do most recently" and not "what is new here". An album from an
 * earlier outing that somebody has just filled with a hundred photos stayed
 * exactly where it was, below an emptier album from a later date, and the
 * upload left no trace on the home screen at all.
 *
 * So the key is the later of the outing's date and its newest upload. Both are
 * ISO and compare as strings: a bare "2026-09-19" sorts before any timestamp on
 * the 19th, which puts an album nobody has added to just under one somebody
 * has. The date carries no time zone and the timestamps are UTC, so the two can
 * disagree by hours at a boundary - which changes the order of two albums from
 * the same day and nothing more.
 */
export function lastActivityAt(hike: { date: string; photos: MapPhoto[] }): string {
  let latest = hike.date;
  for (const photo of hike.photos) {
    if (photo.uploadedAt > latest) latest = photo.uploadedAt;
  }
  return latest;
}

/** Newest first by that key, ties broken on id so the order cannot flicker. */
export function byLastActivity<T extends { hike: { id: string; date: string; photos: MapPhoto[] } }>(
  a: T,
  b: T,
): number {
  return lastActivityAt(b.hike).localeCompare(lastActivityAt(a.hike))
    || a.hike.id.localeCompare(b.hike.id);
}
