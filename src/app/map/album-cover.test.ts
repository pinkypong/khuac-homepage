import { describe, it, expect } from "vitest";
import { albumCover, byLastActivity, lastActivityAt, newestFirst } from "./album-cover";
import type { MapPhoto } from "./map-shell";

const photo = (id: string, takenAt: string | null, uploadedAt: string): MapPhoto => ({
  id, storageKey: `photos/${id}.jpg`, takenAt, uploadedAt,
  exifLat: null, exifLng: null, uploaderName: "부원",
});

// The real case: one member uploads at dawn, another adds theirs that evening.
const dawn = photo("a", "2026-09-19T06:06:00Z", "2026-09-19T14:53:00Z");
const noon = photo("b", "2026-09-19T12:47:00Z", "2026-09-20T11:03:00Z");

describe("album cover", () => {
  it("is the newest upload, not the earliest shot", () => {
    // photos arrive sorted by when they were taken, which is what the grid and
    // the lightbox read by - so the first element is the dawn photo.
    expect([dawn, noon][0]).toBe(dawn);
    expect(albumCover([dawn, noon])?.id).toBe("b");
  });

  it("does not care when the photo was taken", () => {
    // A photo shot years ago and added today is news; one shot today and added
    // last week is not.
    const old = photo("c", "2019-01-01T00:00:00Z", "2026-09-20T23:00:00Z");
    expect(albumCover([dawn, noon, old])?.id).toBe("c");
  });

  it("has no cover for an album with no photos", () => {
    expect(albumCover([])).toBeUndefined();
  });

  it("breaks a tie on id so the cover cannot flicker", () => {
    const same = "2026-09-20T11:03:00Z";
    const x = photo("x", null, same);
    const y = photo("y", null, same);
    expect(albumCover([x, y])?.id).toBe(albumCover([y, x])?.id);
  });

  it("lists newest upload first for the strip", () => {
    expect(newestFirst([dawn, noon]).map((p) => p.id)).toEqual(["b", "a"]);
  });
});

describe("album ordering", () => {
  const withPhotos = { id: "h1", date: "2026-09-19", photos: [dawn, noon] };
  const laterOuting = { id: "h2", date: "2026-09-20", photos: [] as MapPhoto[] };

  it("counts an upload as activity, not just the outing's date", () => {
    expect(lastActivityAt(withPhotos)).toBe("2026-09-20T11:03:00Z");
    expect(lastActivityAt(laterOuting)).toBe("2026-09-20");
  });

  it("puts a freshly filled older album above an emptier newer one", () => {
    // What the home screen got wrong: someone added photos to the 19th's album
    // and it stayed below the 20th's empty one, so the upload showed nowhere.
    const sorted = [{ hike: laterOuting }, { hike: withPhotos }].sort(byLastActivity);
    expect(sorted.map((a) => a.hike.id)).toEqual(["h1", "h2"]);
  });

  it("still orders by date when nothing has been uploaded", () => {
    const older = { hike: { id: "old", date: "2026-09-01", photos: [] as MapPhoto[] } };
    const newer = { hike: { id: "new", date: "2026-09-15", photos: [] as MapPhoto[] } };
    expect([older, newer].sort(byLastActivity).map((a) => a.hike.id)).toEqual(["new", "old"]);
  });
});
