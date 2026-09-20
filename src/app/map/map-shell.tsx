"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { ActivityType, LocationType } from "@/types/database";
import { flattenTrack } from "@/lib/gps/track";
import type { TrackPoint } from "@/lib/gps/track";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { ACTIVITY_TYPES, ACTIVITY_LABEL, withActivity } from "./activity";
import type { CourseInfo } from "./course-info";
import { getThumbnailUrl } from "@/lib/images/url";
import { APIProvider } from "@vis.gl/react-google-maps";
import { SignOutButton } from "@/components/sign-out-button";
import { ViewerName } from "@/app/account/name-form";
import { PendingBadge } from "@/components/pending-badge";
import { SidePanel } from "./side-panel";
import { RecentActivityStrip } from "./recent-activity-strip";
import { ClubCrest } from "@/components/club-crest";
import { loadTrails, saveTrailRoute } from "./route-actions";
import { stitchSegments, type TrailSegment } from "@/lib/routes/trails";
import { formatDistance, trackDistanceMeters } from "@/lib/gps/track";
import { MapErrorBoundary, MapUnavailable } from "./map-error-boundary";
import { PoiForm } from "./poi-form";
import { loadCourseElevation, type CourseElevation } from "./elevation-actions";
import { ElevationProfile } from "./elevation-profile";
import { attachCourseToHike, createAlbumFromRoute, type KnownCourse, type RouteWaypoint } from "./route-album-actions";
import type { RouteSuggestion } from "@/lib/assistant/routes";
import { withWaypoint, type CourseDraft } from "./course-draft";

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
  /** What the answer knew about the course, where it came from one. */
  courseInfo: CourseInfo | null;
  /** The library course this album is a walk of, where it was made from one.
      What lets a course being suggested now show who has already walked it. */
  courseId: string | null;
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
  loading: () => <p className="p-4 text-sm text-club-faint">지도를 불러오는 중…</p>,
});

const MIN_MAP_WIDTH = 320;
const MIN_PANEL_WIDTH = 340;
const DEFAULT_MAP_WIDTH = 0.64;

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

