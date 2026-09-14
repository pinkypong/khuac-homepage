import { describe, expect, it } from "vitest";
import { groupSegmentsByTile, mergeTileSegments, tileKey, tilesForBounds } from "./tiles";
import type { TrailSegment } from "./trails";
import type { TrackPoint } from "../gps/track";

const seg = (id: number, points: TrackPoint[]): TrailSegment => ({
  id,
  name: null,
  kind: "path",
  points,
});

describe("tileKey", () => {
  it("gives every point inside one tile the same key", () => {
    expect(tileKey(37.6601, 126.9601)).toBe(tileKey(37.6799, 126.9799));
  });

  it("separates neighbouring tiles", () => {
    expect(tileKey(37.66, 126.96)).not.toBe(tileKey(37.68, 126.96));
    expect(tileKey(37.66, 126.96)).not.toBe(tileKey(37.66, 126.98));
  });
});

describe("tilesForBounds", () => {
  it("covers a box that sits inside a single tile", () => {
    expect(tilesForBounds({ south: 37.661, west: 126.961, north: 37.669, east: 126.969 })).toEqual([
      tileKey(37.665, 126.965),
    ]);
  });

  it("covers every tile a wider box touches", () => {
    const keys = tilesForBounds({ south: 37.655, west: 126.955, north: 37.675, east: 126.975 });
    // Spans two tiles each way, so four in total.
    expect(new Set(keys).size).toBe(4);
  });

  it("tolerates a box given with its corners the wrong way round", () => {
    const a = tilesForBounds({ south: 37.675, west: 126.975, north: 37.655, east: 126.955 });
    const b = tilesForBounds({ south: 37.655, west: 126.955, north: 37.675, east: 126.975 });
    expect(new Set(a)).toEqual(new Set(b));
  });
});

describe("groupSegmentsByTile", () => {
  it("files a way under every tile it passes through", () => {
    // Crosses from one tile into the next.
    const crossing = seg(1, [[37.665, 126.965], [37.685, 126.965]]);
    const byTile = groupSegmentsByTile([crossing]);
    expect(byTile.size).toBe(2);
    for (const segments of byTile.values()) expect(segments[0].id).toBe(1);
  });

  it("files a way that stays put under one tile only", () => {
    expect(groupSegmentsByTile([seg(2, [[37.661, 126.961], [37.668, 126.968]])]).size).toBe(1);
  });
});

describe("mergeTileSegments", () => {
  it("drops the copies neighbouring tiles each kept", () => {
    const shared = seg(7, [[37.665, 126.965], [37.685, 126.965]]);
    const other = seg(8, [[37.661, 126.961], [37.662, 126.962]]);
    expect(mergeTileSegments([[shared, other], [shared]]).map((s) => s.id).sort()).toEqual([7, 8]);
  });
});
