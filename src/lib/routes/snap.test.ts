import { describe, expect, it } from "vitest";
import { dropOutlierWaypoints, snapRouteToTrails } from "./snap";
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

describe("dropOutlierWaypoints", () => {
  // 숨은벽: 밤골 → 해골바위 → 백운대, with 해골바위 mislooked-up far to the east.
  const course = [
    { lat: 37.669, lng: 126.956 },
    { lat: 37.660, lng: 127.060 },
    { lat: 37.655, lng: 126.972 },
  ];

  it("drops a waypoint that landed on the far side of the mountain", () => {
    const kept = dropOutlierWaypoints(course);
    expect(kept).toHaveLength(2);
    expect(kept.map((p) => p.lng)).toEqual([126.956, 126.972]);
  });

  it("keeps a course whose points are simply spread out evenly", () => {
    const traverse = [
      { lat: 37.60, lng: 127.00 },
      { lat: 37.62, lng: 127.02 },
      { lat: 37.64, lng: 127.04 },
      { lat: 37.66, lng: 127.06 },
    ];
    expect(dropOutlierWaypoints(traverse)).toHaveLength(4);
  });

  it("leaves two points alone - there is nothing to compare against", () => {
    const pair = [{ lat: 37.6, lng: 127.0 }, { lat: 38.2, lng: 127.9 }];
    expect(dropOutlierWaypoints(pair)).toHaveLength(2);
  });

  it("drops a misplaced endpoint too", () => {
    const withBadEnd = [
      { lat: 37.650, lng: 126.960 },
      { lat: 37.655, lng: 126.968 },
      { lat: 37.660, lng: 126.975 },
      { lat: 37.900, lng: 127.400 },
    ];
    expect(dropOutlierWaypoints(withBadEnd)).toHaveLength(3);
  });
});
