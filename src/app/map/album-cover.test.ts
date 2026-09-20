import { describe, it, expect } from "vitest";
import { albumCover, NEW_PHOTO_WINDOW_MS, newPhotoCount, newestFirst } from "./album-cover";
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

describe("new photo badge", () => {
  // The lists order by the outing's date, so an upload onto an older album
  // moves nothing on screen. The badge is what says it happened - without it,
  // a hundred photos could land and no screen would change at all.
  const now = Date.parse("2026-09-25T12:00:00Z");

  it("counts only what arrived inside the window", () => {
    const photos = [
      photo("new", null, "2026-09-25T09:00:00Z"),
      photo("yesterday", null, "2026-09-24T09:00:00Z"),
      photo("old", null, "2026-09-01T09:00:00Z"),
    ];
    expect(newPhotoCount(photos, now)).toBe(2);
  });

  it("does not care when the photo was taken", () => {
    // A climb from years ago, uploaded this morning, is new here.
    expect(newPhotoCount([photo("z", "2019-05-01T00:00:00Z", "2026-09-25T09:00:00Z")], now)).toBe(1);
  });

  it("is nothing for an album nobody has touched", () => {
    expect(newPhotoCount([dawn, noon], now)).toBe(0);
    expect(newPhotoCount([], now)).toBe(0);
  });

  it("survives a timestamp it cannot read", () => {
    expect(newPhotoCount([photo("bad", null, "not a date")], now)).toBe(0);
  });

  it("spans a weekend, so photos posted over the following days still show", () => {
    expect(NEW_PHOTO_WINDOW_MS).toBeGreaterThanOrEqual(3 * 24 * 60 * 60 * 1000);
  });
});
