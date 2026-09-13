"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AdvancedMarker,
  InfoWindow,
  CollisionBehavior,
  ControlPosition,
  Map,
  MapControl,
  Polyline,
  useMap,
  useMapsLibrary,
} from "@vis.gl/react-google-maps";
import { groupPhotosByPosition } from "@/lib/gps/photo-groups";
import type { TrackPoint } from "@/lib/gps/track";
import { getThumbnailUrl } from "@/lib/images/url";
import { isValidGps } from "@/lib/gps/validate";
import type { MapHike, MapLocation, PickedPoint } from "./map-shell";
import type { TrailSegment } from "@/lib/routes/trails";
import { availableTileLayers, type TileLayer, type TileLayerId } from "./tile-layers";
import { SuggestedRoute } from "./suggested-route";
import type { RouteWaypoint } from "./route-album-actions";
import type { RouteSuggestion } from "@/lib/assistant/routes";
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
// Trail picking uses its own two colours: blue-grey reads as "offered" rather
// than as any of the activity colours, and amber as "you picked this" without
// borrowing the red that means a saved route.
const TRAIL_CANDIDATE_COLOR = "#5B7C99";
const TRAIL_CHOSEN_COLOR = "#D98C2B";

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

type MapTypeChoice = "roadmap" | "terrain" | "hybrid" | TileLayerId;

const GOOGLE_MAP_TYPES: { id: MapTypeChoice; label: string }[] = [
  { id: "roadmap", label: "지도" },
  { id: "terrain", label: "지형" },
  { id: "hybrid", label: "위성" },
];

/** Stands in for the stock 지도/위성 switcher. "hybrid" rather than "satellite"
    so place names stay on the imagery - finding mountains by name is the point.
    Third-party layers join the same row: once registered with the map's own
    type registry, switching to one is the same setMapTypeId call as the rest. */
