"use client";

import { useEffect, useState } from "react";
import {
  AdvancedMarker,
  ControlPosition,
  Map,
  MapControl,
  Polyline,
  useMap,
  useMapsLibrary,
} from "@vis.gl/react-google-maps";
import type { TrackPoint } from "@/lib/gps/track";
import type { MapHike, MapLocation, PickedPoint } from "./map-shell";
import { TYPE_COLOR } from "./side-panel";

// Fallback view (roughly the Korean peninsula) before fitBounds kicks in.
const DEFAULT_CENTER = { lat: 36.5, lng: 127.8 };
const DEFAULT_ZOOM = 6;
const SINGLE_LOCATION_ZOOM = 11;

// Past this the map's own labels carry the detail and our pills just cover
// them, so a marker keeps its dot but drops the name.
const LABEL_MAX_ZOOM = 12;

const PINNED_COLOR = "#D23B2E";
const PREVIEW_COLOR = "#4A6B52";

function toPath(track: TrackPoint[]) {
  return track.map(([lat, lng]) => ({ lat, lng }));
}

/** Frames the map: all markers at first, then the open location or route. */
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

/** A small dot with an optional name tag beside it. */
function Dot({
  color,
  label,
  showLabel,
  emphasised,
}: {
  color: string;
  label: string;
  showLabel: boolean;
  emphasised: boolean;
}) {
  return (
    <div className="flex cursor-pointer items-center gap-1">
      <span
        className="rounded-full border-2 border-white shadow"
        style={{
          backgroundColor: color,
          width: emphasised ? 14 : 11,
          height: emphasised ? 14 : 11,
        }}
      />
      {showLabel && (
        <span className="whitespace-nowrap rounded bg-white/90 px-1 py-0.5 text-[11px] font-medium text-neutral-900 shadow-sm">
          {label}
        </span>
      )}
    </div>
  );
}

export function MapView({
  mapId,
  locations,
  activeLocationId,
  pinnedHike,
  hoveredHike,
  onSelectLocation,
  onSelectHike,
  onCollapseMap,
  picking,
  pickedPoint,
  onPickPoint,
}: {
  mapId: string;
  locations: MapLocation[];
  activeLocationId: string | null;
  pinnedHike: MapHike | null;
  hoveredHike: MapHike | null;
  onSelectLocation: (locationId: string) => void;
  onSelectHike: (hike: MapHike) => void;
  onCollapseMap: () => void;
  picking: boolean;
  pickedPoint: PickedPoint | null;
  onPickPoint: (point: PickedPoint) => void;
}) {
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const showLabels = zoom <= LABEL_MAX_ZOOM;

  // Only preview a hover when it isn't already the pinned route, so the two
  // styles never stack on the same line.
  const previewTrack =
    hoveredHike && hoveredHike.id !== pinnedHike?.id && hoveredHike.track?.length
      ? hoveredHike.track
      : null;

  const activeLocation = locations.find((l) => l.id === activeLocationId) ?? null;
  // Individual peaks/routes stay hidden until their mountain is opened -
  // otherwise every outing piles onto the same spot at country zoom.
  const spotHikes = activeLocation
    ? activeLocation.hikes.filter((h) => h.lat != null && h.lng != null)
    : [];

  return (
    <Map
      mapId={mapId}
      defaultCenter={DEFAULT_CENTER}
      defaultZoom={DEFAULT_ZOOM}
      gestureHandling="greedy"
      disableDefaultUI={false}
      className="h-full w-full"
      onZoomChanged={(event) => setZoom(event.detail.zoom)}
      onClick={(event) => {
        if (!picking) return;
        const latLng = event.detail.latLng;
        if (latLng) onPickPoint({ lat: latLng.lat, lng: latLng.lng });
      }}
    >
      {/* Rendered as a real map control so Google lays it out in its own
          stack instead of it landing on top of the map/satellite toggle. */}
      <MapControl position={ControlPosition.LEFT_BOTTOM}>
        <button
          type="button"
          onClick={onCollapseMap}
          className="m-2 rounded border border-neutral-300 bg-white px-2.5 py-1 text-xs text-neutral-700 shadow-sm hover:bg-neutral-50"
        >
          지도 접기
        </button>
      </MapControl>

      <Camera locations={locations} activeLocationId={activeLocationId} pinnedHike={pinnedHike} />

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

      {pickedPoint && (
        <AdvancedMarker position={pickedPoint} title="새 장소 위치">
          <Dot color={PINNED_COLOR} label="새 장소" showLabel emphasised />
        </AdvancedMarker>
      )}

      {locations.map((location) => (
        <AdvancedMarker
          key={location.id}
          position={{ lat: location.lat, lng: location.lng }}
          title={location.name}
          onClick={() => onSelectLocation(location.id)}
        >
          <Dot
            color={TYPE_COLOR[location.type]}
            label={location.name}
            showLabel={showLabels}
            emphasised={location.id === activeLocationId}
          />
        </AdvancedMarker>
      ))}

      {spotHikes.map((hike) => (
        <AdvancedMarker
          key={hike.id}
          position={{ lat: hike.lat as number, lng: hike.lng as number }}
          title={hike.title}
          onClick={() => onSelectHike(hike)}
        >
          <Dot
            color={hike.id === pinnedHike?.id ? PINNED_COLOR : PREVIEW_COLOR}
            label={hike.title}
            showLabel
            emphasised={hike.id === pinnedHike?.id}
          />
        </AdvancedMarker>
      ))}
    </Map>
  );
}