function ActivityFilterIcon({ type }: { type: ActivityType | "all" }) {
  const paths: Record<ActivityType | "all", string> = {
    all: "M4 4h6v6H4z M14 4h6v6h-6z M4 14h6v6H4z M14 14h6v6h-6z",
    hiking: "m3 19 6.5-12 4 7 2.5-4 5 9H3Z M7.4 10.9l2.1 1.6 2-1.6",
    indoor_climbing: "M5 20V5h14v15 M8 9l1-.5 M14 8l1 1 M10 14l1.5-.5 M15 17l1-.5",
    outdoor_wall: "M4 20h16 M7 20V6l5-2 5 3v13 M10 9l1 1 M14 12l-1 1 M10 16l1-.5",
    climbing: "M9 7.5a1.75 1.75 0 1 0 0-3.5 1.75 1.75 0 0 0 0 3.5 M8 10l4 1 3-4 M9 10l-2 5 4 1-1 5 M7 15l-3 5 M18 3l-1 5 2 5-2 8",
  };
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round">
      <path d={paths[type]} />
    </svg>
  );
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
      <div className="pointer-events-auto mx-auto flex max-w-md flex-col gap-2 rounded-xl border border-club-line bg-white/95 p-3 shadow-lg backdrop-blur">
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
            className="flex-1 rounded-lg border border-club-line py-2 text-xs font-medium disabled:opacity-50"
          >
            취소
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={busy || pick.chosen.length === 0}
            className="flex-1 rounded-lg bg-club-ink py-2 text-xs font-medium text-white disabled:opacity-50"
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
  const [filterOpen, setFilterOpen] = useState(false);
  const [mapFailed, setMapFailed] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  // Narrowed by activity first, so a place keeps only that activity's outings
  // rather than all of them; then by what was typed, over what is left.
  const visibleLocations = useMemo(() => {
    const term = search.trim().toLowerCase();
    return withActivity(locations, activity).filter((location) =>
      !term || [location.name, location.region, ...location.hikes.map((hike) => hike.title)]
        .join(" ").toLowerCase().includes(term));
  }, [locations, search, activity]);
  const activityCounts = useMemo<Record<ActivityType | "all", number>>(() => {
    const counts: Record<ActivityType | "all", number> = {
      all: 0,
      hiking: 0,
      indoor_climbing: 0,
      outdoor_wall: 0,
      climbing: 0,
    };
    for (const location of locations) {
      for (const hike of location.hikes) {
        counts.all += 1;
        counts[hike.activityType] += 1;
      }
    }
    return counts;
  }, [locations]);
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
  const [mapExpanded, setMapExpanded] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [mobileTab, setMobileTab] = useState<MobileTab>("map");

  const [activeLocationId, setActiveLocationId] = useState<string | null>(null);
  const [activeHikeId, setActiveHikeId] = useState<string | null>(null);
  const [pinnedHikeId, setPinnedHikeId] = useState<string | null>(null);
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
    /** The line as drawn, kept beside the waypoints it was drawn through.

        Held here rather than in a state of its own, which is where it used to
        live and how an album came to be saved with six waypoints and no line:
        the waypoints are handed up as soon as the names resolve, the line only
        once the router answers, and when that answer was lost to a dropped
        connection the two states disagreed with nothing to notice it. In one
        object they are replaced together or not at all. */
    track: TrackPoint[] | null;
  } | null>(null);
  const [creatingAlbum, setCreatingAlbum] = useState(false);
  // An album waiting for a course's line to be confirmed onto it. The preview
  // machinery below is the same one an answer's courses use; this only
  // remembers which album the result is meant for, and nothing is written
  // until the member says so.
  const [attachTo, setAttachTo] = useState<{ hikeId: string; title: string; courseId: string } | null>(null);
  const [attaching, setAttaching] = useState(false);
  // A course waypoint nothing could place, and the point a member is putting
  // on the map for it. Null unless they asked to record one, so the map stays
  // clear the rest of the time.
  const [missingNames, setMissingNames] = useState<string[]>([]);
  // Points the router worked out from the course's stated length rather than
  // looked up. Held apart from missingNames because the two ask different
  // things of the reader: one is a name they can record, the other is a
  // position they should not trust to the metre.
  const [derivedNames, setDerivedNames] = useState<string[]>([]);
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
  // The course seen side-on, under the map. Held here rather than in the map
  // because it belongs to whichever course is being looked at, and that is
  // either a previewed suggestion or an open album - the map knows about
  // neither on its own.
  const [courseProfile, setCourseProfile] = useState<CourseElevation | null>(null);
  // When the "new location" form is open the map turns into a coordinate
  // picker - far easier than asking anyone to type lat/lng.
  const [picking, setPicking] = useState(false);
  const [pickedPoint, setPickedPoint] = useState<PickedPoint | null>(null);
  // The course editor in the album panel asking for a point - the album's id
  // while it is asking. A third reader of `picking`, alongside the new-location
  // form and the missing-waypoint form; each claims the shared flag and says so
  // with its own here, so the banner on the map can name what the tap is for.
  const [pickingWaypoint, setPickingWaypoint] = useState<string | null>(null);
  // The course being edited. Up here rather than in the panel because reaching
  // the map can unmount the panel - see course-draft.ts.
  const [courseDraft, setCourseDraft] = useState<CourseDraft | null>(null);

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

  /**
   * The albums already walked on each library course.
   *
   * Built from the albums this screen has anyway rather than asked for: every
   * hike is already loaded to draw the map, so matching them to the courses
   * being suggested costs nothing and stays right when an album is added,
   * where a count baked into a cached answer would go stale.
   *
   * Oldest first - the point of showing these is that somebody went before,
   * and the first time is the one worth seeing.
   */
  const albumsByCourse = useMemo(() => {
    const byCourse = new Map<string, MapHike[]>();
    for (const hike of allHikes) {
      if (!hike.courseId) continue;
      const held = byCourse.get(hike.courseId);
      if (held) held.push(hike);
      else byCourse.set(hike.courseId, [hike]);
    }
    for (const list of byCourse.values()) list.sort((a, b) => a.date.localeCompare(b.date));
    return byCourse;
  }, [allHikes]);
  const pinnedHike = allHikes.find((h) => h.id === pinnedHikeId) ?? null;

  function showMap() {
    setMobileTab("map");
    // 지도 접기 is hidden below md, but the flag survives a desktop session
    // being narrowed to a phone, and an empty 지도 tab would be a dead end.
    setMapOpen(true);
  }

  function openLocation(locationId: string) {
    setMapExpanded(false);
    setActiveLocationId(locationId);
    setActiveHikeId(null);
    // A mountain marker opens its album list only. Route geometry belongs to
    // the specific outing the member chooses from that list.
    setPinnedHikeId(null);
    // Only one half is on screen on a phone, so a marker tap that left the map
    // up would look like nothing had happened: hand over to the list it opened.
    setMobileTab("map");
  }

  function openHike(hike: MapHike) {
    setMapExpanded(false);
    setActiveLocationId(hike.locationId);
    setActiveHikeId(hike.id);
    // The map comes back with it. An album's route is the thing worth seeing,
    // and it was reachable only by finding 지도 펼치기 afterwards - because
    // opening the album list had closed the map on the way in.
    setMapOpen(true);
    // Clicking a hike pins its route on the map.
    setPinnedHikeId(hike.id);
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
    // The course editor is in the album panel, which on a phone is the other
    // tab - so go back to it, where the new row is waiting for its name. The
    // point is added here rather than handed to the panel: the panel may not
    // be mounted at this moment, and the draft it edits lives up here anyway.
    if (pickingWaypoint) {
      const hike = allHikes.find((h) => h.id === pickingWaypoint);
      if (hike) setCourseDraft((draft) => withWaypoint(draft, hike, point));
      setPickingWaypoint(null);
      setPicking(false);
      setMobileTab("album");
      return;
    }
    setPickedPoint(point);
    // The form waiting on this point is in the other tab, so a phone goes back
    // to it rather than leaving the member on a map that looks unchanged.
    setMobileTab("album");
  }

  function pickWaypoint(hikeId: string) {
    setPickingWaypoint(hikeId);
    setPicking(true);
    // On a phone the map is the other tab, and a picker nobody can see is a
    // button that does nothing.
    setMapOpen(true);
    setMobileTab("map");
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
      setAttachTo(null);
      setSuggestedRoute(null);
      setTrailPick({ hikeId: hike.id, lat, lng, segments, chosen: [] });
      // The paths are on the map, which on a phone is the other tab.
      setMobileTab("map");
      setMapOpen(true);
    } catch {
      window.alert("등산로를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.");
    } finally {
      setTrailBusy(false);
    }
  }

  /**
   * Draws a course we already hold, for the member to confirm onto their album.
   *
   * Nothing new is needed to draw it: a library course has the same shape as
   * one an answer suggested - a name and places in walking order - so it goes
   * through the preview already on screen, which resolves the names and pulls
   * the line onto real trails. No model is asked anything.
   */
  function useCourseForHike(hike: MapHike, course: KnownCourse) {
    const place = locations.find((location) => location.id === hike.locationId) ?? null;
    // Picking segments by hand and accepting a held course are two answers to
    // the one question - what line does this album have - so starting either
    // ends the other. Both bars were on screen at once, asking it twice.
    setTrailPick(null);
    setAttachTo({ hikeId: hike.id, title: hike.title, courseId: course.id });
    setSuggestedRoute({
      route: {
        name: course.name,
        waypoints: course.waypoints,
        distanceText: course.distanceText,
        durationText: course.durationText,
        difficulty: course.difficulty,
        description: null,
        notes: null,
        sourceUrls: [],
        courseId: course.id,
      },
      center: place ? { lat: place.lat, lng: place.lng } : null,
      placeName: place?.name ?? hike.title,
      resolved: null,
      track: null,
    });
    setMapOpen(true);
    setMobileTab("map");
  }

  async function saveAttachedCourse() {
    if (!attachTo || !suggestedRoute?.track) return;
    setAttaching(true);
    try {
      const result = await attachCourseToHike({
        hikeId: attachTo.hikeId,
        courseId: attachTo.courseId,
        waypoints: suggestedRoute.resolved ?? [],
        track: flattenTrack(suggestedRoute.track),
      });
      if (!result.ok) {
        window.alert(result.reason);
        return;
      }
      setAttachTo(null);
      setSuggestedRoute(null);
      router.refresh();
    } catch {
      window.alert("경로를 저장하지 못했습니다. 잠시 후 다시 시도해주세요.");
    } finally {
      setAttaching(false);
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
      const result = await saveTrailRoute(trailPick.hikeId, trailPick.lat, trailPick.lng, trailPick.chosen);
      if (!result.ok) {
        window.alert(result.reason);
        return;
      }
      setTrailPick(null);
      router.refresh();
    } catch {
      window.alert("경로를 저장하지 못했습니다. 잠시 후 다시 시도해주세요.");
    } finally {
      setTrailBusy(false);
    }
  }

  function goToRoot() {
    setMapExpanded(false);
    setActiveLocationId(null);
    setActiveHikeId(null);
    setPinnedHikeId(null);
    setMobileTab("map");
  }

  function previewRoute(
    route: RouteSuggestion,
    place: { name: string | null; center: { lat: number; lng: number } | null },
  ) {
    // Tapping the course a second time puts the map back rather than leaving
    // no way to clear a line that covers the folders underneath it.
    if (suggestedRoute?.route.name === route.name) {
      setSuggestedRoute(null);
      setDerivedNames([]);
      return;
    }
    setSuggestedRoute({
      route,
      center: place.center,
      // Without a mountain name there is nothing to file an album under, so
      // the course name stands in - the member can rename the folder after.
      placeName: place.name ?? route.name,
      resolved: null,
      track: null,
    });
    showMap();
  }

  async function createAlbum(route: RouteSuggestion, asked: string) {
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
      const result = await createAlbumFromRoute({
        routeName: route.name,
        placeName: current.placeName,
        courseId: route.courseId ?? null,
        waypoints,
        track: current.track ? flattenTrack(current.track) : null,
        distanceText: route.distanceText,
        durationText: route.durationText,
        difficulty: route.difficulty,
        notes: route.notes,
        sources: route.sourceUrls,
        question: asked,
      });
      if (!result.ok) {
        window.alert(result.reason);
        return;
      }
      setSuggestedRoute(null);
      setActiveLocationId(result.value.locationId);
      setActiveHikeId(result.value.hikeId);
      setPinnedHikeId(result.value.hikeId);
      router.refresh();
    } catch {
      // Only a fault reaches here: every refusal comes back as a value above,
      // and a thrown message is replaced by the production build anyway.
      window.alert("앨범을 만들지 못했습니다. 잠시 후 다시 시도해주세요.");
    } finally {
      setCreatingAlbum(false);
    }
  }

  // The line to profile: the previewed course while one is being looked at,
  // and otherwise the open album's own track. A member's GPX is the better
  // record of the two and wins whenever there is no suggestion on screen.
  const profileTrack = suggestedRoute?.track ?? pinnedHike?.track ?? null;
  const profileKey = profileTrack
    ? `${suggestedRoute?.track ? "route" : pinnedHike?.id}:${profileTrack.length}`
    : null;
  const profileNames = suggestedRoute?.track
    ? (suggestedRoute.resolved ?? [])
    : (pinnedHike?.routeWaypoints ?? []);

  useEffect(() => {
    if (!profileTrack || profileTrack.length < 2) {
      setCourseProfile(null);
      return;
    }
    let cancelled = false;
    setCourseProfile(null);
    loadCourseElevation(flattenTrack(profileTrack), profileNames)
      .then((found) => {
        if (!cancelled) setCourseProfile(found);
      })
      .catch(() => {
        // The map and the course are both already drawn. A profile that could
        // not be worked out is one picture missing, not a broken screen.
      });
    return () => {
      cancelled = true;
    };
    // Keyed by which line it is and how long, not by the array's identity:
    // every answer render rebuilds these and would otherwise re-ask.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileKey]);

  // Read only at md and above. Left unset until measured so the pane keeps its
  // natural width for the one frame before the effect runs.
  const mapWidthStyle =
    mapWidth === null ? undefined : ({ "--map-width": mapWidth + "px" } as CSSProperties);

  /**
   * Back to the screen the map opens on.
   *
   * The title is a link to /map, and on every other page that link is the
   * whole of what going home means. On /map itself the route does not change,
   * so pressing it did nothing visible: the album someone had opened, the
   * course they were previewing, the filter they had set and the panel they
   * had pushed the map behind all stayed exactly as they were. Here the state
   * is the screen, so going home has to clear it.
   */
  const goHome = useCallback(() => {
    setActiveLocationId(null);
    setActiveHikeId(null);
    setPinnedHikeId(null);
    setFocusedPhotoId(null);
    setSuggestedRoute(null);
    setAttachTo(null);
    setCourseProfile(null);
    setSearch("");
    setActivity("all");
    setFilterOpen(false);
    setAccountOpen(false);
    setMobileTab("map");
    setMapOpen(true);
    setMapExpanded(false);
    // Half-finished map interactions. Leaving one armed means the next tap on
    // what looks like a fresh home screen drops a point or picks a trail.
    setPicking(false);
    setPickedPoint(null);
    setPoiPoint(null);
    setNamingPoi(null);
    setTrailPick(null);
    setMissingNames([]);
    setDerivedNames([]);
  }, []);

  const shell = (
    <div className="club-app flex h-app w-full flex-col overflow-hidden">
      <header className="club-header">
        <Link
          href="/map"
          className="club-brand"
          aria-label="Kyunghee University Alpine Club — 처음 화면으로"
          onClick={goHome}
        >
          <ClubCrest />
          <span className="club-brand-copy"><strong className="club-brand-fullname"><span>Kyunghee University</span><span>Alpine Club</span></strong><small>경희대학교 산악부</small></span>
        </Link>
        <div className={"club-header-tools " + (mobileTab === "ai" || accountOpen ? "club-header-tools-mobile-hidden" : "")}>
          <div className="club-filter-menu">
            <button
              type="button"
              className="club-filter-trigger"
              aria-expanded={filterOpen}
              aria-controls="activity-filter-menu"
              onClick={() => setFilterOpen((open) => !open)}
            >
              <ActivityFilterIcon type={activity} />
              <span>{activity === "all" ? "전체 앨범" : ACTIVITY_LABEL[activity]}</span>
              <svg className="club-filter-chevron" aria-hidden="true" viewBox="0 0 16 16"><path d="m4 6 4 4 4-4"/></svg>
            </button>
            {filterOpen && (
              <div id="activity-filter-menu" className="club-filter-popover" role="menu" aria-label="활동 종류">
                {(["all", ...ACTIVITY_TYPES] as const).map((type) => (
                  <button
                    key={type}
                    type="button"
                    role="menuitemradio"
                    aria-checked={activity === type}
                    onClick={() => {
                      setActivity(type);
                      setFilterOpen(false);
                      goToRoot();
                      setMapOpen(true);
                      setMobileTab("album");
                    }}
                  >
                    <ActivityFilterIcon type={type} />
                    <span><strong>{type === "all" ? "전체 앨범" : ACTIVITY_LABEL[type]}</strong><small>{activityCounts[type]}개 앨범</small></span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <label className="club-search">
            <span className="club-search-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/></svg></span>
            <input aria-label="장소·활동 검색" placeholder="장소, 산, 암장, 활동 검색" value={search} onFocus={() => setFilterOpen(false)} onChange={e=>{setSearch(e.target.value);goToRoot();}} />
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
          </label>
        </div>
        <div className="club-header-actions"><button className="club-profile" aria-label="내 정보" aria-expanded={accountOpen} onClick={() => setAccountOpen(!accountOpen)}><NavIcon kind="profile"/></button></div>
      </header>
      {accountOpen && <section className="club-account" aria-label="내 정보">{viewerName && <ViewerName initialName={viewerName} isAdmin={isAdmin} />}<Link href="/photos/upload">사진 업로드</Link><Link href="/members">부원</Link>{isAdmin && <Link href="/admin/members">관리자 <PendingBadge count={pendingCount}/></Link>}<SignOutButton/><button onClick={() => setAccountOpen(false)}>닫기</button></section>}

    <div ref={containerRef} className="club-workspace relative flex min-h-0 w-full flex-1 overflow-hidden">
      {mapOpen && (
        <>
          {/* Below md the two panes sit on top of each other and the tab bar
              picks one. They are hidden with visibility rather than unmounted,
              so the map keeps its tiles, its camera and its WebGL context
              across a tab switch instead of reloading on every one. */}
          <div
            style={mapWidthStyle}
            className={
              "absolute inset-0 flex w-full flex-col md:relative md:inset-auto md:shrink-0 " +
              (mobileTab === "album" ? "md:w-[44%] " : "md:w-[var(--map-width)] ") +
              (mobileTab === "map" ? "" : "invisible md:visible")
            }
          >
            {/* The map and everything that floats over it. The profile below is
                a sibling rather than another overlay: it is read, not pointed
                at, and a chart lying across the ground it describes helps
                nobody. */}
            <div className="club-map-frame relative min-h-0 flex-1">
            {mapFailed ? <MapUnavailable onShowAlbum={() => {setMapOpen(false); setMobileTab("album");}} /> : apiKey ? (
              <MapErrorBoundary onShowAlbum={() => {setMapOpen(false); setMobileTab("album");}}><MapView
                mapId={mapId}
                locations={visibleLocations}
                activeLocationId={activeLocationId}
                selectedHike={pinnedHike}
                onSelectLocation={(id) => {openLocation(id);setMobileTab("map");}}
                onSelectPhoto={selectPhoto}
                mapExpanded={mapExpanded}
                showSizeToggle={!activeLocationId && !activeHikeId && mobileTab === "map"}
                onToggleMapSize={() => setMapExpanded((expanded) => !expanded)}
                picking={picking}
                pickedPoint={pickedPoint}
                onPickPoint={pickPoint}
                draftWaypoints={courseDraft && courseDraft.hikeId === pinnedHike?.id
                  ? courseDraft.waypoints : null}
                trailSegments={trailPick?.segments ?? null}
                chosenTrailIds={trailPick?.chosen ?? []}
                onToggleTrail={toggleTrail}
                suggestedRoute={suggestedRoute}
                onRouteResolved={(points) =>
                  setSuggestedRoute((current) => (current ? { ...current, resolved: points } : current))
                }
                onRouteMissing={setMissingNames}
                onRouteDerived={setDerivedNames}
                onRouteTrack={(track) =>
                  setSuggestedRoute((current) => (current ? { ...current, track } : current))
                }
                onTrailsUnavailable={setTrailsUnavailable}
              /></MapErrorBoundary>
            ) : (
              <div className="p-4">
                <p className="font-medium">지도를 표시할 수 없습니다</p>
                <p className="mt-1 text-sm text-club-muted">
                  <code>NEXT_PUBLIC_GOOGLE_MAPS_API_KEY</code>가 설정되지 않았습니다.
                </p>
              </div>
            )}
            {/* New-location picking, shown wherever the map actually is - which
                on a phone is a different tab from the album panel's own
                banner, and "지도 열기" used to hand someone off to a screen
                with no way back except finding a small button they had
                already left behind. This is that way back, always in view
                while `picking` is on for this flow specifically - excluded
                when `namingPoi` is set, because that is the missing-waypoint
                flow reusing the same shared flag, with its own bar below. */}
            {pickingWaypoint && (
              <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex justify-center p-3">
                <span className="pointer-events-auto flex items-center gap-2 rounded-full border border-club-line bg-white/95 px-3 py-1.5 text-[11px] text-club-ink-soft shadow-lg backdrop-blur">
                  지도를 클릭해 경유지를 추가하세요
                  <button
                    type="button"
                    onClick={() => { setPickingWaypoint(null); setPicking(false); }}
                    className="rounded-full border border-club-line px-2 py-0.5 font-medium text-club-ink"
                  >
                    취소
                  </button>
                </span>
              </div>
            )}
            {picking && !namingPoi && !pickingWaypoint && (
              <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex justify-center p-3">
                <span className="pointer-events-auto flex items-center gap-2 rounded-full border border-club-line bg-white/95 px-3 py-1.5 text-[11px] text-club-ink-soft shadow-lg backdrop-blur">
                  지도를 클릭해 새 장소의 위치를 지정하세요
                  <button
                    type="button"
                    onClick={() => { setPicking(false); setPickedPoint(null); }}
                    className="rounded-full border border-club-line px-2 py-0.5 font-medium text-club-ink"
                  >
                    취소
                  </button>
                </span>
              </div>
            )}
            {/* A held course drawn over an album that has no line yet, waiting
                to be kept or dropped. Deliberately not saved on the tap that
                drew it: the whole point of offering the library instead of a
                blank map is that the member gets to see what they are about to
                accept. */}
            {attachTo && (
              <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex justify-center p-3">
                <span className="pointer-events-auto flex flex-wrap items-center justify-center gap-2 rounded-2xl border border-club-line bg-white/95 px-3 py-2 text-[11px] text-club-ink-soft shadow-lg backdrop-blur">
                  {/* Says what is missing before it is kept, not after. The
                      approach to 인수봉 names five places and two of them -
                      비둘기샘, 인수봉 고독길 들머리 - are on no gazetteer, so the
                      line stopped at 인수암 and its end label read 인수암. Saved
                      silently that looks like the course ends there. */}
                  {suggestedRoute?.track ? (
                    <>
                      &lsquo;{attachTo.title}&rsquo; 앨범에 이 경로를 저장할까요?
                      {missingNames.length > 0 && (
                        <span className="block w-full text-amber-700">
                          {missingNames.join(", ")} 은(는) 지도에서 찾지 못해 선이 그 앞에서 끝납니다.
                          저장 후 아래 &lsquo;위치 지정&rsquo;으로 한 번 찍어두면 다음부터 이어집니다.
                        </span>
                      )}
                    </>
                  ) : "경로를 그리는 중…"}
                  <button
                    type="button"
                    onClick={saveAttachedCourse}
                    disabled={!suggestedRoute?.track || attaching}
                    className="rounded-full bg-[#5b1a23] px-2.5 py-1 font-medium text-white disabled:opacity-40"
                  >
                    {attaching ? "저장 중…" : "저장"}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setAttachTo(null); setSuggestedRoute(null); }}
                    className="rounded-full border border-club-line px-2.5 py-1 font-medium text-club-ink"
                  >
                    취소
                  </button>
                </span>
              </div>
            )}
            {/* Only while a course has a name nothing could place. The club's
                own point for it is the fix, and this is the moment the member
                both knows the answer and has a reason to give it. */}
            {/* A course drawn through a point we guessed at. The line is still
                worth showing - it is the right paths, and the alternative was a
                course that began two kilometres up the hill with no sign that
                its start was missing - but a guessed trailhead read as a fact
                is worse than no line, so it is named and called an estimate. */}
            {derivedNames.length > 0 && !trailPick && (
              <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex justify-center p-3 pb-[calc(6.0rem+env(safe-area-inset-bottom))]">
                <span className="max-w-[min(26rem,calc(100vw-2rem))] rounded-full border border-amber-300 bg-amber-50/95 px-3 py-1.5 text-center text-[11px] text-amber-800 shadow backdrop-blur">
                  &lsquo;{derivedNames.join(", ")}&rsquo;의 위치는 코스 거리로 추정했습니다 · 실제와 다를 수 있습니다
                </span>
              </div>
            )}
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
                    className="pointer-events-auto m-2 rounded-full border border-club-line bg-white/95 px-3 py-1.5 text-[11px] text-club-ink-soft shadow-lg backdrop-blur"
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
            {courseProfile && <ElevationProfile data={courseProfile} />}
          </div>

          <div
            onPointerDown={() => setDragging(true)}
            className={`club-divider hidden shrink-0 cursor-col-resize md:flex ${
              dragging ? "is-dragging" : ""
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
          "club-album club-side-panel absolute inset-0 flex min-w-0 flex-col bg-white md:relative md:inset-auto md:flex-1 " +
          // A collapsed map leaves the 지도 tab with nothing in it, so on a
          // phone the panel stays up until 지도 is tapped and re-opens it.
          (mobileTab === "album" || mobileTab === "ai" || !mapOpen ? "" : "invisible md:visible")
        }
      >
        {mobileTab === "album" && !activeLocationId && !activeHikeId && (
          <div className="club-album-mode-heading">
            <div><small>ACTIVITY ARCHIVE</small><strong>{activity === "all" ? "전체 앨범" : `${ACTIVITY_LABEL[activity]} 앨범`}</strong></div>
            <button type="button" onClick={() => { setActivity("all"); setMobileTab("map"); }}>
              <NavIcon kind="map"/>지도 · KHUAC AI
            </button>
          </div>
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
          onUseCourse={useCourseForHike}
          trailBusy={trailBusy}
          onPickWaypoint={pickWaypoint}
          courseDraft={courseDraft}
          onCourseDraftChange={setCourseDraft}
          focusedPhotoId={focusedPhotoId}
          onFocusedPhotoConsumed={() => setFocusedPhotoId(null)}
          onBackToRoot={goToRoot}
          onShowOnMap={showMap}
          onPreviewRoute={previewRoute}
          onCreateAlbum={createAlbum}
          albumsByCourse={albumsByCourse}
          activeRouteName={suggestedRoute?.route.name ?? null}
          creatingAlbum={creatingAlbum}
          // Desktop keeps both in one column; a phone shows whichever tab is
          // open, which is what stops the answer and the album list from
          // fighting over the fold.
          showAlbums={mobileTab === "album"}
          showAi={mobileTab !== "album"}
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

      {mapOpen && !mapExpanded && !activeLocationId && !activeHikeId && mobileTab === "map" && (
        <RecentActivityStrip
          locations={locations}
          onOpenHike={openHike}
          onViewAll={() => { setActivity("all"); setMobileTab("album"); }}
        />
      )}

      {/* Bottom rather than top: this is the control a member reaches for most
          often on a phone, and the bottom edge is where the thumb already is.
          The padding clears the home indicator on a notched device. */}
      <nav
        aria-label="화면 전환"
        className="club-bottom-nav flex shrink-0 border-t border-club-line bg-white pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        {MOBILE_TABS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            aria-pressed={mobileTab === id}
            onClick={() => {
              setAccountOpen(false);
              if (id === "map") showMap();
              else {
                setMapOpen(true);
                setMobileTab(id);
              }
            }}
            className={
              "flex-1 py-3 text-sm " +
              (mobileTab === id
                ? "font-semibold text-club-ink shadow-[inset_0_2px_0_0_currentColor]"
                : "text-club-muted")
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
