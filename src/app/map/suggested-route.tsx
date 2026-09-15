"use client";

import { useEffect, useState } from "react";
import { AdvancedMarker, CollisionBehavior, Polyline, useMap, useMapsLibrary } from "@vis.gl/react-google-maps";
import type { RouteSuggestion } from "@/lib/assistant/routes";
import type { RouteWaypoint } from "./route-album-actions";
import { loadClubPois, snapSuggestedRoute } from "./route-actions";
import { findClubPoi, isUsableWaypoint, SAME_PLACE_M, type ClubPoi } from "@/lib/routes/poi";
import { recoverFromStaleDeployment } from "../stale-deployment";
import { dropOutlierWaypoints, type RouteLeg } from "@/lib/routes/snap";
import type { TrackPoint } from "@/lib/gps/track";
import { haversineDistanceMeters } from "@/lib/gps/haversine";

// The outdoor layer draws its own paths in red-brown dashes over brown
// contours, and the club burgundy this used to be sank straight into them.
// Violet appears nowhere on that map - not in the water blue, the forest
// green or the path brown - so the suggested line reads as ours at a glance.
const SUGGESTION_COLOR = "#6B21A8";
// Drawn underneath and thicker: a casing is what keeps a thin line legible
// over a busy topographic map, and white is the one shade the layer never uses
// for anything but paper.
const SUGGESTION_CASING = "#FFFFFF";

/**
 * How many named waypoints are looked up per course.
 *
 * Every lookup is a billed Places request, so this is a spend ceiling as much
 * as a layout one. Keep all of the assistant's up-to-twelve waypoints so
 * skipping a named junction does not silently change the course.
 */
const MAX_LOOKUPS = 12;

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
 * Drops a waypoint that resolved to where the one before it already is.
 *
 * Gates on 북한산 carry two names each - 위문 was renamed 백운봉암문 in 2015 -
 * and a course that names the summit between them reads 백운봉암문, 백운대,
 * 위문. Places answers 백운대 for 위문, so the course arrived with the summit
 * twice and a leg of exactly zero metres: two pins on one pixel, and a line
 * that appeared to stop at the top and restart somewhere else.
 *
 * Only consecutive ones. A real out-and-back returns to the gate it came
 * through, and that return is the course, not a duplicate.
 */
