import type { TrailBounds } from "./overpass";
import type { TrailSegment } from "./trails";

/**
 * The grid the club's trail copy is stored on.
 *
 * Courses on the same mountain overlap almost entirely, so geometry is kept
 * per tile rather than per course: asking about 숨은벽 fills the tiles that
 * asking about 백운대 then reads for free. 0.02° is roughly 2.2km north-south,
 * small enough that one course does not drag in a neighbouring range and large
 * enough that a course needs only a handful of tiles.
 */
export const TILE_DEG = 0.02;

/**
 * Bumped when a change makes already-stored tiles wrong rather than merely
 * old. v2: tiles written before this held only ways over 40m, which left out
 * the short connectors that join trails at a junction - a graph built from
 * them could not cross 북한산. Old rows are simply never read again.
 */
const TILE_VERSION = "v2";

/** Tiles are keyed by their south-west corner, which is what makes the key
    derivable from any coordinate inside them. */
export function tileKey(lat: number, lng: number): string {
  const south = Math.floor(lat / TILE_DEG) * TILE_DEG;
  const west = Math.floor(lng / TILE_DEG) * TILE_DEG;
  return `${TILE_VERSION}:${south.toFixed(2)},${west.toFixed(2)}`;
}

/** Every tile a bounding box touches, including the partly covered edges. */
export function tilesForBounds(bounds: TrailBounds): string[] {
  const keys: string[] = [];
  const south = Math.floor(Math.min(bounds.south, bounds.north) / TILE_DEG) * TILE_DEG;
  const north = Math.max(bounds.south, bounds.north);
  const west = Math.floor(Math.min(bounds.west, bounds.east) / TILE_DEG) * TILE_DEG;
  const east = Math.max(bounds.west, bounds.east);

  // A tiny epsilon keeps floating point from adding a row of empty tiles when
  // an edge lands exactly on a boundary.
  for (let lat = south; lat < north - 1e-9; lat += TILE_DEG) {
    for (let lng = west; lng < east - 1e-9; lng += TILE_DEG) {
      keys.push(tileKey(lat + TILE_DEG / 2, lng + TILE_DEG / 2));
    }
  }
  return keys;
}

/**
 * Files each way under every tile it passes through.
 *
 * A path crossing a tile boundary belongs to both: storing it only where it
 * starts would leave a course approaching from the other side with the path
 * ending at an invisible line. The duplication is paid back on read, where
 * segments are de-duplicated by id.
 */
export function groupSegmentsByTile(segments: TrailSegment[]): Map<string, TrailSegment[]> {
  const byTile = new Map<string, TrailSegment[]>();
  for (const segment of segments) {
    const keys = new Set(segment.points.map(([lat, lng]) => tileKey(lat, lng)));
    for (const key of keys) {
      const bucket = byTile.get(key);
      if (bucket) bucket.push(segment);
      else byTile.set(key, [segment]);
    }
  }
  return byTile;
}

/** One list of ways, with the copies stored in neighbouring tiles removed. */
export function mergeTileSegments(tiles: TrailSegment[][]): TrailSegment[] {
  const byId = new Map<number, TrailSegment>();
  for (const segments of tiles) {
    for (const segment of segments) {
      if (!byId.has(segment.id)) byId.set(segment.id, segment);
    }
  }
  return [...byId.values()];
}

/**
 * Only the tiles a fetch actually saw all of.
 *
 * A query returns the ways inside its box, so a tile straddling the edge gets
 * the part that fell inside and nothing of the path continuing beyond it.
 * Writing that as the tile's answer would cache a hole: a later course
 * approaching from the other side would read "no paths here" and draw a
 * straight line across ground that is covered in them. Edge tiles are left
 * unwritten instead, for a fetch that contains them properly.
 */
export function tilesFullyInside(bounds: TrailBounds): Set<string> {
  const south = Math.min(bounds.south, bounds.north);
  const north = Math.max(bounds.south, bounds.north);
  const west = Math.min(bounds.west, bounds.east);
  const east = Math.max(bounds.west, bounds.east);

  const keys = new Set<string>();
  // Walked from the grid rather than parsed back out of the keys, which carry
  // a version prefix and are not meant to be read as coordinates.
  const firstSouth = Math.floor(south / TILE_DEG) * TILE_DEG;
  const firstWest = Math.floor(west / TILE_DEG) * TILE_DEG;
  for (let lat = firstSouth; lat < north - 1e-9; lat += TILE_DEG) {
    for (let lng = firstWest; lng < east - 1e-9; lng += TILE_DEG) {
      const inside =
        lat >= south - 1e-9 &&
        lng >= west - 1e-9 &&
        lat + TILE_DEG <= north + 1e-9 &&
        lng + TILE_DEG <= east + 1e-9;
      if (inside) keys.add(tileKey(lat + TILE_DEG / 2, lng + TILE_DEG / 2));
    }
  }
  return keys;
}
