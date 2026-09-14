import { haversineDistanceMeters } from "../gps/haversine";
import type { TrackPoint } from "../gps/track";
import type { TrailSegment } from "./trails";

/**
 * Pulls a line of named waypoints onto the trails that actually connect them.
 *
 * A suggested course arrives as place names - 상계역, 깔딱고개, 정상 - which
 * geocode to points. Joining those points with straight lines draws a route
 * over cliffs and through valleys nobody walks: the same fiction the
 * photo-derived polyline was, and the reason it was removed.
 *
 * OSM knows where the paths are. This builds a graph out of the mapped ways
 * and walks it between consecutive waypoints, so the line follows switchbacks
 * instead of cutting across them.
 *
 * A leg that cannot be walked on trail stays a straight line and says so, and
 * the map draws those dashed. Half a real route with its gap visible is worth
 * more than a whole invented one.
 */

export interface RouteLeg {
  points: TrackPoint[];
  /** False when this leg is a straight join rather than mapped trail. */
  onTrail: boolean;
}

/** A waypoint further than this from any mapped path did not snap. */
const SNAP_TOLERANCE_M = 400;

/** Ends of different ways this close are the same junction on the ground. */
const JUNCTION_TOLERANCE_M = 30;

/**
 * How far a trail route may wander before it is not believable as the way
 * between two points. Trails switchback, so three times the straight line is
 * ordinary; ten times means the search crossed the mountain to get around
 * something and the line would mislead more than it informs.
 */
const MAX_DETOUR_RATIO = 3.5;
const MAX_DETOUR_SLACK_M = 1500;

/** Grid cell for the spatial index, ~33m at Korean latitudes. */
const CELL = 0.0003;

interface Graph {
  /** Node coordinates, indexed by node id. */
  nodes: TrackPoint[];
  /** For each node, the nodes it connects to and the metres between them. */
  edges: Map<number, { to: number; cost: number }[]>;
  /** Grid cell key -> node ids, so a nearest-node lookup stays local. */
  cells: Map<string, number[]>;
  /** Which ways each node belongs to, which is what tells a junction from a
      switchback passing close to itself. */
  ways: Map<number, Set<number>>;
}

const cellKey = (lat: number, lng: number) =>
  `${Math.floor(lat / CELL)}:${Math.floor(lng / CELL)}`;

const metres = (a: TrackPoint, b: TrackPoint) =>
  haversineDistanceMeters({ lat: a[0], lng: a[1] }, { lat: b[0], lng: b[1] });

function addEdge(graph: Graph, from: number, to: number, cost: number) {
  if (from === to) return;
  for (const list of [graph.edges.get(from), graph.edges.get(to)]) {
    if (!list) return;
  }
  graph.edges.get(from)!.push({ to, cost });
  graph.edges.get(to)!.push({ to: from, cost });
}

