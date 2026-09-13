"use client";

import { useEffect, useState } from "react";
import {
  AdvancedMarker,
  APIProvider,
  Map,
  Polyline,
  useMap,
  useMapsLibrary,
} from "@vis.gl/react-google-maps";
import type { RouteSuggestion } from "@/lib/assistant/routes";

const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
const mapId = process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID || "DEMO_MAP_ID";

// One colour per route so several suggested courses stay tellable apart on the
// same map. Deliberately none of these is the red the interactive map at
// /map reserves for a saved, walked route.
const ROUTE_COLORS = ["#3D6E86", "#C4622D", "#7A4F79", "#3F7D5C"];

interface GeocodedWaypoint {
  name: string;
  lat: number;
  lng: number;
}

/**
 * Turns each route's named waypoints into map pins, entirely in the browser -
 * using the Geocoding library through the same referrer-restricted key
 * already loaded for the site's own map, rather than a second server-side
 * key. The place-picking search box elsewhere in the app makes the same
 * choice, for the same reason: this key is meant for the browser.
 *
 * Waypoints geocode by name alone and can land on the wrong same-named spot
 * (a common station or peak name repeated across the country); this is a
 * sketch of where a suggestion goes, not a surveyed route, and is styled and
 * labelled as one - it is never written to hikes.track, which stays for a
 * real GPX file or a member's own tap-to-pick selection on /map.
 */
function GeocodedRoutes({ routes, center }: { routes: RouteSuggestion[]; center: { lat: number; lng: number } }) {
  const geocoding = useMapsLibrary("geocoding");
  const map = useMap();
  const [byRoute, setByRoute] = useState<GeocodedWaypoint[][]>([]);

  useEffect(() => {
    if (!geocoding) return;
    let cancelled = false;
    const geocoder = new geocoding.Geocoder();
    // A plain object rather than the built-in Map collection: that name is
    // already the imported <Map> map component in this file, and shadowing it
    // turns `new Map()` into an attempt to construct a React component.
    const cache: Record<string, GeocodedWaypoint | null> = {};

    async function resolve(name: string): Promise<GeocodedWaypoint | null> {
      if (name in cache) return cache[name];
      try {
        // Biased toward the mountain's own name so a common station name
        // (사당역 exists in more than one city) resolves near it rather than
        // wherever else that name occurs.
        const { results } = await geocoder.geocode({
          address: name,
          bounds: new google.maps.LatLngBounds(
            { lat: center.lat - 0.15, lng: center.lng - 0.15 },
            { lat: center.lat + 0.15, lng: center.lng + 0.15 },
          ),
        });
        const first = results[0];
        const point = first
          ? { name, lat: first.geometry.location.lat(), lng: first.geometry.location.lng() }
          : null;
        cache[name] = point;
        return point;
      } catch {
        cache[name] = null;
        return null;
      }
    }

    Promise.all(
      routes.map((route) => Promise.all(route.waypoints.map(resolve))),
    ).then((resolved) => {
      if (cancelled) return;
      const points = resolved.map((points) =>
        points.filter((p): p is GeocodedWaypoint => p !== null),
      );
      setByRoute(points);

      if (map && points.some((p) => p.length > 0)) {
        const bounds = new google.maps.LatLngBounds();
        for (const routePoints of points) {
          for (const p of routePoints) bounds.extend(p);
        }
        map.fitBounds(bounds, 48);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [geocoding, routes, map, center.lat, center.lng]);

  return (
    <>
      {byRoute.map((points, i) => {
        const color = ROUTE_COLORS[i % ROUTE_COLORS.length];
        return (
          <div key={i}>
            {points.length >= 2 && (
              <Polyline
                path={points}
                strokeColor={color}
                strokeOpacity={0.8}
                strokeWeight={3}
                icons={[{ icon: { path: "M 0,-1 0,1", strokeOpacity: 1 }, offset: "0", repeat: "12px" }]}
              />
            )}
            {points.map((p, j) => (
              <AdvancedMarker key={`${i}-${j}`} position={p} title={p.name}>
                <span
                  className="flex items-center gap-1 rounded-full border-2 border-white px-1.5 py-0.5 text-[10px] font-medium text-white shadow"
                  style={{ backgroundColor: color }}
                >
                  {p.name}
                </span>
              </AdvancedMarker>
            ))}
          </div>
        );
      })}
    </>
  );
}

export function RouteMap({
  routes,
  center,
}: {
  routes: RouteSuggestion[];
  center: { lat: number; lng: number };
}) {
  if (!apiKey) return null;

  return (
    <div className="mt-3 overflow-hidden rounded-lg border border-neutral-200">
      <APIProvider apiKey={apiKey} language="ko" region="KR">
        <div style={{ height: 220 }}>
          <Map
            mapId={mapId}
            defaultCenter={center}
            defaultZoom={12}
            gestureHandling="greedy"
            disableDefaultUI
          >
            <GeocodedRoutes routes={routes} center={center} />
          </Map>
        </div>
      </APIProvider>
      <p className="border-t border-neutral-100 bg-neutral-50 px-2 py-1 text-[10px] text-neutral-500">
        점선은 AI가 추정한 경로입니다 (참고용). 실제 경로는 활동에서 GPX를 올리거나 지도에서
        등산로를 직접 선택해 등록해주세요.
      </p>
    </div>
  );
}
