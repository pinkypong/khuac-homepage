"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import type { ActivityType, LocationType } from "@/types/database";
import type { TrackPoint } from "@/lib/gps/track";
import Link from "next/link";
import { APIProvider } from "@vis.gl/react-google-maps";
import { SignOutButton } from "@/components/sign-out-button";
import { ViewerName } from "@/app/account/name-form";
import { PendingBadge } from "@/components/pending-badge";
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
  // Stands in for "last activity" when a folder has no activity yet, so a
  // freshly created one still sorts near the top of the panel's list.
  createdAt: string;
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

/**
 * Which half of the app a phone is looking at.
 *
 * The split view needs MIN_MAP_WIDTH + MIN_PANEL_WIDTH = 660px and a phone in
 * portrait has 390, so below Tailwind's md the two halves become tabs and the
 * drag divider goes away. The breakpoint lives only in class names - nothing
 * here measures the viewport - so this state is simply inert at md and above,
 * where both halves are on screen at once.
 */
type MobileTab = "map" | "album";

const MOBILE_TABS: { id: MobileTab; label: string }[] = [
  { id: "map", label: "지도" },
  { id: "album", label: "앨범" },
];

export interface PickedPoint {
  lat: number;
  lng: number;
}

export function MapShell({
  locations,
  viewerName,
  isAdmin,
  pendingCount,
}: {
  locations: MapLocation[];
  viewerName: string;
  isAdmin: boolean;
  pendingCount: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [mapWidth, setMapWidth] = useState<number | null>(null);
  const [mapOpen, setMapOpen] = useState(true);
  const [dragging, setDragging] = useState(false);
  const [mobileTab, setMobileTab] = useState<MobileTab>("map");

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

  function showMap() {
    setMobileTab("map");
    // 지도 접기 is hidden below md, but the flag survives a desktop session
    // being narrowed to a phone, and an empty 지도 tab would be a dead end.
    setMapOpen(true);
  }

  function openLocation(locationId: string) {
    setActiveLocationId(locationId);
    setActiveHikeId(null);
    // Only one half is on screen on a phone, so a marker tap that left the map
    // up would look like nothing had happened: hand over to the list it opened.
    setMobileTab("album");
  }

  function openHike(hike: MapHike) {
    setActiveLocationId(hike.locationId);
    setActiveHikeId(hike.id);
    // Clicking a hike pins its route: it stays on the map while other rows
    // are hovered, unlike the transient hover preview.
    setPinnedHikeId(hike.id);
    setHoveredHikeId(null);
    setMobileTab("album");
  }

  function pickPoint(point: PickedPoint) {
    setPickedPoint(point);
    // The form waiting on this point is in the other tab, so a phone goes back
    // to it rather than leaving the member on a map that looks unchanged.
    setMobileTab("album");
  }

  function goToRoot() {
    setActiveLocationId(null);
    setActiveHikeId(null);
    setPinnedHikeId(null);
    setHoveredHikeId(null);
  }

  // Read only at md and above. Left unset until measured so the pane keeps its
  // natural width for the one frame before the effect runs.
  const mapWidthStyle =
    mapWidth === null ? undefined : ({ "--map-width": mapWidth + "px" } as CSSProperties);

  const shell = (
    <div className="flex h-app w-full flex-col overflow-hidden">
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-neutral-200 px-4 pb-2 pt-[calc(0.5rem+env(safe-area-inset-top))]">
        <span className="min-w-0 truncate text-sm font-semibold">산악부 지도</span>
        <nav className="flex shrink-0 items-center gap-3 text-xs text-neutral-600 md:gap-4">
          {viewerName && <ViewerName initialName={viewerName} isAdmin={isAdmin} />}
          <Link href="/members" className="py-1 hover:underline">
            부원
          </Link>
          {isAdmin && (
            <Link href="/admin/members" className="flex items-center gap-1 py-1 hover:underline">
              관리자
              <PendingBadge count={pendingCount} />
            </Link>
          )}
          <SignOutButton />
        </nav>
      </header>

    <div ref={containerRef} className="relative flex min-h-0 w-full flex-1 overflow-hidden">
      {mapOpen && (
        <>
          {/* Below md the two panes sit on top of each other and the tab bar
              picks one. They are hidden with visibility rather than unmounted,
              so the map keeps its tiles, its camera and its WebGL context
              across a tab switch instead of reloading on every one. */}
          <div
            style={mapWidthStyle}
            className={
              "absolute inset-0 w-full md:relative md:inset-auto md:w-[var(--map-width)] md:shrink-0 " +
              (mobileTab === "map" ? "" : "invisible md:visible")
            }
          >
            {apiKey ? (
              <MapView
                mapId={mapId}
                locations={locations}
                activeLocationId={activeLocationId}
                selectedHike={pinnedHike}
                hoveredHike={hoveredHike}
                onSelectLocation={openLocation}
                onSelectHike={openHike}
                onCollapseMap={() => setMapOpen(false)}
                picking={picking}
                pickedPoint={pickedPoint}
                onPickPoint={pickPoint}
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
            className={`hidden w-1.5 shrink-0 cursor-col-resize bg-neutral-200 transition-colors hover:bg-neutral-400 md:block ${
              dragging ? "bg-neutral-400" : ""
            }`}
            role="separator"
            aria-orientation="vertical"
            aria-label="지도 크기 조절"
          />
        </>
      )}

      <div
        className={
          "absolute inset-0 flex min-w-0 flex-col bg-white md:relative md:inset-auto md:flex-1 " +
          // A collapsed map leaves the 지도 tab with nothing in it, so on a
          // phone the panel stays up until 지도 is tapped and re-opens it.
          (mobileTab === "album" || !mapOpen ? "" : "invisible md:visible")
        }
      >
        {!mapOpen && (
          <button
            type="button"
            onClick={() => setMapOpen(true)}
            className="hidden border-b border-neutral-200 px-4 py-2 text-left text-xs text-neutral-600 hover:bg-neutral-50 md:block"
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
          onShowOnMap={showMap}
          picking={picking}
          pickedPoint={pickedPoint}
          onPickPoint={pickPoint}
          onPickingChange={(next) => {
            setPicking(next);
            if (!next) setPickedPoint(null);
            if (next && !mapOpen) setMapOpen(true);
          }}
        />
      </div>
      </div>

      {/* Bottom rather than top: this is the control a member reaches for most
          often on a phone, and the bottom edge is where the thumb already is.
          The padding clears the home indicator on a notched device. */}
      <nav
        aria-label="화면 전환"
        className="flex shrink-0 border-t border-neutral-200 bg-white pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        {MOBILE_TABS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            aria-pressed={mobileTab === id}
            onClick={() => (id === "map" ? showMap() : setMobileTab("album"))}
            className={
              "flex-1 py-3 text-sm " +
              (mobileTab === id
                ? "font-semibold text-neutral-900 shadow-[inset_0_2px_0_0_currentColor]"
                : "text-neutral-500")
            }
          >
            {label}
          </button>
        ))}
      </nav>
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
