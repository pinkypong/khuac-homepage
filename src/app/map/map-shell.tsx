"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { ActivityType, LocationType } from "@/types/database";
import type { TrackPoint } from "@/lib/gps/track";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { ACTIVITY_TYPES, ACTIVITY_LABEL } from "./activity";
import { getThumbnailUrl } from "@/lib/images/url";
import { APIProvider } from "@vis.gl/react-google-maps";
import { SignOutButton } from "@/components/sign-out-button";
import { ViewerName } from "@/app/account/name-form";
import { PendingBadge } from "@/components/pending-badge";
import { SidePanel } from "./side-panel";
import { loadTrails, saveTrailRoute } from "./route-actions";
import { stitchSegments, type TrailSegment } from "@/lib/routes/trails";
import { formatDistance, trackDistanceMeters } from "@/lib/gps/track";
import { MapErrorBoundary, MapUnavailable } from "./map-error-boundary";
import { PoiForm } from "./poi-form";
import { createAlbumFromRoute, type RouteWaypoint } from "./route-album-actions";
import type { RouteSuggestion } from "@/lib/assistant/routes";

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
  /** The course's named points, where it was made from one. */
  routeWaypoints: { name: string; lat: number; lng: number }[] | null;
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
type MobileTab = "map" | "ai" | "album";

// KHUAC AI gets its own tab rather than sitting on top of the album list. On
// a phone the panel is one column, so an answer several paragraphs long left
// the albums somewhere below the fold - the two were competing for the same
// screen rather than sharing it.
const MOBILE_TABS: { id: MobileTab; label: string }[] = [
  { id: "map", label: "지도" },
  { id: "ai", label: "KHUAC AI" },
  { id: "album", label: "앨범" },
];

export interface PickedPoint {
  lat: number;
  lng: number;
}

function NavIcon({kind}: {kind: "map" | "ai" | "album" | "upload" | "profile"}) {
 const paths = {map: "M12 21s7-7 7-12a7 7 0 1 0-14 0c0 5 7 12 7 12Z M12 6a3 3 0 1 0 0 6 3 3 0 0 0 0-6", ai:"M4 19l5-13 5 13 M6 15h6 M17 6v13", album:"M4 3h16v18H4Z M7 7h10 M7 11h4 M7 17l4-4 3 3 3-2", upload:"M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18 M12 7v10 M7 12h10", profile:"M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M4 21v-3a8 6 0 0 1 16 0v3Z"};
 return <svg aria-hidden="true" width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d={paths[kind]}/></svg>;
}

/**
 * The controls for an in-progress route build, sitting over the map.
 *
 * Over the map rather than in the panel because that is where the tapping
 * happens - on a phone the panel is a different tab entirely, and a save button
 * the member has to switch screens to reach would be a save button they never
 * find.
 */
