import "server-only";

/**
 * The application's door to Overpass. The logic lives in overpass-core.ts so
 * that offline scripts can use it too; this file exists to keep the
 * server-only guard on the path application code takes.
 */
export {
  fetchTrailsInBounds,
  fetchTrailsNear,
  MAX_TRAIL_RADIUS_M,
  DEFAULT_TRAIL_RADIUS_M,
  type TrailBounds,
} from "./overpass-core";
