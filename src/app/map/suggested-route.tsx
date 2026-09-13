"use client";

import { useEffect } from "react";
import { AdvancedMarker, Polyline, useMap, useMapsLibrary } from "@vis.gl/react-google-maps";
import type { RouteSuggestion } from "@/lib/assistant/routes";
import type { RouteWaypoint } from "./route-album-actions";

// Distinct from every activity colour and from the red a selected activity's
// own route uses, so a suggestion is never mistaken for a walked track.
const SUGGESTION_COLOR = "#5b1a23";

/**
 * How many named waypoints are looked up per course.
 *
 * Every lookup is a billed Places request, so this is a spend ceiling as much
 * as a layout one: a course shaped 들머리 → 능선 → 정상 reads the same at six
 * points as at twelve, and the model sometimes lists every minor landmark.
 * The ends are kept and the middle is thinned, so the line still spans the
 * whole course rather than stopping short of the summit.
 */
const MAX_LOOKUPS = 6;

// Names repeat across courses on the same mountain (연주대 ends three of them),
// and a member comparing courses taps back and forth. Module scope so those
// repeats cost nothing - a page load is the only thing that clears it.
const cache = new Map<string, RouteWaypoint | null>();

function thin(waypoints: string[]): string[] {
  if (waypoints.length <= MAX_LOOKUPS) return waypoints;
  const middle = waypoints.slice(1, -1);
  const step = (middle.length - 1) / (MAX_LOOKUPS - 3);
  const picked = Array.from({ length: MAX_LOOKUPS - 2 }, (_, i) => middle[Math.round(i * step)]);
  return [waypoints[0], ...picked, waypoints[waypoints.length - 1]];
}

/**
 * Draws a course the assistant suggested onto the club's own map.
 *
 * Waypoints arrive as place names and are resolved here, in the browser,
 * through the same referrer-restricted key the map already runs on.
 *
 * Places text search rather than the Geocoding API on purpose. Geocoding is a
 * separate API that this project has never enabled - every lookup came back
 * REQUEST_DENIED, which is why no line appeared at all - and it resolves
 * addresses, not landmarks: 깔딱고개 and 연주대 are exactly the kind of names
 * it has no answer for. Places is the service the location search box already
 * uses, so it is known to work on this key, and it is built for named places.
 *
 * The result is still a sketch: points joined by straight lines, drawn dashed
 * so it never reads as a surveyed path, and never written to hikes.track.
 */
export function SuggestedRoute({
  route,
  center,
  placeName,
  resolved,
  onResolved,
}: {
  route: RouteSuggestion;
  center: { lat: number; lng: number } | null;
  /** The mountain, used to disambiguate a waypoint when there is no centre to
      bias toward - which is the usual case for a place the club has never
      been to, and exactly when the names are most ambiguous. */
  placeName: string;
  resolved: RouteWaypoint[] | null;
  onResolved: (points: RouteWaypoint[]) => void;
}) {
  const places = useMapsLibrary("places");
  const map = useMap();
  const centerLat = center?.lat;
  const centerLng = center?.lng;
  const routeName = route.name;
  const waypoints = route.waypoints;

  useEffect(() => {
    if (!places || waypoints.length === 0) return;
    let cancelled = false;

    async function resolveOne(name: string): Promise<RouteWaypoint | null> {
      const cached = cache.get(name);
      if (cached !== undefined) return cached;
      try {
        const { places: found } = await places!.Place.searchByText({
          // 관음사 and 사당역 exist in several cities, so without a centre to
          // bias toward, the mountain's name has to carry the disambiguation.
          textQuery: centerLat != null ? name : `${placeName} ${name}`,
          fields: ["location"],
          language: "ko",
          region: "KR",
          maxResultCount: 1,
          ...(centerLat != null && centerLng != null
            ? { locationBias: { center: { lat: centerLat, lng: centerLng }, radius: 20000 } }
            : {}),
        });
        const location = found[0]?.location;
        const point = location ? { name, lat: location.lat(), lng: location.lng() } : null;
        cache.set(name, point);
        return point;
      } catch (error) {
        console.error("[map/suggested-route] lookup failed", name, error);
        cache.set(name, null);
        return null;
      }
    }

    Promise.all(thin(waypoints).map(resolveOne)).then((points) => {
      if (cancelled) return;
      const found = points.filter((p): p is RouteWaypoint => p !== null);
      onResolved(found);
      if (!map || found.length === 0) return;
      if (found.length === 1) {
        // fitBounds on a single point zooms to the maximum the tiles allow,
        // which lands on a rooftop rather than on a mountain.
        map.setCenter(found[0]);
        map.setZoom(14);
        return;
      }
      const bounds = new google.maps.LatLngBounds();
      for (const point of found) bounds.extend(point);
      map.fitBounds(bounds, 64);
    });

    return () => {
      cancelled = true;
    };
    // routeName stands in for the route itself: the object is rebuilt on every
    // answer render, but a course is the same course while its name holds.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [places, map, routeName, centerLat, centerLng, placeName]);

  if (!resolved || resolved.length === 0) return null;

  return (
    <>
      {resolved.length >= 2 && (
        <Polyline
          path={resolved}
          strokeColor={SUGGESTION_COLOR}
          strokeOpacity={0}
          strokeWeight={3}
          icons={[
            {
              icon: { path: "M 0,-1 0,1", strokeOpacity: 0.9, strokeWeight: 3, scale: 1 },
              offset: "0",
              repeat: "10px",
            },
          ]}
        />
      )}
      {resolved.map((point, i) => (
        <AdvancedMarker key={`${point.name}-${i}`} position={point} title={point.name} zIndex={20}>
          <span
            className="rounded-full border-2 border-white px-1.5 py-0.5 text-[10px] font-medium text-white shadow"
            style={{ backgroundColor: SUGGESTION_COLOR }}
          >
            {point.name}
          </span>
        </AdvancedMarker>
      ))}
    </>
  );
}