export function buildTrailGraph(segments: TrailSegment[]): Graph {
  const graph: Graph = { nodes: [], edges: new Map(), cells: new Map(), ways: new Map() };
  // Identical coordinates are one node, which is how a way that branches off
  // another stays connected to it: OSM shares the junction node between them.
  const byCoord = new Map<string, number>();

  function nodeFor(point: TrackPoint): number {
    const key = `${point[0].toFixed(6)},${point[1].toFixed(6)}`;
    const existing = byCoord.get(key);
    if (existing !== undefined) return existing;

    const id = graph.nodes.length;
    graph.nodes.push(point);
    graph.edges.set(id, []);
    byCoord.set(key, id);
    const cell = cellKey(point[0], point[1]);
    const bucket = graph.cells.get(cell);
    if (bucket) bucket.push(id);
    else graph.cells.set(cell, [id]);
    return id;
  }

  for (const segment of segments) {
    let previous: number | null = null;
    for (const point of segment.points) {
      const id = nodeFor(point);
      const owners = graph.ways.get(id);
      if (owners) owners.add(segment.id);
      else graph.ways.set(id, new Set([segment.id]));
      if (previous !== null) addEdge(graph, previous, id, metres(graph.nodes[previous], point));
      previous = id;
    }
  }

  // Ways that meet on the ground do not always share a node in the data, and
  // the downsampling that keeps these segments drawable can drop the shared
  // point even when they did. Without this the graph is a pile of disconnected
  // paths and almost nothing routes.
  //
  // Only across different ways, though. A switchback doubles back within a few
  // metres of itself, so linking any two nearby points let the router step
  // straight across the zigzag and skip it - which is how a mountain trail came
  // back barely longer than the straight line between its ends.
  for (const [key, ids] of graph.cells) {
    const [cy, cx] = key.split(":").map(Number);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const neighbours = graph.cells.get(`${cy + dy}:${cx + dx}`);
        if (!neighbours) continue;
        for (const a of ids) {
          const aWays = graph.ways.get(a);
          for (const b of neighbours) {
            if (b <= a) continue;
            const bWays = graph.ways.get(b);
            if (aWays && bWays && [...aWays].some((w) => bWays.has(w))) continue;
            const gap = metres(graph.nodes[a], graph.nodes[b]);
            if (gap <= JUNCTION_TOLERANCE_M) addEdge(graph, a, b, gap);
          }
        }
      }
    }
  }

  return graph;
}

/** The mapped point nearest a waypoint, or null when none is close enough. */
function nearestNode(graph: Graph, point: TrackPoint): number | null {
  const reach = Math.ceil(SNAP_TOLERANCE_M / 33);
  const [cy, cx] = cellKey(point[0], point[1]).split(":").map(Number);
  let best: number | null = null;
  let bestDistance = SNAP_TOLERANCE_M;

  for (let dy = -reach; dy <= reach; dy++) {
    for (let dx = -reach; dx <= reach; dx++) {
      for (const id of graph.cells.get(`${cy + dy}:${cx + dx}`) ?? []) {
        const distance = metres(graph.nodes[id], point);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = id;
        }
      }
    }
  }
  return best;
}

/** Dijkstra with a binary heap; returns the node ids of the cheapest path. */
function shortestPath(graph: Graph, from: number, to: number): { path: number[]; cost: number } | null {
  const best = new Map<number, number>([[from, 0]]);
  const previous = new Map<number, number>();
  const heap: { id: number; cost: number }[] = [{ id: from, cost: 0 }];

  const push = (item: { id: number; cost: number }) => {
    heap.push(item);
    let i = heap.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (heap[parent].cost <= heap[i].cost) break;
      [heap[parent], heap[i]] = [heap[i], heap[parent]];
      i = parent;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length > 0) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let smallest = i;
        if (l < heap.length && heap[l].cost < heap[smallest].cost) smallest = l;
        if (r < heap.length && heap[r].cost < heap[smallest].cost) smallest = r;
        if (smallest === i) break;
        [heap[smallest], heap[i]] = [heap[i], heap[smallest]];
        i = smallest;
      }
    }
    return top;
  };

  while (heap.length > 0) {
    const current = pop();
    if (current.cost > (best.get(current.id) ?? Infinity)) continue;
    if (current.id === to) {
      const path = [to];
      let step = to;
      while (previous.has(step)) {
        step = previous.get(step)!;
        path.push(step);
      }
      return { path: path.reverse(), cost: current.cost };
    }
    for (const edge of graph.edges.get(current.id) ?? []) {
      const cost = current.cost + edge.cost;
      if (cost < (best.get(edge.to) ?? Infinity)) {
        best.set(edge.to, cost);
        previous.set(edge.to, current.id);
        push({ id: edge.to, cost });
      }
    }
  }
  return null;
}

export interface SnapDiagnostics {
  /** Metres from each waypoint to the nearest mapped path, or null when none
      was within reach. This is the number that decides whether a leg can be
      routed at all, and it is invisible from a screenshot. */
  snapDistances: (number | null)[];
  legs: { onTrail: boolean; straightM: number; routedM: number | null }[];
}

