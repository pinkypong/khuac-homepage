"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ActivityType, LocationType } from "@/types/database";
import type { TrackPoint } from "@/lib/gps/track";
import Link from "next/link";
import { APIProvider } from "@vis.gl/react-google-maps";
import { SignOutButton } from "@/components/sign-out-button";
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
  activityType: ActivityType;
  // The specific peak/route inside the location, e.g. 대청봉 within 설악산.
  // Null until someone pins one; the location's own point stands in.
  lat: number | null;
  lng: number | null;
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

export interface PickedPoint {
  lat: number;
  lng: number;
}

export function MapShell({
  locations,
  viewerName,
  isAdmin,
}: {
  locations: MapLocation[];
  viewerName: string;
  isAdmin: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [mapWidth, setMapWidth] = useState<number | null>(null);
  const [mapOpen, setMapOpen] = useState(true);
  const [dragging, setDragging] = useState(false);

  const [activeLocationId, setActiveLocationId] = useState<string | null>(null);
  const [activeHikeId, setActiveHikeId] = useState<string | null>(null);
  const [pinnedHikeId, setPinnedHikeId] = useState<string | null>(null);
  const [hoveredHikeId, setHoveredHikeId] = useState<string | null>(null);
  // When the "new location" form is open the map turns into a coordinate
  // picker - far easier than asking anyone to type lat/lng.
  const [picking, setPicking] = useState(false);
  const [pickedPoint, setPickedPoint] = useState<PickedPoint | null>(null);

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

  const shell = (
    <div className="flex h-screen w-full flex-col overflow-hidden">
      <header className="flex shrink-0 items-center justify-between border-b border-neutral-200 px-4 py-2">
        <span className="text-sm font-semibold">산악부 지도</span>
        <nav className="flex items-center gap-4 text-xs text-neutral-600">
          {viewerName && <span className="text-neutral-500">{viewerName}</span>}
          {isAdmin && (
            <Link href="/admin/members" className="hover:underline">
              관리자
            </Link>
          )}
          <SignOutButton />
        </nav>
      </header>

    <div ref={containerRef} className="flex min-h-0 w-full flex-1 overflow-hidden">
      {mapOpen && (
        <>
          <div className="relative shrink-0" style={{ width: mapWidth ?? undefined }}>
            {apiKey ? (
              <MapView
                mapId={mapId}
                locations={locations}
                activeLocationId={activeLocationId}
                pinnedHike={pinnedHike}
                hoveredHike={hoveredHike}
                onSelectLocation={openLocation}
                onSelectHike={openHike}
                onCollapseMap={() => setMapOpen(false)}
                picking={picking}
                pickedPoint={pickedPoint}
                onPickPoint={setPickedPoint}
              />
            ) : (
              <div className="p-4">
                <p className="font-medium">지도를 표시할 수 없습니다</p>
                <p className="mt-1 text-sm text-neutral-600">
                  <code>NEXT_PUBLIC_GOOGLE_MAPS_API_KEY</code>가 설정되지 않았습니다.
                </p>
              </div>
            )}
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
          isAdmin={isAdmin}
          pinnedHikeId={pinnedHikeId}
          onOpenLocation={openLocation}
          onOpenHike={openHike}
          onHoverHike={setHoveredHikeId}
          onBackToRoot={goToRoot}
          picking={picking}
          pickedPoint={pickedPoint}
          onPickPoint={setPickedPoint}
          onPickingChange={(next) => {
            setPicking(next);
            if (!next) setPickedPoint(null);
            if (next && !mapOpen) setMapOpen(true);
          }}
        />
      </div>
      </div>
    </div>
  );

  // APIProvider wraps both columns, not just the map: the "new location"
  // search box in the panel needs the Places library too.
  // language/region make Places return Korean names (관악산, not "Gwanaksan").
  return apiKey ? (
    <APIProvider apiKey={apiKey} language="ko" region="KR">
      {shell}
    </APIProvider>
  ) : (
    shell
  );
}
