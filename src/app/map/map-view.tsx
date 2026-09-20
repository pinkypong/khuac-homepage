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
import { PHOTO_PIN_PIXELS, groupPhotosByPosition, metresPerPixel } from "@/lib/gps/photo-groups";
import { groupRoutePins } from "@/lib/gps/route-pins";
import type { TrackPoint } from "@/lib/gps/track";
import { getThumbnailUrl } from "@/lib/images/url";
import { isValidGps } from "@/lib/gps/validate";
import type { MapHike, MapLocation, PickedPoint } from "./map-shell";
import type { TrailSegment } from "@/lib/routes/trails";
import { availableTileLayers, type TileLayer, type TileLayerId } from "./tile-layers";
import { SuggestedRoute } from "./suggested-route";
import { SatelliteTrails } from "./satellite-trails";
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

/**
 * How far each mode can be zoomed before it stops showing anything real.
 *
 * Google's aerial imagery over Korean mountains runs out around zoom 19, and
 * past that the map keeps going with nothing to draw: not a blurrier picture
 * but a flat grey field with the labels still floating on it.
 *
 * Asking MaxZoomService what this spot supports was tried and was worse. It
 * answered 20 over 북한산 and the imagery was already gone - so the map both
 * showed the empty grey and announced in a box that twenty levels were
 * available. A fixed ceiling that is sometimes one level conservative beats a
 * measured one that is confidently wrong.
 */
const MAX_ZOOM: Partial<Record<MapTypeChoice, number>> = {
  hybrid: 19,
  terrain: 17,
};

/**
 * The base map a raster overlay is drawn on top of.
 *
 * Google's own labels, roads and shading would show through the gaps in any
 * layer that is not fully opaque, and two maps disagreeing about where a ridge
 * is reads as a rendering fault. Roadmap is the quietest of the three.
 */
const OVERLAY_BASE: MapTypeChoice = "roadmap";

/** Stands in for the stock 지도/위성 switcher. "hybrid" rather than "satellite"
    so place names stay on the imagery - finding mountains by name is the point.

    Third-party layers join the same row, but they are drawn as overlays rather
    than registered as map types. `map.mapTypes.set` is refused outright when
    the map has a mapId - "A Map's custom map types cannot be set when a mapId
    is present" - and the mapId is not optional: AdvancedMarker, which every
    photo and folder pin on this map is, requires one. Registering the layer
    silently did nothing and then setMapTypeId was called with an id that was
    never added, which is why the trail map opened blank.

    overlayMapTypes carries no such restriction. The tiles are opaque, so an
    overlay covers the base map as completely as a base layer would, and
    markers keep drawing above it. */