function MapTypeToggle({ onLayerChange }: { onLayerChange: (layer: TileLayer | null) => void }) {
  const map = useMap();
  const layers = useMemo(() => availableTileLayers(), []);
  // The trail layer is what this club opens the map for, so it is both the
  // first button and the one already selected. Google's own roadmap stands in
  // only when no trail layer is configured.
  const defaultLayer = layers[0] ?? null;
  const [mapType, setMapType] = useState<MapTypeChoice>(defaultLayer?.id ?? "roadmap");
  const appliedDefault = useRef(false);

  useEffect(() => {
    if (!map || layers.length === 0) return;
    for (const layer of layers) {
      map.mapTypes.set(
        layer.id,
        new google.maps.ImageMapType({
          name: layer.label,
          tileSize: new google.maps.Size(256, 256),
          maxZoom: layer.maxZoom,
          getTileUrl: (point, zoom) => layer.tileUrl(point, zoom),
        }),
      );
    }
    // Applied here rather than as a <Map> prop: setMapTypeId only works once
    // the type is in the registry above. The ref keeps a later re-run from
    // yanking the map back after someone has switched away from it.
    if (defaultLayer && !appliedDefault.current) {
      appliedDefault.current = true;
      map.setMapTypeId(defaultLayer.id);
      onLayerChange(defaultLayer);
    }
  }, [map, layers, defaultLayer, onLayerChange]);

  // Trail layers first: the leftmost button is the one reached for most.
  const choices = [...layers.map(({ id, label }) => ({ id, label })), ...GOOGLE_MAP_TYPES];

  return (
    <div className="m-2 flex overflow-hidden rounded border border-neutral-300 bg-white text-xs shadow-sm">
      {choices.map(({ id, label }) => (
        <button
          key={id}
          type="button"
          onClick={() => {
            if (!map) return;
            map.setMapTypeId(id);
            setMapType(id);
            onLayerChange(layers.find((layer) => layer.id === id) ?? null);
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

/** Both providers require their attribution on screen while their tiles are,
    so this is tied to the active layer rather than left to a footer. */
function TileAttribution({ layer }: { layer: TileLayer }) {
  return (
    <span className="m-2 rounded bg-white/85 px-1.5 py-0.5 text-[10px] text-neutral-600 shadow-sm">
      {layer.attribution}
    </span>
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
  trailSegments,
  chosenTrailIds,
  onToggleTrail,
  suggestedRoute,
  onRouteResolved,
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
  trailSegments: TrailSegment[] | null;
  chosenTrailIds: number[];
  onToggleTrail: (id: number) => void;
  suggestedRoute: {
    route: RouteSuggestion;
    center: { lat: number; lng: number } | null;
    placeName: string;
    resolved: RouteWaypoint[] | null;
  } | null;
  onRouteResolved: (points: RouteWaypoint[]) => void;
}) {
  // The boolean rather than the zoom level itself: zoom fires continuously
  // while pinching, and storing the raw number re-rendered every marker on
  // every tick for a value only this one comparison ever read. Setting state
  // to the same boolean lets React bail out, so almost all ticks now cost
  // nothing.
  const [showLabels, setShowLabels] = useState(DEFAULT_ZOOM <= LABEL_MAX_ZOOM);
  const [openPhotoGroup, setOpenPhotoGroup] = useState<{hikeId:string;key:string}|null>(null);
  // Null while a Google base map is showing; those carry their own attribution.
  const [tileLayer, setTileLayer] = useState<TileLayer | null>(null);

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

  const photoGroups = groupPhotosByPosition(photoPins);
  const expandedGroup = openPhotoGroup?.hikeId === selectedHike?.id ? photoGroups.find(g=>g.key===openPhotoGroup?.key) : undefined;

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
      onZoomChanged={(event) => setShowLabels(event.detail.zoom <= LABEL_MAX_ZOOM)}
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
        <MapTypeToggle onLayerChange={setTileLayer} />
      </MapControl>

      <MapControl position={ControlPosition.RIGHT_BOTTOM}>
        <ActivityLegend />
      </MapControl>

      {tileLayer && (
        <MapControl position={ControlPosition.BOTTOM_LEFT}>
          <TileAttribution layer={tileLayer} />
        </MapControl>
      )}

      <Camera
        locations={locations}
        activeLocationId={activeLocationId}
        selectedHike={selectedHike}
      />

      {suggestedRoute && (
        <SuggestedRoute
          route={suggestedRoute.route}
          center={suggestedRoute.center}
          placeName={suggestedRoute.placeName}
          resolved={suggestedRoute.resolved}
          onResolved={onRouteResolved}
        />
      )}

      {previewTrack && (
        <Polyline
          path={toPath(previewTrack)}
          strokeColor={PREVIEW_COLOR}
          strokeOpacity={0.85}
          strokeWeight={3}
        />
      )}

      {/* Candidate paths from OpenStreetMap, drawn to be tapped. Unchosen ones
          stay faint so the mountain is still readable underneath; a chosen one
          goes solid and heavy so the route reads as a route while it is being
          assembled. */}
      {trailSegments?.map((segment) => {
        const order = chosenTrailIds.indexOf(segment.id);
        const chosen = order >= 0;
        return (
          <Polyline
            key={segment.id}
            path={toPath(segment.points)}
            strokeColor={chosen ? TRAIL_CHOSEN_COLOR : TRAIL_CANDIDATE_COLOR}
            strokeOpacity={chosen ? 1 : 0.55}
            strokeWeight={chosen ? 6 : 3}
            zIndex={chosen ? 3 : 1}
            clickable
            onClick={() => onToggleTrail(segment.id)}
          />
        );
      })}

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

      {photoGroups.map((group) => {
        const photo=group.photos[0];
        return <AdvancedMarker key={group.key} position={group.position}
          title={group.photos.length > 1 ? "같은 위치의 사진 " + group.photos.length + "장" : photo.uploaderName + "님이 올린 사진"}
          zIndex={2} collisionBehavior={CollisionBehavior.REQUIRED}
          onClick={() => {if(group.photos.length===1) onSelectPhoto(photo.id); else if(selectedHike) setOpenPhotoGroup({hikeId:selectedHike.id,key:group.key});}}>
          <div className={group.photos.length>1?"map-photo-stack":""}>
            <PhotoPin storageKey={photo.storageKey} alt={photo.uploaderName + "님이 올린 사진"}/>
            {group.photos.length>1 && <span className="map-photo-count">{group.photos.length}</span>}
          </div>
        </AdvancedMarker>;
      })}
      {expandedGroup && <InfoWindow position={expandedGroup.position} onCloseClick={()=>setOpenPhotoGroup(null)} headerContent={"같은 위치의 사진 " + expandedGroup.photos.length + "장"}>
        <div className="map-photo-picker">{expandedGroup.photos.map(photo=><button key={photo.id} onClick={()=>{setOpenPhotoGroup(null);onSelectPhoto(photo.id);}} aria-label={photo.uploaderName + "님 사진 크게 보기"}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={getThumbnailUrl(photo.storageKey)} alt={photo.uploaderName + "님이 올린 사진"}/>
        </button>)}</div>
      </InfoWindow>}

    </Map>
  );
}
