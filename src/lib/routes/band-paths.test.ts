import { describe, expect, it } from "vitest";
import type { TrackPoint } from "@/lib/gps/track";
import { bandPathsFor, pathsByBand } from "./band-paths";
import type { CourseProfile, GradientBand } from "./elevation";

// About 100m per vertex: a straight line north, 1km long.
const line: TrackPoint[] = Array.from({ length: 11 }, (_, i) => [37 + i * 0.0009, 127]);
const total = 0.009 * 111195;

const band = (fromAlong: number, toAlong: number, steepness: GradientBand["steepness"]): GradientBand => ({
  fromAlong, toAlong, gradient: 0, steepness,
});

describe("pathsByBand", () => {
  it("cuts at the exact boundary and shares it between neighbours", () => {
    const paths = pathsByBand(line, [band(0, 300, "gentle"), band(300, total, "steep")]);
    expect(paths).toHaveLength(2);
    expect(paths[0].tier).toBe("easy");
    expect(paths[1].tier).toBe("hard");
    expect(paths[0].path[0]).toEqual(line[0]);
    const seam = paths[0].path[paths[0].path.length - 1];
    expect(paths[1].path[0]).toEqual(seam);
    // 300m is between vertices, so the seam is interpolated rather than snapped.
    expect(seam[0]).toBeCloseTo(37 + 300 / 111195, 5);
    expect(paths[1].path[paths[1].path.length - 1]).toEqual(line[10]);
  });

  it("draws flat and gentle ground as one easy line", () => {
    const paths = pathsByBand(line, [band(0, 400, "flat"), band(400, 700, "gentle"), band(700, total, "moderate")]);
    expect(paths.map((p) => p.tier)).toEqual(["easy", "moderate"]);
    expect(paths[0].path[0]).toEqual(line[0]);
    expect(paths[0].path[paths[0].path.length - 1]).toEqual(paths[1].path[0]);
  });

  it("stretches the first and last band to the ends of the line", () => {
    const paths = pathsByBand(line, [band(100, 400, "moderate"), band(400, 500, "severe")]);
    expect(paths[0].path[0]).toEqual(line[0]);
    expect(paths[1].path[paths[1].path.length - 1]).toEqual(line[10]);
  });

  it("returns nothing for a line or bands that cannot be drawn", () => {
    expect(pathsByBand([line[0]], [band(0, 10, "flat")])).toEqual([]);
    expect(pathsByBand(line, [])).toEqual([]);
  });
});

describe("bandPathsFor", () => {
  const profile: CourseProfile = {
    points: [{ along: 0, elevation: 100 }, { along: total / 2, elevation: 100 }, { along: total, elevation: 400 }],
    distanceM: total, surfaceM: total, ascentM: 300, descentM: 0, lowM: 100, highM: 400,
  };

  it("colours a line by the profile measured on it", () => {
    const paths = bandPathsFor(line, profile);
    expect(paths).not.toBeNull();
    expect(paths!.length).toBeGreaterThan(0);
  });

  it("is null without a profile", () => {
    expect(bandPathsFor(line, null)).toBeNull();
  });
});
