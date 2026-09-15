import { describe, expect, it } from "vitest";
import { dropOutlierWaypoints, placeHints, snapRouteToTrails } from "./snap";
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

  it("does not invent a straight route when there is no trail", () => {
    const legs = snapRouteToTrails(
      [
        { lat: 37.6, lng: 127.0 },
        { lat: 37.61, lng: 127.0 },
      ],
      [],
    );
    expect(legs).toEqual([{ points: [], onTrail: false }]);
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

describe("mapped approaches and topology", () => {
  it("routes from the middle of a sparse road without jumping to its distant endpoints", () => {
    const road = seg(5, [[37.60, 127], [37.63, 127]]);
    const leg = snapRouteToTrails([{ lat: 37.610, lng: 127 }, { lat: 37.615, lng: 127 }], [road])[0];
    expect(leg.onTrail).toBe(true);
    expect(leg.points[0][0]).toBeCloseTo(37.610, 6);
    expect(leg.points.at(-1)![0]).toBeCloseTo(37.615, 6);
    expect(leg.points.every(([lat]) => lat >= 37.610 && lat <= 37.615)).toBe(true);
  });

  it("does not append an invented off-trail approach to a landmark pin", () => {
    const road = seg(5, [[37.60, 127], [37.63, 127]]);
    const leg = snapRouteToTrails([{ lat: 37.610, lng: 127.001 }, { lat: 37.615, lng: 127.001 }], [road])[0];
    expect(leg.onTrail).toBe(true);
    expect(leg.points.every(([, lng]) => lng === 127)).toBe(true);
  });

  it("does not bridge separate parallel trails ten metres apart", () => {
    const paths = [seg(1, [[37.60, 127], [37.603, 127]]), seg(2, [[37.60, 127.00012], [37.603, 127.00012]])];
    expect(snapRouteToTrails([{ lat: 37.60, lng: 127 }, { lat: 37.603, lng: 127.00012 }], paths)[0].onTrail).toBe(false);
  });

  it("keeps a bend even when it passes close to another part of a separate way", () => {
    const paths = [seg(1, [[37.60, 127], [37.602, 127], [37.602, 127.001]]),
      seg(2, [[37.602, 127.001], [37.6001, 127.0001], [37.603, 127.003]])];
    const leg = snapRouteToTrails([{ lat: 37.60, lng: 127 }, { lat: 37.603, lng: 127.003 }], paths)[0];
    expect(leg.onTrail).toBe(true);
    expect(leg.points).toContainEqual([37.602, 127.001]);
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

describe("placeHints", () => {
  /** A leg running due north, one point every ~11m. */
  const northward = (count: number): TrackPoint[] =>
    Array.from({ length: count }, (_, i) => [37.6 + i * 0.0001, 127.0] as TrackPoint);

  const course = () => ({
    legs: [{ points: northward(11), onTrail: true }],
    points: [
      { index: 0, lat: 37.6, lng: 127.0, derived: false },
      { index: 2, lat: 37.601, lng: 127.0, derived: false },
    ],
  });

  it("puts the turning on the line, where the course passes the place", () => {
    // Beside the middle of the leg, about 90m east - a temple up a short spur.
    const result = placeHints(course(), [{ index: 1, lat: 37.6005, lng: 127.001 }]);
    expect(result.points.map((p) => p.index)).toEqual([0, 1, 2]);
    expect(result.points[1].lat).toBeCloseTo(37.6005, 6);
    expect(result.points[1].lng).toBeCloseTo(127.0, 6);
    expect(result.points[1].derived).toBe(true);
    // Split rather than appended: still one more waypoint than there are legs.
    expect(result.legs).toHaveLength(result.points.length - 1);
  });

  it("leaves the line itself alone", () => {
    const before = course();
    const after = placeHints(before, [{ index: 1, lat: 37.6005, lng: 127.001 }]);
    expect(after.legs.flatMap((leg) => leg.points)).toHaveLength(before.legs[0].points.length + 1);
  });

  it("refuses a place the course does not pass", () => {
    // Two kilometres east is not somewhere this course passes the entrance to.
    const result = placeHints(course(), [{ index: 1, lat: 37.6005, lng: 127.023 }]);
    expect(result.points.map((p) => p.index)).toEqual([0, 2]);
  });

  it("does not split at a leg's own ends, where a waypoint already stands", () => {
    const result = placeHints(course(), [{ index: 1, lat: 37.6, lng: 127.0002 }]);
    expect(result.points.map((p) => p.index)).toEqual([0, 2]);
  });
});
