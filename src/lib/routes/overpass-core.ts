/**
 * Overpass access, with no `server-only` guard.
 *
 * The guard belongs on the app's import of this, not on the logic itself:
 * the prewarm script fills our tables from the same endpoints and cannot
 * import a module that throws outside a request. overpass.ts re-exports all
 * of this and carries the guard for application code.
 */
import { downsampleTrack } from "../gps/track";
import { parseOverpassWays, segmentLengthMeters, type TrailSegment } from "./trails";

// Overpass is volunteer-run and the main instance does fall over - it answered
// 504 for every request while this was being built. The mirrors run the same
// API over the same data, so trying the next one costs nothing but a retry.
const OVERPASS_URLS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

// A mountain's worth of trails without dragging in a neighbouring one.
export const MAX_TRAIL_RADIUS_M = 3000;
export const DEFAULT_TRAIL_RADIUS_M = 1500;

// Overpass is a volunteer-run service on a fair-use policy, so a request that
// hangs is abandoned rather than left holding a Worker invocation open.
//
// Eight seconds, not twenty: three mirrors tried in turn at twenty each kept a
// member waiting 51 seconds for a course that our own tables could already
// draw. Overpass is the fallback now, not the source, so it gets the patience
// a fallback deserves.
const TIMEOUT_MS = 8_000;

// Anything shorter is a driveway stub or a staircase between two switchbacks;
// as a thing to pick off a map it is noise. It is emphatically not noise to a
// router: measured against real data for 밤골 to 도선사, dropping the 114 ways
// under 40m disconnected the graph across 북한산 and the course fell back to a
// straight line, while keeping them routed the whole 8.3km along real trail.
// So this applies to the picker and never to routing.
const MIN_PICKABLE_LENGTH_M = 40;

// Enough shape to follow a ridge, few enough points that a hundred of them can
// be drawn at once. hikes.track is downsampled again when it is saved.
const MAX_POINTS_PER_SEGMENT = 120;

/**
 * The first mirror that answers with usable JSON.
 *
 * An overloaded instance replies 504 with an HTML error page, so a 200 is not
 * enough on its own - the body has to parse. Each mirror gets its own timeout
 * rather than sharing one deadline, since the point is to outlast a single
 * slow server, not to give up sooner.
 */
async function fetchFromAnyMirror(query: string, timeoutMs: number = TIMEOUT_MS): Promise<unknown> {
  let lastStatus = 0;
  const deadline = Date.now() + timeoutMs;
  for (const [index, url] of OVERPASS_URLS.entries()) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    try {
      const response = await fetch(url, {
        method: "POST",
        body: query,
        headers: {
          "content-type": "text/plain;charset=UTF-8",
          // Overpass asks for a contactable identity on automated traffic.
          "user-agent": "khuac.com hiking album (contact: https://khuac.com)",
        },
        signal: AbortSignal.timeout(Math.max(1, Math.floor(remaining / (OVERPASS_URLS.length - index)))),
      });
      lastStatus = response.status;
      if (!response.ok) continue;
      const payload = await response.json() as { elements?: unknown[]; remark?: string };
      // Overpass can return HTTP 200 plus a timeout remark and partial ways.
      // Such a response must never be cached as a complete network.
      if (!Array.isArray(payload.elements) || payload.remark) continue;
      return payload;
    } catch {
      // Timed out, refused, or answered with an HTML error page. Next mirror.
    }
  }
  throw new Error(`등산로 정보를 불러오지 못했습니다 (${lastStatus || "응답 없음"})`);
}

export interface TrailBounds {
  south: number;
  west: number;
  north: number;
  east: number;
}

// A circle big enough to hold a long ridge traverse would also drag in half a
// province, so a route asks for its own bounding box instead. This cap is a
// guard against a bad waypoint stretching the box across the country: roughly
// 28km, wider than any single course the club walks.
const MAX_BOUNDS_SPAN_DEG = 0.25;

/**
 * Mapped paths inside a box, which is the shape a route actually has.
 *
 * fetchTrailsNear takes a circle centred on one point, and a course from 밤골
 * to 도선사 is 6km end to end - the radius cap left the middle of the mountain
 * outside the query and every leg came back dashed for want of data rather
 * than for want of a path.
 */
export async function fetchTrailsInBounds(
  bounds: TrailBounds,
  // Eight seconds is right for a member waiting on a map. The prewarm script
  // is not waiting on anything and would rather have the data, so it asks for
  // as long as it takes.
  timeoutMs: number = TIMEOUT_MS,
): Promise<TrailSegment[]> {
  const south = Math.min(bounds.south, bounds.north);
  const north = Math.max(bounds.south, bounds.north);
  const west = Math.min(bounds.west, bounds.east);
  const east = Math.max(bounds.west, bounds.east);
  if (north - south > MAX_BOUNDS_SPAN_DEG || east - west > MAX_BOUNDS_SPAN_DEG) {
    throw new Error("등산로를 찾기에는 경로가 너무 넓습니다.");
  }

  const query = `[out:json][timeout:${Math.floor(timeoutMs / 1000)}];
way(${south},${west},${north},${east})["highway"~"^(path|footway|track|steps|pedestrian|living_street|residential|service|unclassified)$"]["area"!="yes"]["foot"!~"^(no|private)$"]["access"!~"^(no|private)$"];
out geom;`;

  return prepare(await fetchFromAnyMirror(query, timeoutMs), 0);
}

function buildQuery(lat: number, lng: number, radiusM: number) {
  // steps included on purpose: Korean trails are full of stairways, and a route
  // that omitted them would have holes exactly where the climbing happens.
  return `[out:json][timeout:${Math.floor(TIMEOUT_MS / 1000)}];
way(around:${radiusM},${lat},${lng})["highway"~"^(path|footway|track|steps)$"];
out geom;`;
}

/**
 * Mapped paths around a point, ready to be drawn and chosen from.
 *
 * Server-side because Overpass asks callers to identify themselves and behave,
 * which is not something thirty browsers can be trusted to do in parallel - and
 * because the raw response is far larger than what the map needs.
 */
export async function fetchTrailsNear(
  lat: number,
  lng: number,
  radiusM: number = DEFAULT_TRAIL_RADIUS_M,
): Promise<TrailSegment[]> {
  const radius = Math.min(Math.max(Math.round(radiusM), 200), MAX_TRAIL_RADIUS_M);

  const payload = await fetchFromAnyMirror(buildQuery(lat, lng, radius));

  return prepare(payload, MIN_PICKABLE_LENGTH_M);
}

function prepare(payload: unknown, minLengthM: number): TrailSegment[] {
  return parseOverpassWays(payload)
    .filter((segment) => segmentLengthMeters(segment) >= minLengthM)
    .map((segment) => ({
      ...segment,
      // Routing must retain every junction; only simplify the visual picker.
      points: minLengthM === 0 ? segment.points : downsampleTrack(segment.points, MAX_POINTS_PER_SEGMENT),
    }))
    // Longest first: the named ridge someone actually walked outranks the
    // twenty metres of connector beside it.
    .sort((a, b) => segmentLengthMeters(b) - segmentLengthMeters(a));
}
