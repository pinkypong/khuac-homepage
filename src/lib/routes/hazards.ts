import type { TrackPoint } from "@/lib/gps/track";

/** Where the park service has recorded a danger or a fixed rope / railing. */
export type HazardKind = "isolation" | "washout" | "flood" | "rope" | "rail";

export interface Hazard {
  lat: number;
  lng: number;
  kind: HazardKind;
  label: string;
}

export type HazardRow = readonly [number, number, string, string];

export const HAZARD_LABEL: Record<HazardKind, string> = {
  isolation: "고립 위험",
  washout: "유실 위험",
  flood: "침수 위험",
  rope: "로프 구간",
  rail: "난간",
};

/** The first three are places the walk can go wrong; the last two are aids. */
export const isDanger = (kind: HazardKind) => kind !== "rope" && kind !== "rail";

const M_PER_DEG = 111_320;

/**
 * The records that lie within `maxMeters` of the walked line.
 *
 * Measured to the segments, not the vertices: a track downsampled to a point
 * every few hundred metres would otherwise miss a railing that sits mid-way
 * between two of them.
 */
export function hazardsNearRoute(
  track: readonly TrackPoint[],
  rows: readonly HazardRow[],
  maxMeters = 30,
): Hazard[] {
  if (track.length === 0) return [];
  const pad = maxMeters / M_PER_DEG + 1e-4;
  const lats = track.map((p) => p[0]);
  const lngs = track.map((p) => p[1]);
  const south = Math.min(...lats) - pad;
  const north = Math.max(...lats) + pad;
  const west = Math.min(...lngs) - pad * 1.5;
  const east = Math.max(...lngs) + pad * 1.5;

  const found: Hazard[] = [];
  for (const [lat, lng, kind, label] of rows) {
    if (lat < south || lat > north || lng < west || lng > east) continue;
    if (distanceToLine(lat, lng, track) <= maxMeters) {
      found.push({ lat, lng, kind: kind as HazardKind, label });
    }
  }
  return found;
}

function distanceToLine(lat: number, lng: number, line: readonly TrackPoint[]): number {
  const kx = M_PER_DEG * Math.cos((lat * Math.PI) / 180);
  let best = Infinity;
  for (let i = 0; i < line.length; i++) {
    const ax = (line[i][1] - lng) * kx;
    const ay = (line[i][0] - lat) * M_PER_DEG;
    const bx = (line[Math.min(i + 1, line.length - 1)][1] - lng) * kx;
    const by = (line[Math.min(i + 1, line.length - 1)][0] - lat) * M_PER_DEG;
    const dx = bx - ax;
    const dy = by - ay;
    const span = dx * dx + dy * dy;
    const t = span === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / span));
    best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return best;
}

/** One pin on the map: a danger, or a run of rope / railing folded into one. */
export interface HazardSpot extends Hazard {
  /** How many records this pin stands for. Always 1 for a danger. */
  count: number;
}

/**
 * The records as pins, with runs of rope and railing folded together.
 *
 * A course like 도봉 carries over a hundred rope records, a few metres apart:
 * a pin for each is a wall of them on a phone. Records of the same kind that
 * are within `gapMeters` of a neighbour - chained, so a long fixed rope is one
 * run however many records it has - become one pin, placed on the record
 * nearest the run's centre so it stays on the walked line. Dangers are never
 * merged: each one is a place to be told about on its own.
 */
export function mergeHazards(hazards: readonly Hazard[], gapMeters = 60): HazardSpot[] {
  const spots: HazardSpot[] = [];
  const aids = new Map<HazardKind, Hazard[]>();
  for (const hazard of hazards) {
    if (isDanger(hazard.kind)) {
      spots.push({ ...hazard, count: 1 });
    } else {
      const list = aids.get(hazard.kind) ?? [];
      list.push(hazard);
      aids.set(hazard.kind, list);
    }
  }
  for (const list of aids.values()) {
    for (const run of runsWithin(list, gapMeters)) {
      const lat = run.reduce((sum, h) => sum + h.lat, 0) / run.length;
      const lng = run.reduce((sum, h) => sum + h.lng, 0) / run.length;
      let middle = run[0];
      let best = Infinity;
      for (const h of run) {
        const d = metresBetween(h.lat, h.lng, lat, lng);
        if (d < best) {
          best = d;
          middle = h;
        }
      }
      spots.push({ ...middle, count: run.length });
    }
  }
  return spots;
}

function metresBetween(latA: number, lngA: number, latB: number, lngB: number): number {
  const kx = M_PER_DEG * Math.cos((((latA + latB) / 2) * Math.PI) / 180);
  return Math.hypot((lngA - lngB) * kx, (latA - latB) * M_PER_DEG);
}

/** Single-linkage groups: two records share a group if a chain of gaps <= `gap` joins them. */
function runsWithin(list: readonly Hazard[], gap: number): Hazard[][] {
  const parent = list.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      if (metresBetween(list[i].lat, list[i].lng, list[j].lat, list[j].lng) <= gap) {
        parent[find(i)] = find(j);
      }
    }
  }
  const groups = new Map<number, Hazard[]>();
  list.forEach((hazard, i) => {
    const root = find(i);
    const group = groups.get(root);
    if (group) group.push(hazard);
    else groups.set(root, [hazard]);
  });
  return [...groups.values()];
}
