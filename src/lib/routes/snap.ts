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
 * An unconnected leg has no geometry. The UI reports missing sections
 * instead of joining waypoints across unmapped ground.
 */

export interface RouteLeg {
  points: TrackPoint[];
  /** False with empty points when no mapped route connects the leg. */
  onTrail: boolean;
}

/** A waypoint further than this from any mapped path did not snap. */
const SNAP_TOLERANCE_M = 400;

/** Ends of different ways this close are the same junction on the ground. */
const JUNCTION_TOLERANCE_M = 2;

/**
 * How far a trail route may wander before it stops being believable.
 *
 * The ratio alone was written for flat ground and rejected real mountain
 * routes: 구기 to 대남문 is 411m apart in a straight line and 3,206m of path,
 * because the way between them goes around a cliff. A short gap in steep
 * terrain routinely costs kilometres, so the slack matters more than the
 * multiple, and it is the slack that was too small.
 */
const MAX_DETOUR_RATIO = 4;
const MAX_DETOUR_SLACK_M = 3500;

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
  endpoints: Set<number>;
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
  const graph: Graph = { nodes: [], edges: new Map(), cells: new Map(), ways: new Map(), endpoints: new Set() };
  // Identical coordinates are one node, which is how a way that branches off
  // another stays connected to it: OSM shares the junction node between them.
  // Keyed by the rounded coordinates as numbers rather than by a formatted
  // string. Identical bucketing to six decimals, without building 65,000
  // strings through toFixed - which measured as the single biggest cost in
  // assembling the graph, and the graph is most of the work of drawing a line.
  const byCoord = new Map<number, Map<number, number>>();

  function nodeFor(point: TrackPoint): number {
    const lat = Math.round(point[0] * 1e6);
    const lng = Math.round(point[1] * 1e6);
    let row = byCoord.get(lat);
    if (row) {
      const existing = row.get(lng);
      if (existing !== undefined) return existing;
    } else {
      row = new Map<number, number>();
      byCoord.set(lat, row);
    }

    const id = graph.nodes.length;
    graph.nodes.push(point);
    graph.edges.set(id, []);
    row.set(lng, id);
    const cell = cellKey(point[0], point[1]);
    const bucket = graph.cells.get(cell);
    if (bucket) bucket.push(id);
    else graph.cells.set(cell, [id]);
    return id;
  }

  for (const segment of segments) {
    let previous: number | null = null;
    for (const [index, point] of segment.points.entries()) {
      const id = nodeFor(point);
      if (index === 0 || index === segment.points.length - 1) graph.endpoints.add(id);
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
  // Indexed over the ends of ways alone, which is all this pass can join.
  // Walking every node and rejecting the interior ones inside the innermost
  // loop meant measuring 58,000 nodes against their neighbours to act on the
  // 12,000 that could qualify, and that search was the largest single cost in
  // drawing a course.
  const endCells = new Map<string, number[]>();
  for (const id of graph.endpoints) {
    const cell = cellKey(graph.nodes[id][0], graph.nodes[id][1]);
    const bucket = endCells.get(cell);
    if (bucket) bucket.push(id);
    else endCells.set(cell, [id]);
  }

  for (const [key, ids] of endCells) {
    const [cy, cx] = key.split(":").map(Number);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const neighbours = endCells.get(`${cy + dy}:${cx + dx}`);
        if (!neighbours) continue;
        for (const a of ids) {
          const aWays = graph.ways.get(a);
          for (const b of neighbours) {
            if (b <= a) continue;
            // Close parallel paths and switchbacks are not junctions. Only
            // repair sub-two-metre gaps between mapped segment endpoints.
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

/**
 * The mapped point nearest a waypoint, or null when none is close enough.
 *
 * `allowed` restricts the answer to one connected piece of the network, which
 * is what stops a waypoint landing four metres onto a path that goes nowhere.
 */
function nearestNode(
  graph: Graph,
  point: TrackPoint,
  allowed?: (id: number) => boolean,
): number | null {
  const reach = Math.ceil(SNAP_TOLERANCE_M / 33);
  const [cy, cx] = cellKey(point[0], point[1]).split(":").map(Number);
  let best: number | null = null;
  let bestDistance = SNAP_TOLERANCE_M;

  for (let dy = -reach; dy <= reach; dy++) {
    for (let dx = -reach; dx <= reach; dx++) {
      for (const id of graph.cells.get(`${cy + dy}:${cx + dx}`) ?? []) {
        if (allowed && !allowed(id)) continue;
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

/** Which connected piece of the network each node belongs to, and how big each is. */
function connectedComponents(graph: Graph): { of: Int32Array; sizes: number[] } {
  const of = new Int32Array(graph.nodes.length).fill(-1);
  const sizes: number[] = [];
  for (let start = 0; start < graph.nodes.length; start++) {
    if (of[start] !== -1) continue;
    const id = sizes.length;
    let size = 0;
    of[start] = id;
    const stack = [start];
    while (stack.length > 0) {
      const node = stack.pop()!;
      size++;
      for (const edge of graph.edges.get(node) ?? []) {
        if (of[edge.to] === -1) {
          of[edge.to] = id;
          stack.push(edge.to);
        }
      }
    }
    sizes.push(size);
  }
  return { of, sizes };
}

/**
 * How much bigger a network has to be before a waypoint is moved onto it, and
 * how far it may be moved to get there.
 *
 * Both guards are needed, and each without the other is wrong. Size alone
 * bridges two real parallel trails ten metres apart, because neither is the
 * main network and preferring either is arbitrary. Distance alone drags a
 * waypoint onto whatever large thing is nearby, which is how a course walks to
 * a road instead of the path it named. Together they say only this: a waypoint
 * should not be left on a dead end when the mountain's own network is as close.
 */
const MAIN_NETWORK_FACTOR = 4;
const REROUTE_SLACK_M = 50;

/**
 * The piece of the network that can carry the most of this course.
 *
 * Two surveys of the same mountain never share a coordinate, so merging them
 * does not merge their networks: around 정릉, OSM alone connects the whole
 * course on one 24,666-node network, while the 국립공원공단 lines fall into 94
 * disconnected spurs, the largest holding 6.5% of its nodes. Snapping each
 * waypoint to whatever is nearest then decides the route on a few metres -
 * 보국문 sits 4m from a park spur and 6m from the OSM ridge, took the spur,
 * and the leg came back with no path at all because that spur leads nowhere.
 *
 * So the network is chosen before the waypoints are: whichever piece is within
 * reach of the most of them, nearest in aggregate to break a tie.
 */
function bestComponent(
  graph: Graph,
  component: Int32Array,
  points: (TrackPoint | null)[],
): number | null {
  const reach = new Map<number, { covered: number; distance: number }>();
  for (const point of points) {
    if (!point) continue;
    // The closest this waypoint gets to each piece, counted once per piece so
    // a dense one cannot outvote a reachable one.
    const nearestPer = new Map<number, number>();
    const span = Math.ceil(SNAP_TOLERANCE_M / 33);
    const [cy, cx] = cellKey(point[0], point[1]).split(":").map(Number);
    for (let dy = -span; dy <= span; dy++) {
      for (let dx = -span; dx <= span; dx++) {
        for (const id of graph.cells.get(`${cy + dy}:${cx + dx}`) ?? []) {
          const distance = metres(graph.nodes[id], point);
          if (distance >= SNAP_TOLERANCE_M) continue;
          const piece = component[id];
          const seen = nearestPer.get(piece);
          if (seen === undefined || distance < seen) nearestPer.set(piece, distance);
        }
      }
    }
    for (const [piece, distance] of nearestPer) {
      const tally = reach.get(piece) ?? { covered: 0, distance: 0 };
      tally.covered++;
      tally.distance += distance;
      reach.set(piece, tally);
    }
  }

  let best: number | null = null;
  let bestTally = { covered: 0, distance: Infinity };
  for (const [piece, tally] of reach) {
    if (
      tally.covered > bestTally.covered ||
      (tally.covered === bestTally.covered && tally.distance < bestTally.distance)
    ) {
      best = piece;
      bestTally = tally;
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

/** Insert a waypoint's perpendicular projection into its nearest trail edge.
 * Snapping to vertices alone misses the middle of a long, sparsely mapped
 * approach road, even when the waypoint is directly on that road. */
export function projectOntoTrails(points: TrackPoint[], segments: TrailSegment[]) {
  // One box per way, built once. Without it every waypoint is measured against
  // every edge on the mountain - eight waypoints against 65,734 vertices was
  // most of a second of trigonometry, and a Worker answering a course of that
  // size ran out of CPU and returned 503. Nearly every way is nowhere near any
  // given waypoint, and a box says so in four comparisons.
  const boxes = segments.map((segment) => {
    let south = Infinity, north = -Infinity, west = Infinity, east = -Infinity;
    for (const [lat, lng] of segment.points) {
      if (lat < south) south = lat;
      if (lat > north) north = lat;
      if (lng < west) west = lng;
      if (lng > east) east = lng;
    }
    return { south, north, west, east };
  });
  /** The tolerance in degrees, which is what the boxes are measured in. */
  const latMargin = SNAP_TOLERANCE_M / 111_320;

  const cuts = new Map<number, Map<number, { t: number; point: TrackPoint }[]>>();
  const projected = points.map((point): TrackPoint | null => {
    const scale = Math.cos(point[0] * Math.PI / 180);
    const lngMargin = latMargin / Math.max(scale, 0.01);
    let best: { segment: number; edge: number; t: number; point: TrackPoint } | null = null;
    let distance = SNAP_TOLERANCE_M;
    segments.forEach((segment, segmentIndex) => {
      const box = boxes[segmentIndex];
      if (
        point[0] < box.south - latMargin || point[0] > box.north + latMargin ||
        point[1] < box.west - lngMargin || point[1] > box.east + lngMargin
      ) return;
      for (let i = 1; i < segment.points.length; i++) {
        const a = segment.points[i - 1];
        const b = segment.points[i];
        const dx = (b[1] - a[1]) * scale;
        const dy = b[0] - a[0];
        const squared = dx * dx + dy * dy;
        const t = squared === 0 ? 0 : Math.max(0, Math.min(1,
          (((point[1] - a[1]) * scale) * dx + (point[0] - a[0]) * dy) / squared));
        const projected: TrackPoint = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
        const gap = metres(point, projected);
        if (gap < distance) {
          distance = gap;
          best = { segment: segmentIndex, edge: i, t, point: projected };
        }
      }
    });
    // forEach callback assignments are not narrowed by TypeScript.
    const selected = best as { segment: number; edge: number; t: number; point: TrackPoint } | null;
    if (!selected) return null;
    const edges = cuts.get(selected.segment) ?? new Map<number, { t: number; point: TrackPoint }[]>();
    const edgeCuts = edges.get(selected.edge) ?? [];
    edgeCuts.push(selected);
    edges.set(selected.edge, edgeCuts);
    cuts.set(selected.segment, edges);
    return selected.point;
  });
  return {
    projected,
    segments: segments.map((segment, i) => {
      const edges = cuts.get(i);
      if (!edges) return segment;
      const split: TrackPoint[] = [];
      segment.points.forEach((point, j) => {
        for (const cut of (edges.get(j) ?? []).sort((a, b) => a.t - b.t)) split.push(cut.point);
        split.push(point);
      });
      return { ...segment, points: split };
    }),
  };
}

export function snapRouteToTrails(
  waypoints: { lat: number; lng: number }[],
  segments: TrailSegment[],
  diagnostics?: SnapDiagnostics,
): RouteLeg[] {
  const points: TrackPoint[] = waypoints.map((w) => [w.lat, w.lng]);
  if (points.length < 2) return [];

  const projected = projectOntoTrails(points, segments);
  const graph = buildTrailGraph(projected.segments);
  const component = connectedComponents(graph);
  const chosen = bestComponent(graph, component.of, projected.projected);
  const snapped = projected.projected.map((point) => {
    if (!point) return null;
    const nearest = nearestNode(graph, point);
    if (nearest === null || chosen === null || component.of[nearest] === chosen) return nearest;

    const onChosen = nearestNode(graph, point, (id) => component.of[id] === chosen);
    if (onChosen === null) return nearest;

    const here = metres(graph.nodes[nearest], point);
    const there = metres(graph.nodes[onChosen], point);
    const bigger = component.sizes[chosen] >= component.sizes[component.of[nearest]] * MAIN_NETWORK_FACTOR;
    const close = there <= Math.max(here * 3, REROUTE_SLACK_M);
    return bigger && close ? onChosen : nearest;
  });
  if (diagnostics) {
    diagnostics.snapDistances = snapped.map((id, i) =>
      id === null ? null : Math.round(metres(graph.nodes[id], points[i])),
    );
  }
  const legs: RouteLeg[] = [];

  for (let i = 1; i < points.length; i++) {
    const from = snapped[i - 1];
    const to = snapped[i];
    const missing: RouteLeg = { points: [], onTrail: false };

    if (from === null || to === null) {
      diagnostics?.legs.push({ onTrail: false, straightM: Math.round(metres(points[i - 1], points[i])), routedM: null });
      legs.push(missing);
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
      legs.push(missing);
      continue;
    }

    // Only mapped geometry is solid. A landmark's pin may be off the trail;
    // appending it would invent a straight approach through unmapped ground.
    legs.push({
      points: result.path.map((id) => graph.nodes[id]),
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