function MapTypeToggle({ onLayerChange }: { onLayerChange: (layer: TileLayer | null) => void }) {
  const map = useMap();
  const layers = useMemo(() => availableTileLayers(), []);
  // Opens on the trail layer: this is a climbing club's map and the paths are
  // what it is read for. Google's aerial imagery led before, which shows the
  // terrain but draws none of the trails over it - the one thing the member
  // came to see. Falls back to aerial when no trail layer is configured, so a
  // deployment without the tile key still opens on something rather than on a
  // mode that is not in the switcher.
  const [mapType, setMapType] = useState<MapTypeChoice>(
    () => availableTileLayers()[0]?.id ?? "hybrid",
  );
  const active = layers.find((layer) => layer.id === mapType) ?? null;

  // Applied whenever the mode changes rather than only on the click that
  // changed it: the cap has to hold while someone keeps zooming, and setting
  // it once in the handler left the zoom free the moment they pinched again.
  useEffect(() => {
    if (!map) return;
    const cap = MAX_ZOOM[mapType] ?? layers.find((layer) => layer.id === mapType)?.maxZoom ?? 22;
    map.setOptions({ maxZoom: cap, tilt: 0 });
    if (cap !== null && (map.getZoom() ?? 0) > cap) map.setZoom(cap);
  }, [map, mapType, layers]);

  // One effect owns both halves of the switch - the base type and the overlay -
  // so they can never disagree about which mode is showing.
  useEffect(() => {
    if (!map) return;
    map.setMapTypeId(active ? OVERLAY_BASE : mapType);
    // Cleared before adding rather than diffed: there is only ever one of
    // these, and clear() is the one operation that cannot leave a stale layer
    // underneath a new one.
    map.overlayMapTypes.clear();
    if (active) {
      map.overlayMapTypes.push(
        new google.maps.ImageMapType({
          name: active.label,
          tileSize: new google.maps.Size(256, 256),
          maxZoom: active.maxZoom,
          getTileUrl: (point, zoom) => active.tileUrl(point, zoom),
        }),
      );
    }
    onLayerChange(active);
    return () => {
      map.overlayMapTypes.clear();
    };
  }, [map, mapType, active, onLayerChange]);

  // Trail layers first: the leftmost button is the one reached for most.
  const choices = [...layers.map(({ id, label }) => ({ id, label })), ...GOOGLE_MAP_TYPES];

  return (
    <div className="m-2 flex overflow-hidden rounded border border-neutral-300 bg-white text-xs shadow-sm">
      {choices.map(({ id, label }) => (
        <button
          key={id}
          type="button"
          onClick={() => setMapType(id)}
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
    <span className="m-2 whitespace-nowrap rounded bg-white/80 px-1.5 py-0.5 text-[9px] leading-tight text-neutral-500 shadow-sm">
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
  onSelectLocation,
  onSelectPhoto,
  mapExpanded,
  showSizeToggle,
  onToggleMapSize,
  picking,
  pickedPoint,
  onPickPoint,
  trailSegments,
  chosenTrailIds,
  onToggleTrail,
  suggestedRoute,
  onRouteResolved,
  onRouteMissing,
  onRouteDerived,
  onRouteTrack,
  onTrailsUnavailable,
  draftWaypoints,
}: {
  mapId: string;
  locations: MapLocation[];
  activeLocationId: string | null;
  selectedHike: MapHike | null;
  onSelectLocation: (locationId: string) => void;
  onSelectPhoto: (photoId: string) => void;
  mapExpanded: boolean;
  showSizeToggle: boolean;
  onToggleMapSize: () => void;
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
  onRouteMissing: (names: string[]) => void;
  /** Names the router placed itself, from the course's stated length. */
  onRouteDerived: (names: string[]) => void;
  onRouteTrack: (track: TrackPoint[] | null) => void;
  onTrailsUnavailable: (unavailable: boolean) => void;
  /** The course being edited right now, drawn as it stands. Null when none is. */
  draftWaypoints: { name: string; lat: number; lng: number; removed?: boolean }[] | null;
}) {
  // The boolean rather than the zoom level itself: zoom fires continuously
  // while pinching, and storing the raw number re-rendered every marker on
  // every tick for a value only this one comparison ever read. Setting state
  // to the same boolean lets React bail out, so almost all ticks now cost
  // nothing.
  const [showLabels, setShowLabels] = useState(DEFAULT_ZOOM <= LABEL_MAX_ZOOM);
  // The zoom itself is needed for photo folding, unlike the boolean above - how
  // much ground a pin covers is what decides whether two photos can be told
  // apart. Rounded to a half step so a pinch regroups a handful of times
  // instead of on every frame; half a zoom level is a 1.4x change in scale,
  // finer than anyone notices a pin merging at.
  const [zoomStep, setZoomStep] = useState(Math.round(DEFAULT_ZOOM * 2) / 2);
  const [openPhotoGroup, setOpenPhotoGroup] = useState<{hikeId:string;key:string}|null>(null);
  // Null while a Google base map is showing; those carry their own attribution.
  const [tileLayer, setTileLayer] = useState<TileLayer | null>(null);

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
  const photoPins = useMemo(
    () => (selectedHike ? selectedHike.photos.filter((p) => isValidGps(p.exifLat, p.exifLng)) : []),
    [selectedHike],
  );

  // Photos closer together than one pin's width are drawn as one pin, because
  // below that they are drawn on top of each other regardless. The threshold
  // moves with the zoom: opening a 3.5km course on a phone folds at roughly
  // 650m and shows a handful of stacks, and zooming in splits them apart again.
  // A fixed distance cannot do this - see groupPhotosByPosition.
  const photoGroups = useMemo(() => {
    if (photoPins.length === 0) return [];
    const latitude = photoPins[0].exifLat as number;
    return groupPhotosByPosition(photoPins, PHOTO_PIN_PIXELS * metresPerPixel(latitude, zoomStep));
  }, [photoPins, zoomStep]);
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
      // Google puts a "키보드 단축키" button in the bottom-left corner. On a
      // phone there is no keyboard to shortcut and it only crowds the
      // attribution line it sits beside.
      keyboardShortcuts={false}
      // The pan pad - a circle of four arrows - does on a phone what dragging
      // the map already does, while covering the part of the map it sits on.
      cameraControl={false}
      className="h-full w-full"
      onZoomChanged={(event) => {
        setShowLabels(event.detail.zoom <= LABEL_MAX_ZOOM);
        setZoomStep(Math.round(event.detail.zoom * 2) / 2);
      }}
      onClick={(event) => {
        if (!picking) return;
        const latLng = event.detail.latLng;
        if (latLng) onPickPoint({ lat: latLng.lat, lng: latLng.lng });
      }}
    >
      {/* A real map control, so Google spaces it within its own stack rather
          than letting it land on top of another control. */}
      {showSizeToggle && <MapControl position={ControlPosition.LEFT_BOTTOM}>
        <button
          type="button"
          onClick={onToggleMapSize}
          className="m-2 hidden rounded border border-neutral-300 bg-white px-2.5 py-1 text-xs text-neutral-700 shadow-sm hover:bg-neutral-50 md:block"
        >
          {mapExpanded ? "기본 화면으로" : "지도 크게 보기"}
        </button>
      </MapControl>}

      {/* Top-left is where the stock switcher sat, and it stays clear of the
          fullscreen (top-right) and 지도 접기 (left-bottom) controls. */}
      <MapControl position={ControlPosition.TOP_LEFT}>
        <MapTypeToggle onLayerChange={setTileLayer} />
      </MapControl>

      <MapControl position={ControlPosition.RIGHT_BOTTOM}>
        <ActivityLegend />
      </MapControl>

      {tileLayer && (
        // LEFT_TOP, not TOP_LEFT: the latter shares a row with the layer
        // buttons, and being pushed along it landed this in the top-right
        // corner over the map. The left column puts it under them, which is
        // where it belongs - beside the choice it describes, and clear of
        // Google's own logo and terms line along the bottom.
        <MapControl position={ControlPosition.LEFT_TOP}>
          <TileAttribution layer={tileLayer} />
        </MapControl>
      )}

      <Camera
        locations={locations}
        activeLocationId={activeLocationId}
        selectedHike={selectedHike}
      />

      <SatelliteTrails />

      {suggestedRoute && (
        <SuggestedRoute
          route={suggestedRoute.route}
          center={suggestedRoute.center}
          placeName={suggestedRoute.placeName}
          resolved={suggestedRoute.resolved}
          onResolved={onRouteResolved}
          onMissing={onRouteMissing}
          onDerived={onRouteDerived}
          onTrack={onRouteTrack}
          pins={!selectedHike}
          onTrailsUnavailable={onTrailsUnavailable}
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
          zIndex={12}
          // Google's default is clickable, and a clickable line swallows the
          // map click underneath it. This one does nothing when clicked, so all
          // it could do is eat a tap meant for the map - which is how a course
          // already drawn on an album blocks placing a waypoint on top of it.
          clickable={false}
        />
      )}

      {/* The named points, each where it is.
          The album's own pin carried the whole list - seven names stacked on
          the one coordinate the line starts at - which says nothing about
          where any of them is. A small mark on the line at each, and the two
          ends named, because those are what a reader looks for first and the
          middle ones would otherwise pile their labels on top of each other.
          The names alone: which end is which is what the line is for.

          Grouped through groupRoutePins first. A course that comes back on
          itself names some ground twice - the same gate before and after the
          summit, sometimes under the name it carried before its 2015 rename -
          and one marker per waypoint drew two dots stacked on the one
          coordinate the gate actually has. Folded to one dot per place, hollow
          rather than filled for a spot only reached coming back, so a reader
          can tell the two halves of an out-and-back apart without a second
          colour to learn. */}
      {selectedHike?.track && selectedHike.routeWaypoints && (() => {
        const pins = groupRoutePins(selectedHike.routeWaypoints);
        return pins.map((pin, i) => {
          const end = i === 0 || i === pins.length - 1;
          const label = pin.points.map((point) => point.name).join(" · ");
          return (
            <AdvancedMarker
              key={`${label}-${i}`}
              position={pin}
              title={label}
              zIndex={13}
              collisionBehavior={
                end ? CollisionBehavior.REQUIRED_AND_HIDES_OPTIONAL
                  : CollisionBehavior.OPTIONAL_AND_HIDES_LOWER_PRIORITY
              }
            >
              <span className="flex items-center gap-1">
                <span
                  className="block rounded-full border-2 shadow"
                  style={
                    pin.leg === "return"
                      // Hollow for a spot only reached coming back: same
                      // colour, worn as a ring instead of a fill, so the two
                      // halves of an out-and-back read apart at a glance with
                      // no second colour to learn.
                      ? { borderColor: SELECTED_COLOR, backgroundColor: "#fff", width: end ? 11 : 8, height: end ? 11 : 8 }
                      : { borderColor: "#fff", backgroundColor: SELECTED_COLOR, width: end ? 11 : 8, height: end ? 11 : 8 }
                  }
                />
                {end && (
                  <span className="whitespace-nowrap rounded bg-white/90 px-1 py-px text-[10px] font-medium text-neutral-900 shadow-sm">
                    {label}
                  </span>
                )}
              </span>
            </AdvancedMarker>
          );
        });
      })()}

      {/* The course as it is being edited, before it is saved.
          Tapping the map to add a waypoint used to put nothing on the map at
          all - the pins above are drawn from what the server holds, and the
          new point is not there yet - so there was no way to tell a tap that
          landed from one that missed. These are numbered to match the rows in
          the editor, amber rather than the saved colour, and never hidden by
          collision: an unsaved point that a neighbour suppressed would read
          exactly like a tap that did not register. */}
      {draftWaypoints?.map((point, i) => (
        <AdvancedMarker
          key={`draft-${i}-${point.lat}-${point.lng}`}
          position={{ lat: point.lat, lng: point.lng }}
          title={point.removed
            ? `${point.name || `경유지 ${i + 1}`} — 저장하면 지워집니다`
            : point.name || `경유지 ${i + 1} (이름 없음)`}
          zIndex={20}
          collisionBehavior={CollisionBehavior.REQUIRED}
        >
          {/* A point on its way out stays on the map, struck through, until the
              save. Dropping it from the list the moment × was pressed left the
              map looking exactly as it does when a press misses. */}
          <span className={"flex items-center gap-1 " + (point.removed ? "opacity-70" : "")}>
            <span
              className={
                "flex h-[18px] w-[18px] items-center justify-center rounded-full border-2 border-white text-[10px] font-bold leading-none text-white shadow "
                + (point.removed ? "bg-neutral-400" : "bg-amber-500")
              }
            >
              {point.removed ? "×" : i + 1}
            </span>
            <span
              className={
                "whitespace-nowrap rounded px-1 py-px text-[10px] font-medium shadow-sm "
                + (point.removed
                  ? "bg-neutral-100/95 text-neutral-500 line-through"
                  : "bg-amber-50/95 text-amber-900")
              }
            >
              {point.name || "이름 없음"}
            </span>
          </span>
        </AdvancedMarker>
      ))}

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
