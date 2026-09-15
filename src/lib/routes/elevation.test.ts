import { describe, expect, it } from "vitest";
import {
  buildProfile, cellCentre, cellKey, sampleAlongTrack, sectionsOf, steepestRun, steepnessOf, waypointsAlong,
} from "./elevation";
import type { TrackPoint } from "../gps/track";

/** A line running due north, one point every ~11m. */
const north = (count: number): TrackPoint[] =>
  Array.from({ length: count }, (_, i) => [37.6 + i * 0.0001, 127.0] as TrackPoint);

describe("cellKey", () => {
  it("gives two points in the same 90m cell the same key", () => {
    // 0.0003 degrees of latitude is about 33m.
    expect(cellKey(37.6, 127.0)).toBe(cellKey(37.6003, 127.0));
  });

  it("separates points a cell apart", () => {
    expect(cellKey(37.6, 127.0)).not.toBe(cellKey(37.6009, 127.0));
  });

  it("round-trips to a point inside its own cell", () => {
    const centre = cellCentre(cellKey(37.6004, 126.9812));
    expect(cellKey(centre.lat, centre.lng)).toBe(cellKey(37.6004, 126.9812));
  });
});

describe("sampleAlongTrack", () => {
  it("thins to roughly the spacing asked for, keeping both ends", () => {
    const line = north(100); // ~1.1km
    const sampled = sampleAlongTrack(line, 90);
    expect(sampled[0].point).toBe(line[0]);
    expect(sampled[sampled.length - 1].point).toBe(line[line.length - 1]);
    expect(sampled.length).toBeGreaterThan(8);
    expect(sampled.length).toBeLessThan(16);
  });

  it("carries how far along each sample is", () => {
    const sampled = sampleAlongTrack(north(50), 90);
    expect(sampled[0].along).toBe(0);
    expect(sampled[sampled.length - 1].along).toBeGreaterThan(500);
  });
});

describe("buildProfile", () => {
  it("counts the climbing, not just the distance", () => {
    const line = north(20);
    const sampled = sampleAlongTrack(line, 90);
    // Rising steadily: 100m at the start, 100m more at every sample.
    const heights = sampled.map((_, i) => 100 + i * 100);
    const profile = buildProfile(line, sampled, heights)!;
    expect(profile.ascentM).toBeGreaterThan(0);
    expect(profile.descentM).toBe(0);
    expect(profile.lowM).toBe(100);
    expect(profile.highM).toBe(heights[heights.length - 1]);
    // The hill makes the walk longer than the map says.
    expect(profile.surfaceM).toBeGreaterThan(profile.distanceM);
  });

  it("is flat where the ground is", () => {
    const line = north(20);
    const sampled = sampleAlongTrack(line, 90);
    const profile = buildProfile(line, sampled, sampled.map(() => 250))!;
    expect(profile.ascentM).toBe(0);
    expect(profile.descentM).toBe(0);
    expect(profile.surfaceM).toBeCloseTo(profile.distanceM, 5);
  });

  it("refuses a line it cannot profile", () => {
    expect(buildProfile([[37.6, 127]], [], [])).toBeNull();
  });
});

describe("steepnessOf", () => {
  it("reads a gradient the way a walker would", () => {
    expect(steepnessOf(0.02)).toBe("flat");
    expect(steepnessOf(0.1)).toBe("gentle");
    expect(steepnessOf(0.18)).toBe("moderate");
    expect(steepnessOf(0.25)).toBe("steep");
  });

  it("grades a descent by the same numbers", () => {
    expect(steepnessOf(-0.25)).toBe("steep");
  });
});

describe("steepestRun", () => {
  it("ignores a single sample, however steep", () => {
    // 90m steps, flat but for one 40m spike - the shape of model noise.
    const points = Array.from({ length: 10 }, (_, i) => ({
      along: i * 90, elevation: i === 4 ? 240 : 200,
    }));
    // Over any 200m window the spike averages out well under 20%.
    expect(steepestRun(points)!).toBeLessThan(0.2);
  });

  it("finds a real sustained climb", () => {
    const points = Array.from({ length: 10 }, (_, i) => ({ along: i * 90, elevation: 200 + i * 27 }));
    expect(steepestRun(points)!).toBeCloseTo(0.3, 1);
  });

  it("has no answer for a stretch shorter than the window", () => {
    expect(steepestRun([{ along: 0, elevation: 100 }, { along: 90, elevation: 140 }])).toBeNull();
  });
});

describe("sectionsOf", () => {
  it("names each stretch and says which way it goes", () => {
    const line = north(40);
    const sampled = sampleAlongTrack(line, 90);
    // Up for the first half, back down for the second.
    const middle = Math.floor(sampled.length / 2);
    const heights = sampled.map((_, i) => (i <= middle ? 100 + i * 50 : 100 + (sampled.length - i) * 50));
    const profile = buildProfile(line, sampled, heights)!;
    const along = waypointsAlong(line, [line[0], line[middle * 9], line[line.length - 1]]
      .map(([lat, lng]) => ({ lat, lng })));
    const sections = sectionsOf(profile, ["들머리", "정상", "날머리"], along);

    expect(sections).toHaveLength(2);
    expect(sections[0]).toMatchObject({ from: "들머리", to: "정상", downhill: false });
    expect(sections[1].downhill).toBe(true);
    expect(sections[0].ascentM).toBeGreaterThan(0);
  });
});
