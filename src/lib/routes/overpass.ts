import "server-only";
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
const TIMEOUT_MS = 20_000;

// Anything shorter is a driveway stub or a staircase between two switchbacks;
// as a thing to pick off a map it is noise.
const MIN_USEFUL_LENGTH_M = 40;

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
async function fetchFromAnyMirror(query: string): Promise<unknown> {
  let lastStatus = 0;
  for (const url of OVERPASS_URLS) {
    try {
      const response = await fetch(url, {
        method: "POST",
        body: query,
        headers: {
          "content-type": "text/plain;charset=UTF-8",
          // Overpass asks for a contactable identity on automated traffic.
          "user-agent": "khuac.com hiking album (contact: https://khuac.com)",
        },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      lastStatus = response.status;
      if (!response.ok) continue;
      return await response.json();
    } catch {
      // Timed out, refused, or answered with an HTML error page. Next mirror.
    }
  }
  throw new Error(`등산로 정보를 불러오지 못했습니다 (${lastStatus || "응답 없음"})`);
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

  return parseOverpassWays(payload)
    .filter((segment) => segmentLengthMeters(segment) >= MIN_USEFUL_LENGTH_M)
    .map((segment) => ({
      ...segment,
      points: downsampleTrack(segment.points, MAX_POINTS_PER_SEGMENT),
    }))
    // Longest first: the named ridge someone actually walked outranks the
    // twenty metres of connector beside it.
    .sort((a, b) => segmentLengthMeters(b) - segmentLengthMeters(a));
}
