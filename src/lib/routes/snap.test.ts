import { describe, expect, it } from "vitest";
import { snapRouteToTrails } from "./snap";
import type { TrailSegment } from "./trails";
import type { TrackPoint } from "../gps/track";

/** ~11m per 0.0001 degree of latitude, which keeps these fixtures readable. */
const seg = (id: number, points: TrackPoint[], name: string | null = null): TrailSegment => ({
  id,
  name,
  kind: "path",
  points,
});

// A trail that goes north but bulges east on the way - the detour a straight
// line between the ends would cut straight through.
const bulging = seg(1, [
  [37.6000, 127.0000],
  [37.6010, 127.0020],
  [37.6020, 127.0020],
  [37.6030, 127.0000],
]);

describe("snapRouteToTrails", () => {
  it("follows the trail rather than the straight line between waypoints", () => {
    const legs = snapRouteToTrails(
      [
        { lat: 37.6000, lng: 127.0 },
        { lat: 37.603, lng: 127.0 },
      ],
      [bulging],
    );
    expect(legs).toHaveLength(1);
    expect(legs[0].onTrail).toBe(true);
    // The bulge is in the line, so it is more than the two endpoints.
    expect(legs[0].points.length).toBeGreaterThan(3);
    expect(legs[0].points.some(([, lng]) => lng > 127.001)).toBe(true);
  });

  it("keeps the named waypoints at each end of the leg", () => {
    const legs = snapRouteToTrails(
      [
        { lat: 37.6000, lng: 127.0 },
        { lat: 37.603, lng: 127.0 },
      ],
      [bulging],
    );
    expect(legs[0].points[0]).toEqual([37.6, 127.0]);
    expect(legs[0].points.at(-1)).toEqual([37.603, 127.0]);
  });

  it("falls back to a straight leg when there is no trail at all", () => {
    const legs = snapRouteToTrails(
      [
        { lat: 37.6, lng: 127.0 },
        { lat: 37.61, lng: 127.0 },
      ],
      [],
    );
    expect(legs).toEqual([{ points: [[37.6, 127.0], [37.61, 127.0]], onTrail: false }]);
  });

  it("does not snap a waypoint that is nowhere near a path", () => {
    // Half a degree away is ~55km; nothing should reach it.
    const legs = snapRouteToTrails(
      [
        { lat: 37.6, lng: 127.0 },
        { lat: 38.1, lng: 127.0 },
      ],
      [bulging],
    );
    expect(legs[0].onTrail).toBe(false);
  });

  it("joins two ways that meet without sharing a node", () => {
    // The second way starts ~10m from where the first ends - close enough to
    // be the same junction, which is how downsampled OSM data usually arrives.
    const lower = seg(1, [[37.6000, 127.0], [37.6010, 127.0]]);
    const upper = seg(2, [[37.60101, 127.0], [37.6020, 127.0]]);
    const legs = snapRouteToTrails(
      [
        { lat: 37.6, lng: 127.0 },
        { lat: 37.602, lng: 127.0 },
      ],
      [lower, upper],
    );
    expect(legs[0].onTrail).toBe(true);
  });

  it("refuses a path that wanders far further than the straight line", () => {
    // The only way between the ends loops a long way east and back.
    const detour = seg(1, [
      [37.6000, 127.0000],
      [37.6000, 127.0300],
      [37.6010, 127.0300],
      [37.6010, 127.0000],
    ]);
    const legs = snapRouteToTrails(
      [
        { lat: 37.6, lng: 127.0 },
        { lat: 37.601, lng: 127.0 },
      ],
      [detour],
    );
    expect(legs[0].onTrail).toBe(false);
  });

  it("produces one leg per consecutive pair of waypoints", () => {
    const legs = snapRouteToTrails(
      [
        { lat: 37.6, lng: 127.0 },
        { lat: 37.602, lng: 127.002 },
        { lat: 37.603, lng: 127.0 },
      ],
      [bulging],
    );
    expect(legs).toHaveLength(2);
  });
});