function TrailPickBar({
  pick,
  busy,
  onCancel,
  onSave,
}: {
  pick: { segments: TrailSegment[]; chosen: number[] };
  busy: boolean;
  onCancel: () => void;
  onSave: () => void;
}) {
  const chosenSegments = pick.chosen
    .map((id) => pick.segments.find((segment) => segment.id === id))
    .filter((segment): segment is TrailSegment => segment !== undefined);

  // Measured on the stitched line, not by adding the parts up: segments that
  // do not join are dropped when stitching, and counting them here would
  // promise a distance the saved route does not have.
  const stitched = stitchSegments(chosenSegments);
  const distance = stitched.length >= 2 ? formatDistance(trackDistanceMeters(stitched)) : null;
  const dropped = chosenSegments.length - 1 > 0 && stitched.length < 2;

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 p-3 pb-[calc(2.4rem+env(safe-area-inset-bottom))]">
      <div className="pointer-events-auto mx-auto flex max-w-md flex-col gap-2 rounded-xl border border-neutral-300 bg-white/95 p-3 shadow-lg backdrop-blur">
        <p className="text-xs font-medium">
          {pick.chosen.length === 0
            ? "걸었던 등산로를 순서대로 눌러주세요."
            : `구간 ${pick.chosen.length}개 선택${distance ? ` · ${distance}` : ""}`}
        </p>
        {dropped && (
          <p className="text-[11px] text-amber-700">
            고른 구간들이 서로 이어지지 않습니다. 중간 구간을 마저 선택해주세요.
          </p>
        )}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="flex-1 rounded-lg border border-neutral-300 py-2 text-xs font-medium disabled:opacity-50"
          >
            취소
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={busy || pick.chosen.length === 0}
            className="flex-1 rounded-lg bg-neutral-900 py-2 text-xs font-medium text-white disabled:opacity-50"
          >
            {busy ? "저장 중…" : "이 경로로 저장"}
          </button>
        </div>
      </div>
    </div>
  );
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
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const [search, setSearch] = useState("");
  const [activity, setActivity] = useState<ActivityType | "all">("all");
  const [mapFailed, setMapFailed] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const visibleLocations = useMemo(() => locations.filter((l) => (!search.trim() || [l.name, l.region, ...l.hikes.map(h => h.title)].join(" ").toLowerCase().includes(search.trim().toLowerCase())) && (activity === "all" || l.hikes.some(h => h.activityType === activity))), [locations, search, activity]);
  /**
   * What the typed text matches, as rows to jump to rather than only as a
   * filter on the list.
   *
   * Filtering alone answered "which folders mention this" and left finding the
   * course itself to scrolling. Typing 숨은벽 should offer the 숨은벽 능선
   * course and go to it - and offer both when two courses share the name,
   * which is why this is a list and not a jump to the first hit.
   */
  const searchMatches = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return [];
    const rows: { hike: MapHike; location: MapLocation }[] = [];
    for (const location of locations) {
      for (const hike of location.hikes) {
        if (activity !== "all" && hike.activityType !== activity) continue;
        const haystack = [hike.title, location.name, location.region].join(" ").toLowerCase();
        if (haystack.includes(term)) rows.push({ hike, location });
      }
    }
    // The course whose own title matches is what was being looked for; one
    // that matched only through its mountain's name comes after.
    return rows
      .sort((a, b) =>
        Number(b.hike.title.toLowerCase().includes(term)) - Number(a.hike.title.toLowerCase().includes(term)))
      .slice(0, 8);
  }, [locations, search, activity]);

  const [mapWidth, setMapWidth] = useState<number | null>(null);
  const [mapOpen, setMapOpen] = useState(true);
  const [dragging, setDragging] = useState(false);
  const [mobileTab, setMobileTab] = useState<MobileTab>("map");
  const panelTab: MobileTab = mapOpen ? mobileTab : "album";

  const [activeLocationId, setActiveLocationId] = useState<string | null>(null);
  const [activeHikeId, setActiveHikeId] = useState<string | null>(null);
  const [pinnedHikeId, setPinnedHikeId] = useState<string | null>(null);
  const [hoveredHikeId, setHoveredHikeId] = useState<string | null>(null);
  // Set when a photo pin on the map is tapped, so the detail panel can open its
  // lightbox on that photo. Cleared once consumed, otherwise closing the
  // lightbox would immediately reopen it.
  const [focusedPhotoId, setFocusedPhotoId] = useState<string | null>(null);
  // A course the assistant suggested and the member tapped, drawn on this map
  // rather than on a second one inside the answer. `resolved` is filled in by
  // the map layer once the waypoint names have been geocoded - the album that
  // can be built from the course needs those same coordinates.
  const [suggestedRoute, setSuggestedRoute] = useState<{
    route: RouteSuggestion;
    center: { lat: number; lng: number } | null;
    placeName: string;
    resolved: RouteWaypoint[] | null;
  } | null>(null);
  const [creatingAlbum, setCreatingAlbum] = useState(false);
  // A course waypoint nothing could place, and the point a member is putting
  // on the map for it. Null unless they asked to record one, so the map stays
  // clear the rest of the time.
  const [missingNames, setMissingNames] = useState<string[]>([]);
  const [namingPoi, setNamingPoi] = useState<string | null>(null);
  // Told apart from "this stretch has no path": one is our problem, the other
  // is the mountain's, and a dashed line alone cannot say which.
  const [trailsUnavailable, setTrailsUnavailable] = useState(false);
  const [poiPoint, setPoiPoint] = useState<PickedPoint | null>(null);
  // An in-progress route build: which activity it is for, the paths offered
  // around it, and the ones chosen so far in the order they were tapped.
  const [trailPick, setTrailPick] = useState<{
    hikeId: string;
    lat: number;
    lng: number;
    segments: TrailSegment[];
    chosen: number[];
  } | null>(null);
  const [trailBusy, setTrailBusy] = useState(false);
  // The drawn line for the course being previewed, kept so an album made from
  // it opens with the route on the map rather than as a bare pin.
  const [routeTrack, setRouteTrack] = useState<TrackPoint[] | null>(null);
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
    // The map comes back with it. An album's route is the thing worth seeing,
    // and it was reachable only by finding 지도 펼치기 afterwards - because
    // opening the album list had closed the map on the way in.
    setMapOpen(true);
    // Clicking a hike pins its route: it stays on the map while other rows
    // are hovered, unlike the transient hover preview.
    setPinnedHikeId(hike.id);
    setHoveredHikeId(null);
    setMobileTab("album");
  }

  function pickPoint(point: PickedPoint) {
    // Naming a waypoint keeps the member on the map: the form for it sits over
    // the map itself, so sending them to the album tab would hide the thing
    // they just tapped.
    if (namingPoi) {
      setPoiPoint(point);
      setPicking(false);
      return;
    }
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

  async function startTrailPick(hike: MapHike, fallbackLat: number, fallbackLng: number) {
    const lat = hike.lat ?? fallbackLat;
    const lng = hike.lng ?? fallbackLng;
    setTrailBusy(true);
    try {
      const segments = await loadTrails(lat, lng);
      if (segments.length === 0) {
        window.alert("이 주변에 등록된 등산로가 없습니다. GPX 파일을 올려주세요.");
        return;
      }
      setTrailPick({ hikeId: hike.id, lat, lng, segments, chosen: [] });
      // The paths are on the map, which on a phone is the other tab.
      setMobileTab("map");
      setMapOpen(true);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "등산로를 불러오지 못했습니다.");
    } finally {
      setTrailBusy(false);
    }
  }

  function toggleTrail(id: number) {
    setTrailPick((current) => {
      if (!current) return current;
      const chosen = current.chosen.includes(id)
        ? current.chosen.filter((existing) => existing !== id)
        : [...current.chosen, id];
      return { ...current, chosen };
    });
  }

  async function saveTrailPick() {
    if (!trailPick) return;
    setTrailBusy(true);
    try {
      await saveTrailRoute(trailPick.hikeId, trailPick.lat, trailPick.lng, trailPick.chosen);
      setTrailPick(null);
      router.refresh();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "경로 저장에 실패했습니다.");
    } finally {
      setTrailBusy(false);
    }
  }

  function goToRoot() {
    setActiveLocationId(null);
    setActiveHikeId(null);
    setPinnedHikeId(null);
    setHoveredHikeId(null);
  }

  function previewRoute(
    route: RouteSuggestion,
    place: { name: string | null; center: { lat: number; lng: number } | null },
  ) {
    // Tapping the course a second time puts the map back rather than leaving
    // no way to clear a line that covers the folders underneath it.
    if (suggestedRoute?.route.name === route.name) {
      setSuggestedRoute(null);
      return;
    }
    setSuggestedRoute({
      route,
      center: place.center,
      // Without a mountain name there is nothing to file an album under, so
      // the course name stands in - the member can rename the folder after.
      placeName: place.name ?? route.name,
      resolved: null,
    });
    showMap();
  }

  async function createAlbum(route: RouteSuggestion) {
    const current = suggestedRoute;
    if (!current || current.route.name !== route.name) return;
    // A waypoint name that Places cannot place should not cost the member
    // their album: the mountain itself is location enough to file one under,
    // and they can move the pin afterwards. Only a course with no resolved
    // point AND no known mountain has nowhere at all to go.
    const waypoints =
      current.resolved && current.resolved.length > 0
        ? current.resolved
        : current.center
          ? [{ name: current.placeName, lat: current.center.lat, lng: current.center.lng }]
          : [];
    if (waypoints.length === 0) {
      window.alert("코스 위치를 지도에서 찾지 못했습니다. 지도에서 코스를 먼저 눌러 위치를 불러와주세요.");
      return;
    }
    setCreatingAlbum(true);
    try {
      const { locationId, hikeId } = await createAlbumFromRoute({
        routeName: route.name,
        placeName: current.placeName,
        waypoints,
        track: routeTrack,
        distanceText: route.distanceText,
        notes: route.notes,
      });
      setSuggestedRoute(null);
      setActiveLocationId(locationId);
      setActiveHikeId(hikeId);
      setPinnedHikeId(hikeId);
      router.refresh();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "앨범을 만들지 못했습니다.");
    } finally {
      setCreatingAlbum(false);
    }
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
      <div className="club-toolbar"><label className="club-search"><span aria-hidden="true">⌕</span><input aria-label="장소·활동 검색" placeholder="장소·활동 검색" value={search} onChange={e=>{setSearch(e.target.value);goToRoot();}} />
        {searchMatches.length > 0 && (
          <ul className="club-search-results" role="listbox" aria-label="검색 결과">
            {searchMatches.map(({ hike, location }) => (
              <li key={hike.id}>
                <button type="button" onClick={() => { setSearch(""); openHike(hike); setMapOpen(true); }}>
                  <strong>{hike.title}</strong>
                  <span>{location.name}{hike.date ? ` · ${hike.date}` : ""}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </label><div className="club-filters" aria-label="활동 종류">{(["all", ...ACTIVITY_TYPES] as const).map(type=><button key={type} aria-pressed={activity===type} onClick={()=>{setActivity(type);goToRoot();}}>{type==="all"?"전체":ACTIVITY_LABEL[type]}</button>)}</div></div>

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
                trailSegments={trailPick?.segments ?? null}
                chosenTrailIds={trailPick?.chosen ?? []}
                onToggleTrail={toggleTrail}
                suggestedRoute={suggestedRoute}
                onRouteResolved={(points) =>
                  setSuggestedRoute((current) => (current ? { ...current, resolved: points } : current))
                }
                onRouteMissing={setMissingNames}
                onRouteTrack={setRouteTrack}
                onTrailsUnavailable={setTrailsUnavailable}
              /></MapErrorBoundary>
            ) : (
              <div className="p-4">
                <p className="font-medium">지도를 표시할 수 없습니다</p>
                <p className="mt-1 text-sm text-neutral-600">
                  <code>NEXT_PUBLIC_GOOGLE_MAPS_API_KEY</code>가 설정되지 않았습니다.
                </p>
              </div>
            )}
            {/* Only while a course has a name nothing could place. The club's
                own point for it is the fix, and this is the moment the member
                both knows the answer and has a reason to give it. */}
            {trailsUnavailable && !trailPick && (
              <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex justify-center p-3 pb-[calc(4.2rem+env(safe-area-inset-bottom))]">
                <span className="rounded-full border border-amber-300 bg-amber-50/95 px-3 py-1.5 text-[11px] text-amber-800 shadow backdrop-blur">
                  일부 구간의 실제 경로를 확인하지 못했습니다 · 확인된 등산로만 표시합니다
                </span>
              </div>
            )}
            {missingNames.length > 0 && !trailPick && (
              <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex justify-center p-3 pb-[calc(2.4rem+env(safe-area-inset-bottom))]">
                {namingPoi ? (
                  <PoiForm
                    name={namingPoi}
                    picked={poiPoint}
                    onPickRequest={() => {
                      setPicking(true);
                      setPoiPoint(null);
                    }}
                    onDone={() => {
                      setNamingPoi(null);
                      setPoiPoint(null);
                      setPicking(false);
                      // The course redraws from our own table on the next
                      // preview, so the name it just learned is used at once.
                      setMissingNames((names) => names.filter((n) => n !== namingPoi));
                      router.refresh();
                    }}
                    onCancel={() => {
                      setNamingPoi(null);
                      setPoiPoint(null);
                      setPicking(false);
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => setNamingPoi(missingNames[0])}
                    className="pointer-events-auto m-2 rounded-full border border-neutral-300 bg-white/95 px-3 py-1.5 text-[11px] text-neutral-700 shadow-lg backdrop-blur"
                  >
                    지도에 없는 &lsquo;{missingNames[0]}&rsquo; · 위치 지정
                  </button>
                )}
              </div>
            )}
            {trailPick && (
              <TrailPickBar
                pick={trailPick}
                busy={trailBusy}
                onCancel={() => setTrailPick(null)}
                onSave={saveTrailPick}
              />
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
          (mobileTab === "album" || mobileTab === "ai" || !mapOpen ? "" : "invisible md:visible")
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
          onStartTrailPick={startTrailPick}
          trailBusy={trailBusy}
          focusedPhotoId={focusedPhotoId}
          onFocusedPhotoConsumed={() => setFocusedPhotoId(null)}
          onHoverHike={setHoveredHikeId}
          onBackToRoot={goToRoot}
          onShowOnMap={showMap}
          onPreviewRoute={previewRoute}
          onCreateAlbum={createAlbum}
          activeRouteName={suggestedRoute?.route.name ?? null}
          creatingAlbum={creatingAlbum}
          // Desktop keeps both in one column; a phone shows whichever tab is
          // open, which is what stops the answer and the album list from
          // fighting over the fold.
          showAlbums={!mapOpen || panelTab === "album"}
          showAi={!mapOpen ? false : panelTab !== "album"}
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
            onClick={() => {
              if (id === "map") showMap();
              else {
                setMapOpen(true);
                setMobileTab(id);
              }
            }}
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