function collapseRepeats<T extends { lat: number; lng: number }>(points: T[]): T[] {
  return points.filter((point, i) => {
    if (i === 0) return true;
    const previous = points[i - 1];
    return haversineDistanceMeters(previous, point) > SAME_PLACE_M;
  });
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
 * The line between them is then pulled onto the real trails: the waypoints go
 * to OpenStreetMap, which knows where the paths are, and the route is walked
 * along them. A leg without connected trail geometry is left undrawn and
 * reported to the member instead of inventing a connection.
 * None of it is written to hikes.track, which stays for a real GPX or a
 * member's own tap-picked route.
 */
export function SuggestedRoute({
  route,
  center,
  placeName,
  resolved,
  onResolved,
  onMissing,
  onTrack,
  onTrailsUnavailable,
  pins,
}: {
  route: RouteSuggestion;
  center: { lat: number; lng: number } | null;
  /** The mountain, used to disambiguate a waypoint when there is no centre to
      bias toward - which is the usual case for a place the club has never
      been to, and exactly when the names are most ambiguous. */
  placeName: string;
  resolved: RouteWaypoint[] | null;
  onResolved: (points: RouteWaypoint[]) => void;
  /** Names this course could not place, handed up so the shell can offer to
      record one. Reported from here because this is where the lookups happen. */
  onMissing: (names: string[]) => void;
  /** The drawn line, handed up so an album made from this course can keep it.
      Null while it is still being worked out, or when any leg is unmapped. */
  onTrack: (track: TrackPoint[] | null) => void;
  /** True when any part of the course cannot be resolved onto mapped trails. */
  onTrailsUnavailable: (unavailable: boolean) => void;
  /** False once an album is open: then the line is the subject and labels for
      places the reader is no longer choosing between only cover it. */
  pins: boolean;
}) {
  const places = useMapsLibrary("places");
  const map = useMap();
  const centerLat = center?.lat;
  const centerLng = center?.lng;
  const routeName = route.name;
  const waypoints = route.waypoints;
  const waypointKey = waypoints.join("\u0001");
  const [legs, setLegs] = useState<RouteLeg[] | null>(null);

  useEffect(() => {
    if (!places || waypoints.length === 0) return;
    let cancelled = false;
    // Cleared for the new course. Without this the previous course's legs stay
    // on screen - drawn against the new course's waypoints - for the seconds
    // the lookup and the snap take.
    setLegs(null);
    onTrack(null);
    onTrailsUnavailable(false);

    async function resolveOne(name: string, pois: ClubPoi[]): Promise<RouteWaypoint | null> {
      // The club's own gazetteer first. These names are local usage - 해골바위,
      // 밤골, 깔딱고개 - and a search engine has no reliable answer for them,
      // so a point a member recorded outranks anything a lookup returns.
      const known = findClubPoi(name, pois);
      if (known) return { name, lat: known.lat, lng: known.lng };

      const cacheKey = `${placeName}:${centerLat ?? ""}:${centerLng ?? ""}:${name}`;
      const cached = cache.get(cacheKey);
      if (cached !== undefined) return cached;

      const bias = centerLat != null && centerLng != null
        ? { locationBias: { center: { lat: centerLat, lng: centerLng }, radius: 20000 } }
        : {};

      /** The first result that is a place on a mountain rather than a way in. */
      async function search(textQuery: string) {
        const { places: found } = await places!.Place.searchByText({
          textQuery,
          // types costs nothing extra: location already puts this on the Pro
          // SKU, which is billed per request rather than per field or result.
          fields: ["location", "types", "displayName"],
          language: "ko",
          region: "KR",
          // Asked five deep rather than one so that rejecting a station leaves
          // something to fall back on; the real place is usually right behind it.
          maxResultCount: 5,
          ...bias,
        });
        // Places always answers with its best guess and never says how good it
        // was: asked for 밤골탐방지원센터, which it does not carry, it returned
        // 북한산성탐방지원센터 on the far side of the ridge.
        return found.find((place) =>
          isUsableWaypoint(name, place.displayName ?? "", place.types ?? [], placeName));
      }

      try {
        // 관음사 and 사당역 exist in several cities, so without a centre to
        // bias toward, the mountain's name has to carry the disambiguation.
        let best = await search(`${placeName} ${name}`.trim());
        // That same prefix is what found the station: "북한산 보국문" matches
        // 북한산보국문역 exactly and the gate not at all. Asked plainly, Places
        // puts the gate first, so a name that turned up nothing but transit is
        // worth asking again without it.
        //
        // Asked whether or not the map has a centre to bias toward. Requiring
        // one read as caution and behaved as a silent drop: on a course opened
        // without a centre, 보국문 was rejected as a station, never asked again,
        // and vanished from the map entirely. A bare name can land in another
        // city, but that is what dropOutlierWaypoints is for, and a waypoint in
        // the wrong province is caught while a missing one is not.
        if (!best && placeName) best = await search(name);
        const location = best?.location;
        const point = location ? { name, lat: location.lat(), lng: location.lng() } : null;
        if (point) cache.set(cacheKey, point);
        return point;
      } catch (error) {
        console.error("[map/suggested-route] lookup failed", name, error);
        // Allow retries after transient API errors.
        return null;
      }
    }

    // An unresolved name is left out rather than guessed at: a pin in the
    // wrong place is worse than a course drawn without it, and the member can
    // put it on the map by hand once, after which it resolves from our table.
    loadClubPois()
      .catch(() => [] as ClubPoi[])
      .then((pois) => Promise.all(thin(waypoints).map((name) => resolveOne(name, pois))))
      .then((points) => {
      if (cancelled) return;
      // A name can resolve to the wrong place entirely - 해골바위 on 숨은벽
      // came back on the far side of 북한산 - and one bad lookup dragged the
      // whole course into a straight line across the massif. Dropping it here
      // rather than server-side keeps its pin off the map too.
      const found = dropOutlierWaypoints(collapseRepeats(points.flatMap((point) => point ? [point] : [])));
      const placed = new Set(found.map((p) => p.name));
      // Reported rather than swallowed: these are the local terms - 해골바위,
      // 밤골 - that a member can fix once by hand, and they cannot do that if
      // the course simply appears one waypoint short. The shell owns the
      // notice so it sits with the button that acts on it.
      onMissing(thin(waypoints).filter((name) => !placed.has(name)));
      onResolved(found);
      if (!map || found.length === 0) { onTrailsUnavailable(true); return; }
      if (found.length === 1) {
        onTrailsUnavailable(true);
        // fitBounds on a single point zooms to the maximum the tiles allow,
        // which lands on a rooftop rather than on a mountain.
        map.setCenter(found[0]);
        map.setZoom(14);
        return;
      }
      const bounds = new google.maps.LatLngBounds();
      for (const point of found) bounds.extend(point);
      map.fitBounds(bounds, 64);

      // Show a line only once the mapped trail geometry has been resolved.
      snapSuggestedRoute(found.map(({ lat, lng }) => ({ lat, lng })))
        .then((snapped) => {
          if (cancelled) return;
          // A leg that spans a waypoint we could not place is still drawn.
          //
          // 해골바위 is not on any map, and blanking the leg it sits in erased
          // the whole 밤골 approach - four kilometres of mapped trail thrown
          // away for one name. Local usage names a great many features no
          // gazetteer carries, so that rule would keep deleting the longest
          // and most useful part of a course. The trail between the two ends
          // is real either way, and the notice beside the map already says
          // which name went unplaced and offers to record it.
          setLegs(snapped.legs);
          // Only a course mapped end to end is offered as a track: a partial
          // one saved into the column the map draws as "the route" would read
          // as the whole of it.
          const whole = snapped.legs.length > 0 && snapped.legs.every((leg) => leg.onTrail);
          onTrack(whole ? snapped.legs.flatMap((leg) => leg.points) : null);
          onTrailsUnavailable(!snapped.trailsLoaded || snapped.legs.some((leg) => !leg.onTrail));
        })
        .catch((error) => {
          if (cancelled) return;
          // A tab open across a deploy asks for an action id that is gone, and
          // the only symptom is a course that draws nothing.
          if (recoverFromStaleDeployment(error)) return;
          setLegs([]);
          onTrailsUnavailable(true);
          console.error("[map/suggested-route] snapping failed", error);
        });
    });

    return () => {
      cancelled = true;
    };
    // Depend on the course content, not the object rebuilt by answer renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [places, map, routeName, waypointKey, centerLat, centerLng, placeName]);

  if (!resolved || resolved.length === 0) return null;

  // Missing geometry stays invisible rather than cutting across the mountain.
  const drawn = (legs ?? []).filter((leg) => leg.onTrail && leg.points.length >= 2);

  return (
    <>
      {drawn.flatMap((leg, i) => {
        const path = leg.points.map(([lat, lng]) => ({ lat, lng }));
        return [
          // Casing first so the coloured line sits on top of it.
          //
          // Both carry a z-index above the satellite trail overlay. Polylines
          // without one stack in creation order, and the overlay asked for 1,
          // which put every yellow trail on the map over the course the member
          // came to look at.
          <Polyline
            key={`casing-${i}`}
            path={path}
            strokeColor={SUGGESTION_CASING}
            strokeOpacity={0.95}
            strokeWeight={8}
            zIndex={10}
          />,
          // Only connected mapped geometry is drawn.
          <Polyline
            key={`leg-${i}-${leg.onTrail}`}
            path={path}
            strokeColor={SUGGESTION_COLOR}
            strokeOpacity={1}
            strokeWeight={4}
            zIndex={11}
          />,
        ];
      })}
      {/* The two ends, and only while the course is what is being looked at.
          Every waypoint used to get a label, which at the zoom a whole course
          fits into is a row of violet pills lying across the line they are
          describing - and the line is the thing worth seeing. Where it starts
          and where it comes out are what a reader needs; the rest is on the
          card beside the map. */}
      {pins && (resolved.length === 1 ? [resolved[0]] : [resolved[0], resolved[resolved.length - 1]]).map((point, i) => (
        <AdvancedMarker
          key={`${point.name}-${i}`}
          position={point}
          title={point.name}
          zIndex={20}
          collisionBehavior={CollisionBehavior.REQUIRED_AND_HIDES_OPTIONAL}
        >
          <span
            className="rounded-full border border-white/90 px-1.5 py-px text-[9px] font-semibold leading-tight text-white shadow"
            style={{ backgroundColor: SUGGESTION_COLOR }}
          >
            {point.name}
          </span>
        </AdvancedMarker>
      ))}
    </>
  );
}
