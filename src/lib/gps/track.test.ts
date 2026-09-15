import { describe, expect, it } from "vitest";
import { downsampleTrack, flattenTrack, formatDistance, sanitizeTrack, trackDistanceMeters, type TrackPoint, unflattenTrack } from "./track";

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

describe("flattenTrack / unflattenTrack", () => {
  const track: TrackPoint[] = [[37.6, 127.0], [37.61, 127.01], [37.62, 127.02]];

  it("round-trips a track", () => {
    expect(unflattenTrack(flattenTrack(track))).toEqual(track);
  });

  it("pairs by position: even latitude, odd longitude", () => {
    expect(flattenTrack(track)).toEqual([37.6, 127.0, 37.61, 127.01, 37.62, 127.02]);
  });

  it("keeps a repeated point as two separate pairs", () => {
    // The shape that broke the album button: a leg is path.map(id =>
    // graph.nodes[id]) and graph.nodes holds one object per node, so a course
    // that comes back on itself holds the same array twice. Flattened, there is
    // no object left to be the same.
    const junction: TrackPoint = [37.6, 127.0];
    const doubled = [junction, [37.61, 127.01] as TrackPoint, junction];
    const flat = flattenTrack(doubled);
    expect(flat).toHaveLength(6);
    expect(unflattenTrack(flat)).toEqual(doubled);
  });

  it("refuses an odd number of values", () => {
    expect(unflattenTrack([37.6, 127.0, 37.61])).toBeNull();
  });

  it("refuses anything that is not a run of numbers", () => {
    expect(unflattenTrack([37.6, "127.0"])).toBeNull();
    expect(unflattenTrack(null)).toBeNull();
    expect(unflattenTrack([[37.6, 127.0]])).toBeNull();
  });

  it("gives an empty track an empty run, and back", () => {
    expect(flattenTrack([])).toEqual([]);
    expect(unflattenTrack([])).toEqual([]);
  });
});
