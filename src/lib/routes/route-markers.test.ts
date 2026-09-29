import { describe, expect, it } from "vitest";
import type { TrackPoint } from "@/lib/gps/track";
import type { CourseProfile } from "./elevation";
import { medianElevation, routeEnds, summitOf } from "./route-markers";

const profileOf = (points: { along: number; elevation: number }[]): CourseProfile => ({
  points,
  distanceM: points[points.length - 1].along,
  surfaceM: 0,
  ascentM: 0,
  descentM: 0,
  lowM: Math.min(...points.map((p) => p.elevation)),
  highM: Math.max(...points.map((p) => p.elevation)),
});

// About 1.11 km due north along lng 127.
const line: TrackPoint[] = [[37.5, 127], [37.51, 127]];

describe("routeEnds", () => {
  it("gives both ends of an out-and-back to a different place", () => {
    expect(routeEnds(line)).toEqual({ start: [37.5, 127], end: [37.51, 127] });
  });

  it("drops the end of a loop that closes on its start", () => {
    const loop: TrackPoint[] = [[37.5, 127], [37.51, 127], [37.5002, 127]];
    expect(routeEnds(loop)?.end).toBeNull();
  });

  it("needs at least two points", () => {
    expect(routeEnds([[37.5, 127]])).toBeNull();
  });
});

describe("summitOf", () => {
  it("places the highest sample by interpolating along the line", () => {
    const summit = summitOf(line, profileOf([
      { along: 0, elevation: 100 },
      { along: 555.6, elevation: 800 },
      { along: 1111.9, elevation: 300 },
    ]));
    expect(summit?.elevation).toBe(800);
    expect(summit?.lat).toBeCloseTo(37.505, 3);
    expect(summit?.lng).toBe(127);
  });

  it("is null without a profile or a usable track", () => {
    expect(summitOf(line, null)).toBeNull();
    expect(summitOf([[37.5, 127]], profileOf([{ along: 0, elevation: 1 }, { along: 1, elevation: 2 }]))).toBeNull();
  });
});

describe("medianElevation", () => {
  it("takes the middle height, not the mean pulled by one peak", () => {
    const p = profileOf([
      { along: 0, elevation: 100 },
      { along: 1, elevation: 120 },
      { along: 2, elevation: 900 },
    ]);
    expect(medianElevation(p)).toBe(120);
  });

  it("averages the two middle heights of an even count and is null when empty", () => {
    expect(medianElevation(profileOf([{ along: 0, elevation: 100 }, { along: 1, elevation: 200 }]))).toBe(150);
    expect(medianElevation(null)).toBeNull();
  });
});
