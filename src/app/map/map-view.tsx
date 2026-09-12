"use client";

import { useEffect, useRef, useState } from "react";
import {
  AdvancedMarker,
  CollisionBehavior,
  ControlPosition,
  Map,
  MapControl,
  Polyline,
  useMap,
  useMapsLibrary,
} from "@vis.gl/react-google-maps";
import type { TrackPoint } from "@/lib/gps/track";
import { getThumbnailUrl } from "@/lib/images/url";
import { isValidGps } from "@/lib/gps/validate";
import type { MapHike, MapLocation, PickedPoint } from "./map-shell";
import {
  ACTIVITY_COLOR,
  ACTIVITY_HAS_OWN_SPOT,
  ACTIVITY_LABEL,
  ACTIVITY_TYPES,
  MIXED_ACTIVITY_COLOR,
  folderMarkerColor,
} from "./activity";

// The home view: the whole peninsula, always the same frame. It is a fixed
// starting point rather than a fitBounds over the folders, so the map that
// greets everyone looks the same today as it will after fifty more outings.
const DEFAULT_CENTER = { lat: 36.5, lng: 127.8 };
const DEFAULT_ZOOM = 7;
const SINGLE_LOCATION_ZOOM = 11;
// Close enough to read the ridge an activity actually happened on.
const SPOT_ZOOM = 14;

// Past this the map's own labels carry the detail and our pills just cover
// them, so a marker keeps its dot but drops the name.
const LABEL_MAX_ZOOM = 12;

// Red says "this is the one you picked" and nothing else, which is why no
// activity colour is red.
const SELECTED_COLOR = "#D23B2E";
const PREVIEW_COLOR = "#4A6B52";

function toPath(track: TrackPoint[]) {
  return track.map(([lat, lng]) => ({ lat, lng }));
}

/** Frames the map: Korea at rest, then the open folder or selected activity. */
function Camera({
  locations,
  activeLocationId,
  selectedHike,
}: {
  locations: MapLocation[];
  activeLocationId: string | null;
  selectedHike: MapHike | null;
}) {
  const map = useMap();
  const core = useMapsLibrary("core");
  const appliedRef = useRef<string>("");

  useEffect(() => {
    if (!map || !core) return;

    // A refetch (a photo upload, a rename) hands back new objects holding the
    // same coordinates. Without this the map would snap back to its framing
    // every time, throwing away wherever the viewer had panned to.
    // The track length is part of the key so a freshly uploaded GPX reframes.
    const key = selectedHike
      ? "h:" +
        selectedHike.id +
        ":" +
        (selectedHike.track?.length ?? 0) +
        ":" +
        selectedHike.photos.length
      : activeLocationId
        ? "l:" + activeLocationId
        : "root";
    if (appliedRef.current === key) return;
    appliedRef.current = key;

    if (!activeLocationId && !selectedHike) {
      map.setCenter(DEFAULT_CENTER);
      map.setZoom(DEFAULT_ZOOM);
      return;
    }

    // A route wins: frame the whole track so the red line is visible end to end.
    if (selectedHike?.track && selectedHike.track.length >= 2) {
      const bounds = new core.LatLngBounds();
      for (const [lat, lng] of selectedHike.track) bounds.extend({ lat, lng });
      map.fitBounds(bounds, 64);
      return;
    }

    // No route, but the photos know where they were taken: frame those instead.
    // This is what the old photo-derived polyline was really showing, minus the
    // claim that the straight lines between them were a path.
    const geotagged = selectedHike
      ? selectedHike.photos.filter((p) => isValidGps(p.exifLat, p.exifLng))
      : [];
    if (geotagged.length > 0) {
      const bounds = new core.LatLngBounds();
      for (const photo of geotagged) {
        bounds.extend({ lat: photo.exifLat as number, lng: photo.exifLng as number });
      }
      // A single photo gives a zero-size box, which fitBounds resolves to the
      // maximum zoom - so place it by hand at a readable one instead.
      if (geotagged.length === 1) {
        map.setCenter(bounds.getCenter());
        map.setZoom(SPOT_ZOOM);
      } else {
        map.fitBounds(bounds, 64);
      }
      return;
    }

    // Nothing geotagged, but the activity has a point of its own: stand on it.
    if (
      selectedHike &&
      selectedHike.lat != null &&
      selectedHike.lng != null &&
      ACTIVITY_HAS_OWN_SPOT[selectedHike.activityType]
    ) {
      map.setCenter({ lat: selectedHike.lat, lng: selectedHike.lng });
      map.setZoom(SPOT_ZOOM);
      return;
    }

    const active = locations.find((l) => l.id === activeLocationId);
    if (active) {
      map.setCenter({ lat: active.lat, lng: active.lng });
      map.setZoom(SINGLE_LOCATION_ZOOM);
    }
  }, [map, core, locations, activeLocationId, selectedHike]);

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
        className="relative rounded-full border-2 border-white shadow"
        style={{
          backgroundColor: color,
          width: emphasised ? 14 : 11,
          height: emphasised ? 14 : 11,
        }}
      >
        <span className="absolute -inset-3 md:hidden" aria-hidden="true" />
      </span>
      {showLabel && (
        <span className="whitespace-nowrap rounded bg-white/90 px-1 py-0.5 text-[11px] font-medium text-neutral-900 shadow-sm">
          {label}
        </span>
      )}
    </div>
  );
}

