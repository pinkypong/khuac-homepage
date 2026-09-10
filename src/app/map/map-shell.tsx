"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import type { LocationType } from "@/types/database";
import type { TrackPoint } from "@/lib/gps/track";
import { SidePanel } from "./side-panel";

export interface MapPhoto {
  id: string;
  storageKey: string;
  takenAt: string | null;
  exifLat: number | null;
  exifLng: number | null;
  uploaderName: string;
}

export interface MapHike {
  id: string;
  locationId: string;
  title: string;
  date: string;
  description: string | null;
  track: TrackPoint[] | null;
  trackSource: "gpx" | "photos" | null;
  photos: MapPhoto[];
}

export interface MapLocation {
  id: string;
  name: string;
  type: LocationType;
  region: string | null;
  elevation: number | null;
  lat: number;
  lng: number;
  hikes: MapHike[];
  photoCount: number;
}

// Referenced literally so Next inlines them into the client bundle.
const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
const mapId = process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID || "DEMO_MAP_ID";

// The Maps SDK touches window on load, so it stays out of the server render.
// ssr:false is only allowed inside a client component, hence this wrapper.
const MapView = dynamic(() => import("./map-view").then((m) => m.MapView), {
  ssr: false,
  loading: () => <p className="p-4 text-sm text-neutral-400">지도를 불러오는 중…</p>,
});

const MIN_MAP_WIDTH = 320;
const MIN_PANEL_WIDTH = 340;
const DEFAULT_MAP_WIDTH = 0.55;

export function MapShell({ locations }: { locations: MapLocation[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [mapWidth, setMapWidth] = useState<number | null>(null);
  const [mapOpen, setMapOpen] = useState(true);
  const [dragging, setDragging] = useState(false);

  const [activeLocationId, setActiveLocationId] = useState<string | null>(null);
  const [activeHikeId, setActiveHikeId] = useState<string | null>(null);
  const [pinnedHikeId, setPinnedHikeId] = useState<string | null>(null);
  const [hoveredHikeId, setHoveredHikeId] = useState<string | null>(null);

  useEffect(() => {
    if (mapWidth !== null) return;
    const width = containerRef.current?.clientWidth ?? 1200;
    setMapWidth(Math.max(MIN_MAP_WIDTH, width * DEFAULT_MAP_WIDTH));
  }, [mapWidth]);

  const onDragMove = useCallback((event: PointerEvent) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const next = event.clientX - rect.left;
    const max = rect.width - MIN_PANEL_WIDTH;
    setMapWidth(Math.min(Math.max(next, MIN_MAP_WIDTH), Math.max(MIN_MAP_WIDTH, max)));
  }, []);

  useEffect(() => {
    if (!dragging) return;
    const stop = () => setDragging(false);
    window.addEventListener("pointermove", onDragMove);
    window.addEventListener("pointerup", stop);
    return () => {
      window.removeEventListener("pointermove", onDragMove);
      window.removeEventListener("pointerup", stop);
    };
  }, [dragging, onDragMove]);

  const activeLocation = locations.find((l) => l.id === activeLocationId) ?? null;
  const allHikes = locations.flatMap((l) => l.hikes);
  const pinnedHike = allHikes.find((h) => h.id === pinnedHikeId) ?? null;
  const hoveredHike = allHikes.find((h) => h.id === hoveredHikeId) ?? null;

  function openLocation(locationId: string) {
    setActiveLocationId(locationId);
    setActiveHikeId(null);
  }

  function openHike(hike: MapHike) {
    setActiveLocationId(hike.locationId);
    setActiveHikeId(hike.id);
    // Clicking a hike pins its route: it stays on the map while other rows
    // are hovered, unlike the transient hover preview.
    setPinnedHikeId(hike.id);
    setHoveredHikeId(null);
  }

  function goToRoot() {
    setActiveLocationId(null);
    setActiveHikeId(null);
    setPinnedHikeId(null);
    setHoveredHikeId(null);
  }

  return (
    <div ref={containerRef} className="flex h-[calc(100vh-0px)] w-full overflow-hidden">
      {mapOpen && (
        <>
          <div className="relative shrink-0" style={{ width: mapWidth ?? undefined }}>
            {apiKey ? (
              <MapView
                apiKey={apiKey}
                mapId={mapId}
                locations={locations}
                activeLocationId={activeLocationId}
                pinnedHike={pinnedHike}
                hoveredHike={hoveredHike}
                onSelectLocation={openLocation}
              />
            ) : (
              <div className="p-4">
                <p className="font-medium">지도를 표시할 수 없습니다</p>
                <p className="mt-1 text-sm text-neutral-600">
                  <code>NEXT_PUBLIC_GOOGLE_MAPS_API_KEY</code>가 설정되지 않았습니다.
                </p>
              </div>
            )}
            <button
              type="button"
              onClick={() => setMapOpen(false)}
              className="absolute left-3 top-3 z-10 rounded border border-neutral-300 bg-white/95 px-2.5 py-1 text-xs text-neutral-700 shadow-sm hover:bg-white"
            >
              지도 접기
            </button>
          </div>

          <div
            onPointerDown={() => setDragging(true)}
            className={`w-1.5 shrink-0 cursor-col-resize bg-neutral-200 transition-colors hover:bg-neutral-400 ${
              dragging ? "bg-neutral-400" : ""
            }`}
            role="separator"
            aria-orientation="vertical"
            aria-label="지도 크기 조절"
          />
        </>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        {!mapOpen && (
          <button
            type="button"
            onClick={() => setMapOpen(true)}
            className="border-b border-neutral-200 px-4 py-2 text-left text-xs text-neutral-600 hover:bg-neutral-50"
          >
            지도 펼치기
          </button>
        )}
        <SidePanel
          locations={locations}
          activeLocation={activeLocation}
          activeHikeId={activeHikeId}
          pinnedHikeId={pinnedHikeId}
          onOpenLocation={openLocation}
          onOpenHike={openHike}
          onHoverHike={setHoveredHikeId}
          onBackToRoot={goToRoot}
        />
      </div>
    </div>
  );
}
