import { describe, expect, it } from "vitest";
import type { TrackPoint } from "@/lib/gps/track";
import { hazardsNearRoute, isDanger, mergeHazards, type Hazard, type HazardRow } from "./hazards";

// A line running due north for about 1.1 km along lng 127.
const line: TrackPoint[] = [[37.5, 127], [37.51, 127]];
const east = (metres: number) => 127 + metres / (111_320 * Math.cos((37.505 * Math.PI) / 180));

describe("hazardsNearRoute", () => {
  it("keeps a record beside the line and drops one far from it", () => {
    const rows: HazardRow[] = [
      [37.505, east(10), "rope", "가까움"],
      [37.505, east(80), "rope", "멈"],
    ];
    expect(hazardsNearRoute(line, rows).map((h) => h.label)).toEqual(["가까움"]);
  });

  it("measures to the segment, not to the vertices", () => {
    // Mid-way along a 1.1 km segment: over 500 m from either end.
    const rows: HazardRow[] = [[37.505, east(5), "rail", "중간"]];
    expect(hazardsNearRoute(line, rows, 30)).toHaveLength(1);
  });

  it("does not extend the line past its ends", () => {
    const rows: HazardRow[] = [[37.52, 127, "washout", "끝 너머"]];
    expect(hazardsNearRoute(line, rows)).toEqual([]);
  });

  it("honours the distance it is given", () => {
    const rows: HazardRow[] = [[37.505, east(45), "flood", "45m"]];
    expect(hazardsNearRoute(line, rows, 30)).toEqual([]);
    expect(hazardsNearRoute(line, rows, 60)).toHaveLength(1);
  });

  it("returns nothing for an empty track", () => {
    expect(hazardsNearRoute([], [[37.5, 127, "rope", "x"]])).toEqual([]);
  });
});

describe("isDanger", () => {
  it("separates places that can go wrong from fixed aids", () => {
    expect(isDanger("isolation")).toBe(true);
    expect(isDanger("washout")).toBe(true);
    expect(isDanger("flood")).toBe(true);
    expect(isDanger("rope")).toBe(false);
    expect(isDanger("rail")).toBe(false);
  });
});

describe("mergeHazards", () => {
  const at = (northMetres: number, kind: Hazard["kind"] = "rope"): Hazard => ({
    lat: 37.5 + northMetres / 111_320,
    lng: 127,
    kind,
    label: `${kind}@${northMetres}`,
  });

  it("folds a chain of nearby records into one pin, even when the ends are far apart", () => {
    // 50 m steps: each neighbour is inside 60 m, the ends are 200 m apart.
    const spots = mergeHazards([at(0), at(50), at(100), at(150), at(200)]);
    expect(spots).toHaveLength(1);
    expect(spots[0].count).toBe(5);
    expect(spots[0].label).toBe("rope@100");
  });

  it("keeps runs that are further apart than the gap as separate pins", () => {
    const spots = mergeHazards([at(0), at(30), at(300), at(320)]);
    expect(spots.map((s) => s.count)).toEqual([2, 2]);
  });

  it("does not merge rope with rail", () => {
    const spots = mergeHazards([at(0, "rope"), at(10, "rail")]);
    expect(spots.map((s) => s.kind).sort()).toEqual(["rail", "rope"]);
  });

  it("never merges dangers", () => {
    const spots = mergeHazards([at(0, "washout"), at(5, "washout"), at(10, "flood")]);
    expect(spots).toHaveLength(3);
    expect(spots.every((s) => s.count === 1)).toBe(true);
  });

  it("honours the gap it is given and handles an empty list", () => {
    expect(mergeHazards([at(0), at(100)], 60)).toHaveLength(2);
    expect(mergeHazards([at(0), at(100)], 120)).toHaveLength(1);
    expect(mergeHazards([])).toEqual([]);
  });
});
