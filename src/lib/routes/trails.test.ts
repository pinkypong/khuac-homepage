import { describe, expect, it } from "vitest";
import {
  describeSegments,
  parseOverpassWays,
  segmentLengthMeters,
  stitchSegments,
  type TrailSegment,
} from "./trails";

function segment(id: number, points: [number, number][], name: string | null = null): TrailSegment {
  return { id, name, kind: "path", points };
}

describe("parseOverpassWays", () => {
  it("keeps ways that carry geometry and drops the rest", () => {
    const parsed = parseOverpassWays({
      elements: [
        {
          type: "way",
          id: 1,
          tags: { highway: "path", name: "백운대탐방로" },
          geometry: [
            { lat: 37.6588, lon: 126.9779 },
            { lat: 37.6591, lon: 126.9782 },
          ],
        },
        // A node is not a trail.
        { type: "node", id: 2, geometry: [{ lat: 37.6, lon: 127 }] },
        // A way with a single point cannot be drawn.
        { type: "way", id: 3, geometry: [{ lat: 37.6, lon: 127 }] },
      ],
    });

    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({ id: 1, name: "백운대탐방로", kind: "path" });
    expect(parsed[0].points[0]).toEqual([37.6588, 126.9779]);
  });

  it("survives a response that is not shaped like Overpass output", () => {
    expect(parseOverpassWays(null)).toEqual([]);
    expect(parseOverpassWays({})).toEqual([]);
    expect(parseOverpassWays({ elements: "nope" })).toEqual([]);
  });
});

describe("stitchSegments", () => {
  it("joins segments end to end without repeating the junction", () => {
    const track = stitchSegments([
      segment(1, [
        [37.0, 127.0],
        [37.001, 127.0],
      ]),
      segment(2, [
        [37.001, 127.0],
        [37.002, 127.0],
      ]),
    ]);

    expect(track).toEqual([
      [37.0, 127.0],
      [37.001, 127.0],
      [37.002, 127.0],
    ]);
  });

  it("flips a segment stored in the opposite direction", () => {
    // OSM records a way in whichever direction it was drawn, which says nothing
    // about which way it gets walked.
    const track = stitchSegments([
      segment(1, [
        [37.0, 127.0],
        [37.001, 127.0],
      ]),
      segment(2, [
        [37.002, 127.0],
        [37.001, 127.0],
      ]),
    ]);

    expect(track[track.length - 1]).toEqual([37.002, 127.0]);
  });

  it("drops a segment that does not connect rather than jumping to it", () => {
    const track = stitchSegments([
      segment(1, [
        [37.0, 127.0],
        [37.001, 127.0],
      ]),
      // Roughly 11km away: picking this one was a mistake, and drawing a line
      // to it would put a straight edge across the map.
      segment(2, [
        [37.1, 127.0],
        [37.101, 127.0],
      ]),
    ]);

    expect(track).toEqual([
      [37.0, 127.0],
      [37.001, 127.0],
    ]);
  });

  it("returns nothing when given nothing usable", () => {
    expect(stitchSegments([])).toEqual([]);
    expect(stitchSegments([segment(1, [[37.0, 127.0]])])).toEqual([]);
  });
});

describe("segmentLengthMeters", () => {
  it("measures along the points, not end to end", () => {
    // A right-angle detour is longer than the straight line closing it.
    const bent = segmentLengthMeters(
      segment(1, [
        [37.0, 127.0],
        [37.0, 127.002],
        [37.002, 127.002],
      ]),
    );
    const direct = segmentLengthMeters(
      segment(2, [
        [37.0, 127.0],
        [37.002, 127.002],
      ]),
    );

    expect(bent).toBeGreaterThan(direct);
  });
});

describe("describeSegments", () => {
  it("hands over names and endpoints, not every coordinate", () => {
    const described = describeSegments([
      segment(
        1,
        [
          [37.0, 127.0],
          [37.001, 127.0],
          [37.002, 127.0],
        ],
        "노적봉길",
      ),
    ]);

    expect(described[0]).toMatchObject({ id: 1, name: "노적봉길", kind: "path" });
    expect(described[0].start).toEqual([37.0, 127.0]);
    expect(described[0].end).toEqual([37.002, 127.0]);
    expect(described[0].lengthM).toBeGreaterThan(0);
    expect(described[0]).not.toHaveProperty("points");
  });
});
