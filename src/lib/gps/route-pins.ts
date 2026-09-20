import { haversineDistanceMeters } from "./haversine";

export interface NamedPoint {
  name: string;
  lat: number;
  lng: number;
}

export interface RoutePin {
  lat: number;
  lng: number;
  /** Every named waypoint that landed on this spot, in course order. Usually
      one; more than one is the point this file exists for. */
  points: NamedPoint[];
  /** "return" only when every waypoint folded into this pin was reached
      after the course's farthest point from the start. A spot the party
      passes twice - once going, once coming back - is tagged by its first
      visit and stays "outbound": it belongs to both, and "outbound" is the
      one that is still true once the pin has been merged into one mark. */
  leg: "outbound" | "return";
}

/** Two points close enough to be one stop rather than two. Shared with the
    club's own gazetteer matching (poi.ts) rather than redeclared, so a spot
    that counts as "the same place" there counts as one pin here too. */
const SAME_PLACE_M = 60;

/**
 * Named waypoints folded onto the spots they actually mark.
 *
 * A course that comes back on itself names some of its ground twice - once on
 * the way out, again on the way back, sometimes under a different name for the
 * same gate. Drawn one pin per waypoint, that is two markers stacked on one
 * coordinate: on 덕산온천's own loop, the course starts and ends at the same
 * trailhead under the same name, and a viewer sees what looks like one fat pin
 * until they zoom in on it.
 *
 * Folded here instead. Waypoints within 60m of an existing pin join it rather
 * than starting a new one, and a course that never comes back near itself -
 * ordinary point-to-point courses, all of them - is untouched: no pin merges,
 * every point keeps "outbound".
 *
 * "return" is only offered where there is a real turn to speak of. A
 * point-to-point course has no far side to come back from, and marking most of
 * it "return" anyway - which a plain "second half of the list" rule would do -
 * would be wrong more often than it was right. The turnaround is taken to be
 * the waypoint farthest from the start in a straight line, which is cheap,
 * needs no elevation or trail data, and is right wherever the party actually
 * doubles back: the far point of an out-and-back is, by definition, the
 * farthest one from where they started.
 */
export function groupRoutePins(points: NamedPoint[]): RoutePin[] {
  if (points.length === 0) return [];

  // Whether anything here is revisited at all. Unless it is, "outbound" is
  // simply what every point is, and the farthest-point rule below is not
  // asked to explain a course that never turns round.
  const revisits = points.some((point, i) =>
    points.some((other, j) => j > i + 1 && haversineDistanceMeters(point, other) <= SAME_PLACE_M));

  let turnIndex = points.length - 1;
  if (revisits) {
    let turnDistance = -1;
    for (let i = 0; i < points.length; i++) {
      const away = haversineDistanceMeters(points[0], points[i]);
      if (away > turnDistance) {
        turnDistance = away;
        turnIndex = i;
      }
    }
  }

  const pins: RoutePin[] = [];
  for (let i = 0; i < points.length; i++) {
    const point = points[i];
    const existing = pins.find((pin) => haversineDistanceMeters(pin, point) <= SAME_PLACE_M);
    if (existing) {
      existing.points.push(point);
      continue;
    }
    pins.push({ lat: point.lat, lng: point.lng, points: [point], leg: i <= turnIndex ? "outbound" : "return" });
  }
  return pins;
}
