import { describe, expect, it } from "vitest";
import {
  buildProfile, cellCentre, cellKey, gradientBands, sampleAlongTrack, sectionsOf, stackLabels, steepestRun, steepnessOf, waypointsAlong,
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

describe("gradientBands", () => {
  const profileOf = (heights: number[], spacing = 90) => ({
    points: heights.map((elevation, i) => ({ along: i * spacing, elevation })),
    distanceM: (heights.length - 1) * spacing,
    surfaceM: 0, ascentM: 0, descentM: 0,
    lowM: Math.min(...heights), highM: Math.max(...heights),
  });

  it("gives one band to ground that keeps the same shape", () => {
    // A steady 22% climb over 1.8km: one band, not twenty.
    const bands = gradientBands(profileOf(Array.from({ length: 21 }, (_, i) => 100 + i * 20)));
    expect(bands).toHaveLength(1);
    expect(bands[0].steepness).toBe("steep");
  });

  it("splits where the ground changes", () => {
    // Flat for 900m, then a wall.
    const heights = [...Array.from({ length: 11 }, () => 100), ...Array.from({ length: 11 }, (_, i) => 100 + i * 40)];
    const bands = gradientBands(profileOf(heights));
    expect(bands.length).toBeGreaterThan(1);
    expect(bands[0].steepness).toBe("flat");
    expect(bands[bands.length - 1].steepness).toBe("severe");
  });

  it("grades a descent by how steep it is, not by which way it goes", () => {
    const bands = gradientBands(profileOf(Array.from({ length: 21 }, (_, i) => 800 - i * 35)));
    expect(bands[0].steepness).toBe("severe");
    expect(bands[0].gradient).toBeLessThan(0);
  });

  it("covers the whole course, end to end, without gaps", () => {
    const profile = profileOf([100, 120, 300, 320, 330, 500, 505, 510, 700, 701, 702]);
    const bands = gradientBands(profile);
    expect(bands[0].fromAlong).toBe(0);
    expect(bands[bands.length - 1].toAlong).toBe(profile.distanceM);
    for (let i = 1; i < bands.length; i++) expect(bands[i].fromAlong).toBe(bands[i - 1].toAlong);
  });
});

describe("stackLabels", () => {
  it("leaves well-spaced names on one row", () => {
    expect(stackLabels([0, 0.25, 0.5, 0.75, 1])).toEqual([0, 0, 0, 0, 0]);
  });

  it("drops the crowded one to the next row instead of overlapping it", () => {
    // 백운대 and 백운봉암문: 340m apart on 5.8km is 0.06 of the width.
    const rows = stackLabels([0, 0.42, 0.48, 1]);
    expect(rows[1]).not.toBe(rows[2]);
    expect(rows.every((row) => row !== null)).toBe(true);
  });

  it("keeps going down the rows as names pile up", () => {
    const rows = stackLabels([0.5, 0.52, 0.54]);
    expect(new Set(rows)).toEqual(new Set([0, 1, 2]));
  });

  it("drops a name it cannot place rather than hiding it under another", () => {
    const rows = stackLabels([0.5, 0.51, 0.52, 0.53]);
    expect(rows.filter((row) => row === null)).toHaveLength(1);
  });

  it("assigns rows by position, not by order in the list", () => {
    // Given out of order, the leftmost still gets the top row.
    const rows = stackLabels([0.9, 0.1, 0.5]);
    expect(rows).toEqual([0, 0, 0]);
  });
});

describe("gradientBands: short stretches", () => {
  const profileOf = (heights: number[], spacing = 90) => ({
    points: heights.map((elevation, i) => ({ along: i * spacing, elevation })),
    distanceM: (heights.length - 1) * spacing,
    surfaceM: 0, ascentM: 0, descentM: 0,
    lowM: Math.min(...heights), highM: Math.max(...heights),
  });

  it("folds a brief breather into the climb around it, and rejoins the two halves", () => {
    // Up, a level stretch, up again. Told that nothing under 1.2km is worth a
    // colour of its own, the breather goes into a neighbour - and the two
    // climbs, now touching and the same grade, become one piece of walking.
    const heights = [
      ...Array.from({ length: 10 }, (_, i) => 100 + i * 25),
      ...Array.from({ length: 7 }, () => 325),
      ...Array.from({ length: 10 }, (_, i) => 325 + i * 25),
    ];
    expect(gradientBands(profileOf(heights), 250, 400)).toHaveLength(3);
    expect(gradientBands(profileOf(heights), 250, 1200)).toHaveLength(1);
  });

  it("still splits where a long stretch really changes", () => {
    const heights = [
      ...Array.from({ length: 14 }, () => 100),
      ...Array.from({ length: 14 }, (_, i) => 100 + i * 35),
    ];
    const bands = gradientBands(profileOf(heights));
    expect(bands.length).toBeGreaterThan(1);
    expect(bands[0].steepness).toBe("flat");
  });

  it("covers the course end to end however much it merged", () => {
    const profile = profileOf([100, 300, 305, 310, 600, 602, 900, 901, 902, 903, 1200]);
    const bands = gradientBands(profile);
    expect(bands[0].fromAlong).toBe(0);
    expect(bands[bands.length - 1].toAlong).toBe(profile.distanceM);
    for (let i = 1; i < bands.length; i++) expect(bands[i].fromAlong).toBe(bands[i - 1].toAlong);
  });

  it("leaves a course too short to split as one band", () => {
    expect(gradientBands(profileOf([100, 150, 200]))).toHaveLength(1);
  });
});