/**
 * The selected activity's own GPS point. Deliberately a pin rather than a dot:
 * the dots answer "what is here", this one answers "this is the one you opened,
 * and it happened exactly here".
 */
function SelectedPin({ label }: { label: string }) {
  return (
    <div className="flex cursor-pointer flex-col items-center">
      <span className="mb-0.5 whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-medium text-white shadow"
        style={{ backgroundColor: SELECTED_COLOR }}
      >
        {label}
      </span>
      {/* The tip sits on the coordinate: AdvancedMarker anchors bottom-centre. */}
      <svg width="24" height="32" viewBox="0 0 24 32" aria-hidden="true">
        <path
          d="M12 31C12 31 2 18.5 2 11.5a10 10 0 1 1 20 0C22 18.5 12 31 12 31Z"
          fill={SELECTED_COLOR}
          stroke="#ffffff"
          strokeWidth="2"
        />
        <circle cx="12" cy="11.5" r="3.6" fill="#ffffff" />
      </svg>
    </div>
  );
}

/**
 * A photo where it was taken.
 *
 * This replaced a polyline drawn through the same points. That line joined
 * wherever somebody stopped to shoot, in time order, which looked like a route
 * and was not one - a summit shot followed by a trailhead shot drew a straight
 * line through the mountain. The pictures say where the day went without
 * claiming a path nobody walked.
 */