export function snapRouteToTrails(
  waypoints: { lat: number; lng: number }[],
  segments: TrailSegment[],
  diagnostics?: SnapDiagnostics,
): RouteLeg[] {
  const points: TrackPoint[] = waypoints.map((w) => [w.lat, w.lng]);
  if (points.length < 2) return [];

  const graph = buildTrailGraph(segments);
  const snapped = points.map((point) => (graph.nodes.length > 0 ? nearestNode(graph, point) : null));
  if (diagnostics) {
    diagnostics.snapDistances = snapped.map((id, i) =>
      id === null ? null : Math.round(metres(graph.nodes[id], points[i])),
    );
  }
  const legs: RouteLeg[] = [];

  for (let i = 1; i < points.length; i++) {
    const from = snapped[i - 1];
    const to = snapped[i];
    const straight: RouteLeg = { points: [points[i - 1], points[i]], onTrail: false };

    if (from === null || to === null) {
      diagnostics?.legs.push({ onTrail: false, straightM: Math.round(metres(points[i - 1], points[i])), routedM: null });
      legs.push(straight);
      continue;
    }

    const result = shortestPath(graph, from, to);
    const direct = metres(points[i - 1], points[i]);
    // A route several times longer than the straight line went around
    // something rather than along it, so the honest answer is the dashed line.
    const believable =
      result !== null && result.cost <= Math.max(direct * MAX_DETOUR_RATIO, direct + MAX_DETOUR_SLACK_M);

    diagnostics?.legs.push({
      onTrail: believable && !!result,
      straightM: Math.round(direct),
      routedM: result ? Math.round(result.cost) : null,
    });

    if (!believable || !result) {
      legs.push(straight);
      continue;
    }

    // The waypoint itself is kept at each end so the line still reaches the
    // place the answer named, even when the nearest path is a little off it.
    legs.push({
      points: [points[i - 1], ...result.path.map((id) => graph.nodes[id]), points[i]],
      onTrail: true,
    });
  }

  return legs;
}

/**
 * Drops a waypoint that sits nowhere near the rest of the course.
 *
 * Waypoint names are looked up one at a time, and a lookup can land on the
 * wrong place entirely: 해골바위 on 숨은벽 능선 came back eight kilometres east
 * of the ridge, on the far side of the massif, and the course was drawn as a
 * straight line across 북한산 to reach it. One bad name should cost its own pin,
 * not the whole route's shape.
 *
 * The test is relative rather than a fixed distance, because a ridge traverse
 * and a short crag approach have legitimately different strides: a point is
 * only dropped when it is far from its neighbours by the standard of the other
 * gaps on this same course.
 */
// Three rather than four: the 해골바위 lookup that prompted this landed 7.8km
// from a course whose points were otherwise 2.1km apart, and four times the
// median let it through by six hundred metres. The 3km floor keeps a short
// crag approach from having its own waypoints judged against a tiny median.
const OUTLIER_GAP_RATIO = 3;
const OUTLIER_MIN_GAP_M = 3000;

export function dropOutlierWaypoints<T extends { lat: number; lng: number }>(points: T[]): T[] {
  if (points.length < 3) return points;

  // Distance to the nearest other waypoint, rather than to the ones either
  // side in the list. A course of three with one bad name has that bad name in
  // both of the sequential gaps, which drags the median up until nothing looks
  // unusual; every good point still has a close neighbour somewhere.
  const nearest = points.map((point, i) =>
    Math.min(
      ...points.flatMap((other, j) => (i === j ? [] : [haversineDistanceMeters(point, other)])),
    ),
  );
  const sorted = [...nearest].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  if (median <= 0) return points;

  const limit = Math.max(median * OUTLIER_GAP_RATIO, OUTLIER_MIN_GAP_M);
  const kept = points.filter((_, i) => nearest[i] <= limit);
  // Never strip a course down to nothing on the strength of this heuristic.
  return kept.length >= 2 ? kept : points;
}
