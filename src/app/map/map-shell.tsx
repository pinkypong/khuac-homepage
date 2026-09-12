"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { ActivityType, LocationType } from "@/types/database";
import type { TrackPoint } from "@/lib/gps/track";
import Link from "next/link";
import Image from "next/image";
import { ACTIVITY_TYPES, ACTIVITY_LABEL } from "./activity";
import { getThumbnailUrl } from "@/lib/images/url";
import { APIProvider } from "@vis.gl/react-google-maps";
import { SignOutButton } from "@/components/sign-out-button";
import { ViewerName } from "@/app/account/name-form";
import { PendingBadge } from "@/components/pending-badge";
import { SidePanel } from "./side-panel";
import { MapErrorBoundary, MapUnavailable } from "./map-error-boundary";

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
  trackSource: "gpx" | null;
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
const DEFAULT_MAP_WIDTH = 0.58;

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

function NavIcon({kind}: {kind: "map" | "album" | "upload" | "profile"}) {
 const paths = {map: "M12 21s7-7 7-12a7 7 0 1 0-14 0c0 5 7 12 7 12Z M12 6a3 3 0 1 0 0 6 3 3 0 0 0 0-6", album:"M4 3h16v18H4Z M7 7h10 M7 11h4 M7 17l4-4 3 3 3-2", upload:"M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18 M12 7v10 M7 12h10", profile:"M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M4 21v-3a8 6 0 0 1 16 0v3Z"};
 return <svg aria-hidden="true" width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d={paths[kind]}/></svg>;
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
  const [search, setSearch] = useState("");
  const [activity, setActivity] = useState<ActivityType | "all">("all");
  const [mapFailed, setMapFailed] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const visibleLocations = useMemo(() => locations.filter((l) => (!search.trim() || [l.name, l.region, ...l.hikes.map(h => h.title)].join(" ").toLowerCase().includes(search.trim().toLowerCase())) && (activity === "all" || l.hikes.some(h => h.activityType === activity))), [locations, search, activity]);
  const [mapWidth, setMapWidth] = useState<number | null>(null);
  const [mapOpen, setMapOpen] = useState(true);
  const [dragging, setDragging] = useState(false);
  const [mobileTab, setMobileTab] = useState<MobileTab>("map");

  const [activeLocationId, setActiveLocationId] = useState<string | null>(null);
  const [activeHikeId, setActiveHikeId] = useState<string | null>(null);
  const [pinnedHikeId, setPinnedHikeId] = useState<string | null>(null);
  const [hoveredHikeId, setHoveredHikeId] = useState<string | null>(null);
  // Set when a photo pin on the map is tapped, so the detail panel can open its
  // lightbox on that photo. Cleared once consumed, otherwise closing the
  // lightbox would immediately reopen it.
  const [focusedPhotoId, setFocusedPhotoId] = useState<string | null>(null);
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
    setMobileTab("map");
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

  function selectPhoto(photoId: string) {
    setFocusedPhotoId(photoId);
    // The panel is where the photo opens, and on a phone it is not on screen.
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
    <div className="club-app flex h-app w-full flex-col overflow-hidden">
      <header className="club-header">
        <Link href="/map" className="club-brand" aria-label="KHUAC 지도"><Image src="/khuac-logo-original.png" alt="경희대학교 산악부 원본 마크" width={282} height={262} priority /><span><strong>KHUAC</strong><small>경희대학교 산악부</small></span></Link>
        <nav className="club-desktop-nav" aria-label="주 메뉴">
          <button aria-pressed={mapOpen} onClick={showMap}>지도</button>
          <button aria-pressed={!mapOpen} onClick={() => {setMapOpen(false);setMobileTab("album");}}>앨범</button>
          <Link href="/members">부원</Link>
        </nav>
        <div className="club-header-actions"><Link className="club-upload" href="/photos/upload">사진 업로드 <span>＋</span></Link><button className="club-profile" aria-label="내 정보" aria-expanded={accountOpen} onClick={() => setAccountOpen(!accountOpen)}><NavIcon kind="profile"/></button></div>
      </header>
      {accountOpen && <section className="club-account" aria-label="내 정보">{viewerName && <ViewerName initialName={viewerName} isAdmin={isAdmin} />}<Link href="/members">부원</Link>{isAdmin && <Link href="/admin/members">관리자 <PendingBadge count={pendingCount}/></Link>}<SignOutButton/><button onClick={() => setAccountOpen(false)}>닫기</button></section>}
      <div className="club-toolbar"><label className="club-search"><span aria-hidden="true">⌕</span><input aria-label="장소·활동 검색" placeholder="장소·활동 검색" value={search} onChange={e=>{setSearch(e.target.value);goToRoot();}} /></label><div className="club-filters" aria-label="활동 종류">{(["all", ...ACTIVITY_TYPES] as const).map(type=><button key={type} aria-pressed={activity===type} onClick={()=>{setActivity(type);goToRoot();}}>{type==="all"?"전체":ACTIVITY_LABEL[type]}</button>)}</div></div>

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
            {mapFailed ? <MapUnavailable onShowAlbum={() => {setMapOpen(false); setMobileTab("album");}} /> : apiKey ? (
              <MapErrorBoundary onShowAlbum={() => {setMapOpen(false); setMobileTab("album");}}><MapView
                mapId={mapId}
                locations={visibleLocations}
                activeLocationId={activeLocationId}
                selectedHike={pinnedHike}
                hoveredHike={hoveredHike}
                onSelectLocation={(id) => {openLocation(id);setMobileTab("map");}}
                onSelectHike={openHike}
                onSelectPhoto={selectPhoto}
                onCollapseMap={() => setMapOpen(false)}
                picking={picking}
                pickedPoint={pickedPoint}
                onPickPoint={pickPoint}
              /></MapErrorBoundary>
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
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); const width = containerRef.current?.clientWidth ?? 1200; setMapWidth(Math.max(MIN_MAP_WIDTH, Math.min(width - MIN_PANEL_WIDTH, (mapWidth ?? width * DEFAULT_MAP_WIDTH) + (e.key === "ArrowRight" ? 24 : -24)))); } }}
            role="separator"
            aria-orientation="vertical"
            aria-label="지도 크기 조절"
          />
        </>
      )}

      <div
        className={
          "club-album absolute inset-0 flex min-w-0 flex-col bg-white md:relative md:inset-auto md:flex-1 " +
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
          locations={visibleLocations}
          activeLocation={activeLocation}
          activeHikeId={activeHikeId}
          isAdmin={isAdmin}
          pinnedHikeId={pinnedHikeId}
          onOpenLocation={openLocation}
          onOpenHike={openHike}
          focusedPhotoId={focusedPhotoId}
          onFocusedPhotoConsumed={() => setFocusedPhotoId(null)}
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
      {mobileTab === "map" && mapOpen && activeLocation && <button className="club-map-sheet" onClick={()=>setMobileTab("album")}><span className="club-grabber"/>{activeLocation.hikes[0]?.photos[0] && <Image unoptimized src={getThumbnailUrl(activeLocation.hikes[0].photos[0].storageKey)} width={88} height={68} alt=""/>}<span><strong>{activeLocation.name}</strong><small>활동 {activeLocation.hikes.length} · 사진 {activeLocation.photoCount}</small></span><span aria-hidden="true">→</span></button>}
      </div>

      {/* Bottom rather than top: this is the control a member reaches for most
          often on a phone, and the bottom edge is where the thumb already is.
          The padding clears the home indicator on a notched device. */}
      <nav
        aria-label="화면 전환"
        className="club-bottom-nav flex shrink-0 border-t border-neutral-200 bg-white pb-[env(safe-area-inset-bottom)] md:hidden"
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
            <NavIcon kind={id}/>{label}
          </button>
        ))}
        <Link href="/photos/upload"><NavIcon kind="upload"/>업로드</Link>
        <button aria-expanded={accountOpen} onClick={()=>setAccountOpen(!accountOpen)}><NavIcon kind="profile"/>내 정보</button>
      </nav>
    </div>
  );

  // APIProvider wraps both columns, not just the map: the "new location"
  // search box in the panel needs the Places library too.
  // language/region make Places return Korean names (관악산, not "Gwanaksan").
  return apiKey ? (
    <APIProvider apiKey={apiKey} language="ko" region="KR" onError={(error) => {console.error("[map/load]", error); setMapFailed(true);}}>
      {shell}
    </APIProvider>
  ) : (
    shell
  );
}
