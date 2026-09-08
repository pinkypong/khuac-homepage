"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  AdvancedMarker,
  APIProvider,
  InfoWindow,
  Map,
  useMap,
  useMapsLibrary,
} from "@vis.gl/react-google-maps";
import type { MapLocation } from "./map-loader";

// Fallback view (roughly the Korean peninsula) before fitBounds kicks in.
const DEFAULT_CENTER = { lat: 36.5, lng: 127.8 };
const DEFAULT_ZOOM = 6;
const SINGLE_LOCATION_ZOOM = 11;

// Locations can be anywhere from Bukhansan to the Himalayas, so the initial
// viewport is derived from the markers rather than hardcoded.
function FitBounds({ locations }: { locations: MapLocation[] }) {
  const map = useMap();
  const core = useMapsLibrary("core");

  useEffect(() => {
    if (!map || !core || locations.length === 0) return;

    if (locations.length === 1) {
      // fitBounds on a single point zooms all the way in; pick a sane level.
      map.setCenter({ lat: locations[0].lat, lng: locations[0].lng });
      map.setZoom(SINGLE_LOCATION_ZOOM);
      return;
    }

    const bounds = new core.LatLngBounds();
    for (const location of locations) {
      bounds.extend({ lat: location.lat, lng: location.lng });
    }
    map.fitBounds(bounds, 64);
  }, [map, core, locations]);

  return null;
}

export function MapView({
  apiKey,
  mapId,
  locations,
}: {
  apiKey: string;
  mapId: string;
  locations: MapLocation[];
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = locations.find((l) => l.id === selectedId) ?? null;

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
        <FitBounds locations={locations} />

        {locations.map((location) => (
          <AdvancedMarker
            key={location.id}
            position={{ lat: location.lat, lng: location.lng }}
            title={location.name}
            onClick={() => setSelectedId(location.id)}
          >
            <div className="flex items-center gap-1 rounded-full border border-neutral-300 bg-white px-2 py-1 text-xs font-medium shadow">
              <span>{location.name}</span>
              {location.photoCount > 0 && (
                <span className="rounded-full bg-neutral-900 px-1.5 text-[10px] text-white">
                  {location.photoCount}
                </span>
              )}
            </div>
          </AdvancedMarker>
        ))}

        {selected && (
          <InfoWindow
            position={{ lat: selected.lat, lng: selected.lng }}
            onCloseClick={() => setSelectedId(null)}
          >
            <div className="min-w-48 max-w-64 text-neutral-900">
              <p className="font-semibold">{selected.name}</p>
              <p className="mt-0.5 text-xs text-neutral-500">
                {[selected.region, selected.elevation ? `${selected.elevation}m` : null]
                  .filter(Boolean)
                  .join(" · ") || "정보 없음"}
              </p>
              <p className="mt-0.5 text-xs text-neutral-500">사진 {selected.photoCount}장</p>

              {selected.hikes.length === 0 ? (
                <p className="mt-2 text-xs text-neutral-400">등록된 산행이 없습니다.</p>
              ) : (
                <ul className="mt-2 flex flex-col gap-1">
                  {selected.hikes.map((hike) => (
                    <li key={hike.id}>
                      <Link href={`/hikes/${hike.id}`} className="text-sm underline">
                        {new Date(hike.date).toLocaleDateString("ko-KR")} · {hike.title}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </InfoWindow>
        )}
      </Map>
    </APIProvider>
  );
}
