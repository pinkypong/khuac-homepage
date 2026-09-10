"use client";

import { useEffect } from "react";
import {
  AdvancedMarker,
  APIProvider,
  Map,
  Polyline,
  useMap,
  useMapsLibrary,
} from "@vis.gl/react-google-maps";
import type { TrackPoint } from "@/lib/gps/track";
import type { MapHike, MapLocation } from "./map-shell";
import { TYPE_COLOR } from "./side-panel";

// Fallback view (roughly the Korean peninsula) before fitBounds kicks in.
const DEFAULT_CENTER = { lat: 36.5, lng: 127.8 };
const DEFAULT_ZOOM = 6;
const SINGLE_LOCATION_ZOOM = 11;

const PINNED_COLOR = "#D23B2E";
const PREVIEW_COLOR = "#4A6B52";

function toPath(track: TrackPoint[]) {
  return track.map(([lat, lng]) => ({ lat, lng }));
}

/**
 * Frames the map: all markers at first, then the selected location or route.
 */
function Camera({
  locations,
  activeLocationId,
  pinnedHike,
}: {
  locations: MapLocation[];
  activeLocationId: string | null;
  pinnedHike: MapHike | null;
}) {
  const map = useMap();
  const core = useMapsLibrary("core");

  useEffect(() => {
    if (!map || !core) return;

    // A pinned route wins: frame the whole track so the red line is visible.
    if (pinnedHike?.track && pinnedHike.track.length >= 2) {
      const bounds = new core.LatLngBounds();
      for (const [lat, lng] of pinnedHike.track) bounds.extend({ lat, lng });
      map.fitBounds(bounds, 64);
      return;
    }

    const active = locations.find((l) => l.id === activeLocationId);
    if (active) {
      map.setCenter({ lat: active.lat, lng: active.lng });
      map.setZoom(SINGLE_LOCATION_ZOOM);
      return;
    }

    if (locations.length === 0) return;
    if (locations.length === 1) {
      map.setCenter({ lat: locations[0].lat, lng: locations[0].lng });
      map.setZoom(SINGLE_LOCATION_ZOOM);
      return;
    }

    const bounds = new core.LatLngBounds();
    for (const location of locations) bounds.extend({ lat: location.lat, lng: location.lng });
    map.fitBounds(bounds, 64);
  }, [map, core, locations, activeLocationId, pinnedHike]);

  return null;
}

export function MapView({
  apiKey,
  mapId,
  locations,
  activeLocationId,
  pinnedHike,
  hoveredHike,
  onSelectLocation,
}: {
  apiKey: string;
  mapId: string;
  locations: MapLocation[];
  activeLocationId: string | null;
  pinnedHike: MapHike | null;
  hoveredHike: MapHike | null;
  onSelectLocation: (locationId: string) => void;
}) {
  // Only preview a hover when it isn't already the pinned route, so the two
  // styles never stack on the same line.
  const previewTrack =
    hoveredHike && hoveredHike.id !== pinnedHike?.id && hoveredHike.track?.length
      ? hoveredHike.track
      : null;

  return (
    <APIProvider apiKey={apiKey}>
      <Map
        mapId={mapId}
        defaultCenter={DEFAULT_CENTER}
        defaultZoom={DEFAULT_ZOOM}
        gestureHandling="greedy"
        disableDefaultUI={false}
        className="h-full w-full"
      >
        <Camera
          locations={locations}
          activeLocationId={activeLocationId}
          pinnedHike={pinnedHike}
        />

        {previewTrack && (
          <Polyline
            path={toPath(previewTrack)}
            strokeColor={PREVIEW_COLOR}
            strokeOpacity={0.85}
            strokeWeight={3}
          />
        )}

        {pinnedHike?.track && pinnedHike.track.length >= 2 && (
          <Polyline
            path={toPath(pinnedHike.track)}
            strokeColor={PINNED_COLOR}
            strokeOpacity={1}
            strokeWeight={5}
          />
        )}

        {locations.map((location) => (
          <AdvancedMarker
            key={location.id}
            position={{ lat: location.lat, lng: location.lng }}
            title={location.name}
            onClick={() => onSelectLocation(location.id)}
          >
            {/* Explicit colours: marker content sits outside the normal page
                flow, so it must not rely on inherited text colour. */}
            <div
              className="flex cursor-pointer items-center gap-1 rounded-full border bg-white px-2 py-1 text-xs font-medium text-neutral-900 shadow"
              style={{
                borderColor:
                  location.id === activeLocationId ? PINNED_COLOR : TYPE_COLOR[location.type],
                borderWidth: location.id === activeLocationId ? 2 : 1,
              }}
            >
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: TYPE_COLOR[location.type] }}
              />
              <span>{location.name}</span>
              {location.photoCount > 0 && (
                <span className="rounded-full bg-neutral-900 px-1.5 text-[10px] text-white">
                  {location.photoCount}
                </span>
              )}
            </div>
          </AdvancedMarker>
        ))}
      </Map>
    </APIProvider>
  );
}
