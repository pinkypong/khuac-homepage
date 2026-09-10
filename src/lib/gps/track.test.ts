import { describe, expect, it } from "vitest";
import {
  downsampleTrack,
  formatDistance,
  photoPointsToTrack,
  sanitizeTrack,
  trackDistanceMeters,
  type TrackPoint,
} from "./track";

const bukhansan: TrackPoint = [37.6585, 126.9772];

describe("downsampleTrack", () => {
  it("leaves short tracks alone", () => {
    const points: TrackPoint[] = [bukhansan, [37.66, 126.98]];
    expect(downsampleTrack(points, 500)).toEqual(points);
  });

  it("caps long tracks and keeps the final point", () => {
    const points: TrackPoint[] = Array.from({ length: 2000 }, (_, i) => [37.6 + i / 100000, 126.9]);
    const out = downsampleTrack(points, 100);
    expect(out.length).toBeLessThanOrEqual(101);
    expect(out[out.length - 1]).toEqual(points[points.length - 1]);
  });
});

describe("trackDistanceMeters", () => {
  it("sums leg distances", () => {
    // ~1km due north (1 degree lat ~= 111.2km)
    const north: TrackPoint = [bukhansan[0] + 1000 / 111200, bukhansan[1]];
    const distance = trackDistanceMeters([bukhansan, north]);
    expect(distance).toBeGreaterThan(900);
    expect(distance).toBeLessThan(1100);
  });

  it("is 0 for a single point", () => {
    expect(trackDistanceMeters([bukhansan])).toBe(0);
  });
});

describe("formatDistance", () => {
  it("switches to km past 1000m", () => {
    expect(formatDistance(840)).toBe("840m");
    expect(formatDistance(8400)).toBe("8.4km");
  });
});

describe("photoPointsToTrack", () => {
  it("orders points by capture time", () => {
    const track = photoPointsToTrack([
      { exifLat: 37.66, exifLng: 126.98, takenAt: "2026-09-01T10:00:00Z" },
      { exifLat: 37.65, exifLng: 126.97, takenAt: "2026-09-01T08:00:00Z" },
    ]);
    expect(track).toEqual([
      [37.65, 126.97],
      [37.66, 126.98],
    ]);
  });

  it("skips photos without usable GPS", () => {
    const track = photoPointsToTrack([
      { exifLat: 37.66, exifLng: 126.98, takenAt: "2026-09-01T10:00:00Z" },
      { exifLat: null, exifLng: null, takenAt: "2026-09-01T11:00:00Z" },
      { exifLat: 0, exifLng: 0, takenAt: "2026-09-01T12:00:00Z" },
    ]);
    expect(track).toBeNull();
  });
});

describe("sanitizeTrack", () => {
  it("accepts a well-formed track", () => {
    expect(sanitizeTrack([[37.65, 126.97], [37.66, 126.98]])).toEqual([
      [37.65, 126.97],
      [37.66, 126.98],
    ]);
  });

  it("rejects malformed input", () => {
    expect(sanitizeTrack("nope")).toBeNull();
    expect(sanitizeTrack([[37.65]])).toBeNull();
    expect(sanitizeTrack([["a", "b"], [1, 2]])).toBeNull();
    expect(sanitizeTrack([[91, 126.97], [37.66, 126.98]])).toBeNull();
    expect(sanitizeTrack([[37.65, 126.97]])).toBeNull();
  });
});