function PhotoPin({ storageKey, alt }: { storageKey: string; alt: string }) {
  return (
    <span className="block cursor-pointer overflow-hidden rounded border-2 border-white bg-neutral-200 shadow-md">
      {/* Reuses the 400px thumbnail the photo grid already generated, shown
          small. A dedicated marker size would be a second Cloudflare Images
          transformation per photo, billed monthly, to save a few KB. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={getThumbnailUrl(storageKey)}
        alt={alt}
        loading="lazy"
        className="h-11 w-11 object-cover"
      />
    </span>
  );
}

type MapTypeChoice = "roadmap" | "hybrid";

const MAP_TYPES: { id: MapTypeChoice; label: string }[] = [
  { id: "roadmap", label: "지도" },
  { id: "hybrid", label: "위성" },
];

/** Stands in for the stock 지도/위성 switcher. "hybrid" rather than "satellite"
    so place names stay on the imagery - finding mountains by name is the point. */
function MapTypeToggle() {
  const map = useMap();
  const [mapType, setMapType] = useState<MapTypeChoice>("roadmap");

  return (
    <div className="m-2 flex overflow-hidden rounded border border-neutral-300 bg-white text-xs shadow-sm">
      {MAP_TYPES.map(({ id, label }) => (
        <button
          key={id}
          type="button"
          onClick={() => {
            if (!map) return;
            map.setMapTypeId(id);
            setMapType(id);
          }}
          className={
            "border-l border-neutral-300 px-3 py-1.5 first:border-l-0 md:px-2.5 md:py-1 " +
            (mapType === id
              ? "bg-neutral-900 text-white"
              : "text-neutral-700 hover:bg-neutral-50")
          }
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/** Four colours mean nothing without a key, so the map carries its own. */
function ActivityLegend() {
  return (
    <div className="m-2 hidden flex-wrap items-center gap-x-2.5 gap-y-1 rounded border border-neutral-300 bg-white/90 px-2 py-1 text-[11px] text-neutral-700 shadow-sm md:flex">
      {ACTIVITY_TYPES.map((type) => (
        <span key={type} className="flex items-center gap-1">
          <span
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: ACTIVITY_COLOR[type] }}
          />
          {ACTIVITY_LABEL[type]}
        </span>
      ))}
      <span className="flex items-center gap-1">
        <span
          className="h-2 w-2 rounded-full"
          style={{ backgroundColor: MIXED_ACTIVITY_COLOR }}
        />
        여러 활동
      </span>
    </div>
  );
}

export function MapView({
  mapId,
  locations,
  activeLocationId,
  selectedHike,
  hoveredHike,
  onSelectLocation,
  onSelectHike,
  onSelectPhoto,
  onCollapseMap,
  picking,
  pickedPoint,
  onPickPoint,
}: {
  mapId: string;
  locations: MapLocation[];
  activeLocationId: string | null;
  selectedHike: MapHike | null;
  hoveredHike: MapHike | null;
  onSelectLocation: (locationId: string) => void;
  onSelectHike: (hike: MapHike) => void;
  onSelectPhoto: (photoId: string) => void;
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
    hoveredHike && hoveredHike.id !== selectedHike?.id && hoveredHike.track?.length
      ? hoveredHike.track
      : null;

  const activeLocation = locations.find((l) => l.id === activeLocationId) ?? null;
  // Individual peaks/routes stay hidden until their mountain is opened -
  // otherwise every outing piles onto the same spot at country zoom. Gym and
  // artificial-wall sessions never get one: their point is the venue, so the
  // marker would land on top of the folder's.
  const spotHikes = activeLocation
    ? activeLocation.hikes.filter(
        (h) => ACTIVITY_HAS_OWN_SPOT[h.activityType] && h.lat != null && h.lng != null,
      )
    : [];

  // Where the red pin goes, if anywhere.
  const selectedSpot =
    selectedHike &&
    ACTIVITY_HAS_OWN_SPOT[selectedHike.activityType] &&
    selectedHike.lat != null &&
    selectedHike.lng != null
      ? { lat: selectedHike.lat, lng: selectedHike.lng }
      : null;

  // Only the open activity's photos, and only those the camera actually
  // geotagged - most phones do, a scanned or stripped file does not.
  const photoPins = selectedHike
    ? selectedHike.photos.filter((p) => isValidGps(p.exifLat, p.exifLng))
    : [];

  // A gym session, or an activity nobody has placed yet, has no point of its
  // own. Rather than leave the click with no answer on the map, the folder's
  // own marker turns red and stands in for it.
  const selectedFolderId = selectedHike && !selectedSpot ? selectedHike.locationId : null;

  return (
    <Map
      mapId={mapId}
      defaultCenter={DEFAULT_CENTER}
      defaultZoom={DEFAULT_ZOOM}
      gestureHandling="greedy"
      disableDefaultUI={false}
      mapTypeControl={false}
      className="h-full w-full"
      onZoomChanged={(event) => setZoom(event.detail.zoom)}
      onClick={(event) => {
        if (!picking) return;
        const latLng = event.detail.latLng;
        if (latLng) onPickPoint({ lat: latLng.lat, lng: latLng.lng });
      }}
    >
      {/* A real map control, so Google spaces it within its own stack rather
          than letting it land on top of another control. */}
      <MapControl position={ControlPosition.LEFT_BOTTOM}>
        <button
          type="button"
          onClick={onCollapseMap}
          className="m-2 hidden rounded border border-neutral-300 bg-white px-2.5 py-1 text-xs text-neutral-700 shadow-sm hover:bg-neutral-50 md:block"
        >
          지도 접기
        </button>
      </MapControl>

      {/* Top-left is where the stock switcher sat, and it stays clear of the
          fullscreen (top-right) and 지도 접기 (left-bottom) controls. */}
      <MapControl position={ControlPosition.TOP_LEFT}>
        <MapTypeToggle />
      </MapControl>

      <MapControl position={ControlPosition.RIGHT_BOTTOM}>
        <ActivityLegend />
      </MapControl>

      <Camera
        locations={locations}
        activeLocationId={activeLocationId}
        selectedHike={selectedHike}
      />

      {previewTrack && (
        <Polyline
          path={toPath(previewTrack)}
          strokeColor={PREVIEW_COLOR}
          strokeOpacity={0.85}
          strokeWeight={3}
        />
      )}

      {selectedHike?.track && selectedHike.track.length >= 2 && (
        <Polyline
          path={toPath(selectedHike.track)}
          strokeColor={SELECTED_COLOR}
          strokeOpacity={1}
          strokeWeight={5}
        />
      )}

      {pickedPoint && (
        <AdvancedMarker position={pickedPoint} title="새 장소 위치">
          <Dot color={SELECTED_COLOR} label="새 장소" showLabel emphasised />
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
            color={
              location.id === selectedFolderId
                ? SELECTED_COLOR
                : folderMarkerColor(location.hikes.map((h) => h.activityType))
            }
            label={location.name}
            showLabel={showLabels}
            emphasised={location.id === activeLocationId}
          />
        </AdvancedMarker>
      ))}

      {spotHikes
        .filter((hike) => hike.id !== selectedHike?.id)
        .map((hike) => (
          <AdvancedMarker
            key={hike.id}
            position={{ lat: hike.lat as number, lng: hike.lng as number }}
            title={hike.title}
            onClick={() => onSelectHike(hike)}
          >
            <Dot
              color={ACTIVITY_COLOR[hike.activityType]}
              label={hike.title}
              showLabel
              emphasised={false}
            />
          </AdvancedMarker>
        ))}

      {selectedSpot && selectedHike && (
        <AdvancedMarker position={selectedSpot} title={selectedHike.title}>
          <SelectedPin label={selectedHike.title} />
        </AdvancedMarker>
      )}

      {photoPins.map((photo) => (
        <AdvancedMarker
          key={photo.id}
          position={{ lat: photo.exifLat as number, lng: photo.exifLng as number }}
          title={photo.uploaderName + "님이 올린 사진"}
          zIndex={1}
          // Two hundred photos from one hike would be an unreadable pile at any
          // zoom that fits the mountain. Letting the Maps API drop overlapping
          // pins and reveal them on zoom does the thinning for us, with no
          // clustering library and no arbitrary cap.
          collisionBehavior={CollisionBehavior.OPTIONAL_AND_HIDES_LOWER_PRIORITY}
          onClick={() => onSelectPhoto(photo.id)}
        >
          <PhotoPin
            storageKey={photo.storageKey}
            alt={photo.uploaderName + "님이 올린 사진"}
          />
        </AdvancedMarker>
      ))}
    </Map>
  );
}
