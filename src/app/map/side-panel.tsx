"use client";

import Link from "next/link";
import { ClubCrest } from "@/components/club-crest";
import { RecentAlbums } from "./recent-albums";
import { KhuacAiCard } from "./khuac-ai-card";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { ActivityType, ClimbingStyle, LocationType } from "@/types/database";
import { formatDistance, trackDistanceMeters, type TrackPoint } from "@/lib/gps/track";
import type { MapHike, MapLocation, PickedPoint } from "./map-shell";
import { HikeDetail } from "./hike-detail";
import { albumCover } from "./album-cover";
import type { CourseDraft } from "./course-draft";
import { NewLocationForm } from "./new-location-form";
import { NewHikeForm } from "./new-hike-form";
import { searchCourseLibraryPlaces, type KnownCourse } from "./route-album-actions";
import { ACTIVITY_COLOR, ACTIVITY_LABEL, CLIMBING_STYLE_LABEL, folderMarkerColor, groupHikesByActivity } from "./activity";
import { getThumbnailUrl } from "@/lib/images/url";
import { isValidGps } from "@/lib/gps/validate";
import { deleteLocation } from "./admin-actions";
import { renameLocation } from "./actions";
import type { RouteSuggestion } from "@/lib/assistant/routes";

export const TYPE_LABEL: Record<LocationType, string> = {
  // A place's kind, not an outing's - that is ActivityType. A mountain holds
  // its walks and its climbs together (삼성산 carries 숨은암장), so labelling
  // it "워킹" told a member filing a climb to pick the wrong thing.
  mountain: "산 (워킹·암벽등반)",
  climbing_gym: "실내클라이밍짐",
  // An artificial outdoor wall - 뚝섬 and the like - the same thing
  // ActivityType.outdoor_wall means. Natural rock is multi_pitch/hard_free.
  crag: "외벽",
  multi_pitch: "멀티피치",
  hard_free: "하드프리",
};

/** Stands in for 새 장소 추가/새 앨범 만들기 wherever canEdit is false, so a
    stranger or a still-pending member sees why the control is missing instead
    of just not seeing it - and gets the one thing that would fix it. */
function LoginPrompt({ children }: { children: string }) {
  return (
    <Link
      href="/login"
      className="block w-full rounded-lg border border-dashed border-club-line py-2.5 text-center text-sm text-club-muted hover:border-club-muted md:py-2 md:text-xs"
    >
      {children}
    </Link>
  );
}

/** Same colour the marker uses, so a badge here reads as that dot out there. */
function ActivityTag({ type }: { type: ActivityType }) {
  return (
    <span
      className="shrink-0 rounded px-1.5 py-px text-xs font-medium text-white"
      style={{ backgroundColor: ACTIVITY_COLOR[type] }}
    >
      {ACTIVITY_LABEL[type]}
    </span>
  );
}

/** The folder's own dot, repeated beside its name in the list. Grey when the
    folder mixes kinds of outing - the activity badges below carry the detail. */
function FolderDot({ location }: { location: MapLocation }) {
  return (
    <span
      className="h-2.5 w-2.5 shrink-0 rounded-full"
      style={{ backgroundColor: folderMarkerColor(location.hikes.map((h) => h.activityType)) }}
    />
  );
}

/** Small preview of a route, shown next to each hike in a location's list. */
/**
 * A route sketch, or the first photo when there is no route.
 *
 * Most activities have no GPX - a track is only drawn from a real one now - so
 * "경로 없음" would be what nearly every row showed. A thumbnail says more
 * about an outing than the absence of a file does.
 */
function TrackThumb({
  track,
  pinned,
  hike,
}: {
  track: TrackPoint[] | null;
  pinned: boolean;
  hike: MapHike;
}) {
  if (!track || track.length < 2) {
    const cover = albumCover(hike.photos);
    if (cover) {
      return (
        <span className="h-11 w-14 shrink-0 overflow-hidden rounded border border-club-line bg-club-sunken">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={getThumbnailUrl(cover.storageKey)}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover"
          />
        </span>
      );
    }
    return (
      <span className="flex h-11 w-14 shrink-0 items-center justify-center rounded border border-club-line bg-club-paper text-center text-xs leading-tight text-club-faint">
        사진 없음
      </span>
    );
  }

  const lats = track.map((p) => p[0]);
  const lngs = track.map((p) => p[1]);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const spanLat = Math.max(maxLat - minLat, 1e-6);
  const spanLng = Math.max(maxLng - minLng, 1e-6);

  // y is flipped: latitude grows north, SVG coordinates grow downward.
  const d = track
    .map((p, i) => {
      const x = ((p[1] - minLng) / spanLng) * 100;
      const y = 100 - ((p[0] - minLat) / spanLat) * 100;
      return (i === 0 ? "M" : "L") + x.toFixed(1) + "," + y.toFixed(1);
    })
    .join(" ");

  return (
    <span className="h-11 w-14 shrink-0 rounded border border-club-line bg-club-paper p-1">
      <svg viewBox="-6 -6 112 112" className="h-full w-full" preserveAspectRatio="xMidYMid meet">
        <path
          d={d}
          fill="none"
          stroke={pinned ? "#D23B2E" : "#4A6B52"}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </span>
  );
}

function hikeMeta(hike: MapHike) {
  const parts: string[] = [];
  // Leads the line, ahead of the date: 멀티피치/하드프리 is what tells two
  // 암벽등반 rows in the same mountain's group apart, and the ACTIVITY_TYPES
  // group heading above them already says 암벽등반 once for both.
  if (hike.climbingStyle) parts.push(CLIMBING_STYLE_LABEL[hike.climbingStyle]);
  parts.push(new Date(hike.date).toLocaleDateString("ko-KR"));
  if (hike.track && hike.track.length >= 2) {
    parts.push(formatDistance(trackDistanceMeters(hike.track)));
  }
  const mapped = hike.photos.filter((p) => isValidGps(p.exifLat, p.exifLng)).length;
  parts.push("사진 " + hike.photos.length);
  // Worth saying out loud: it is what decides whether this row has anything to
  // show on the map at all.
  if (mapped > 0) parts.push("위치 " + mapped);
  return parts;
}

export function SidePanel({
  locations,
  activeLocation,
  activeHikeId,
  pinnedHikeId,
  onOpenLocation,
  onOpenHike,
  onStartTrailPick,
  onUseCourse,
  onPickWaypoint,
  courseDraft,
  onCourseDraftChange,
  trailBusy,
  focusedPhotoId,
  onFocusedPhotoConsumed,
  onBackToRoot,
  onShowOnMap,
  isAdmin,
  canEdit,
  picking,
  pickedPoint,
  onPickingChange,
  onPickPoint,
  onPreviewRoute,
  onCreateAlbum,
  albumsByCourse,
  activeRouteName,
  creatingAlbum,
  showAlbums,
  showAi,
  aiSelected,
  onPickCourse,
  allLocationNames,
}: {
  locations: MapLocation[];
  activeLocation: MapLocation | null;
  activeHikeId: string | null;
  pinnedHikeId: string | null;
  onOpenLocation: (locationId: string) => void;
  onOpenHike: (hike: MapHike) => void;
  onStartTrailPick: (hike: MapHike, lat: number, lng: number) => void;
  onUseCourse: (hike: MapHike, course: KnownCourse) => void;
  /** Course editing needs a point from the map, and the draft it edits is held
      above this panel because reaching the map can unmount it. */
  onPickWaypoint: (hikeId: string) => void;
  courseDraft: CourseDraft | null;
  onCourseDraftChange: (draft: CourseDraft | null) => void;
  trailBusy: boolean;
  focusedPhotoId: string | null;
  onFocusedPhotoConsumed: () => void;
  onBackToRoot: () => void;
  // Below md the map is a tab away rather than beside the panel, so every
  // screen that puts something on the map needs a way to go and look at it.
  onShowOnMap: () => void;
  isAdmin: boolean;
  /** An approved member. False for a stranger browsing the read-only map and
      for a member still pending - both see the same album lists, neither
      sees 새 장소 추가/새 앨범 만들기/수정/삭제, which would only throw. */
  canEdit: boolean;
  picking: boolean;
  pickedPoint: PickedPoint | null;
  onPickingChange: (picking: boolean) => void;
  onPickPoint: (point: PickedPoint) => void;
  onPreviewRoute: (
    route: RouteSuggestion,
    place: { name: string | null; center: { lat: number; lng: number } | null },
  ) => void;
  onCreateAlbum: (route: RouteSuggestion, asked: string) => void;
  /** Albums already walked on each library course, keyed by course id. */
  albumsByCourse: Map<string, MapHike[]>;
  activeRouteName: string | null;
  creatingAlbum: boolean;
  /** False beside the map, where the 앨범 screen already carries these lists. */
  showAlbums: boolean;
  /** False on the phone's 앨범 tab, which is the album list on its own. */
  showAi: boolean;
  /** The KHUAC AI tab is the one selected, so it outranks an open album. */
  aiSelected: boolean;
  /** A library course chosen while making a new album - drawn for confirmation. */
  onPickCourse: (
    course: KnownCourse,
    place: MapLocation,
    draft: { activityType: ActivityType; climbingStyle: ClimbingStyle | null; date: string },
  ) => void;
  /** Every folder's name, unfiltered. `locations` above is what the site-wide
      활동 필터 and search leave visible, so checking a new name against it
      would miss 삼성산 whenever the screen is narrowed to 암벽등반 and 삼성산
      holds no climb yet. */
  allLocationNames: string[];
}) {
  const router = useRouter();
  const [rootView, setRootView] = useState<"recent" | "places">("recent");
  const [query, setQuery] = useState("");
  const [deleting, setDeleting] = useState(false);
  // Holds the id of the folder being renamed, not a boolean: leaving the folder
  // and opening another one must not carry a stale draft over to it.
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [savingName, setSavingName] = useState(false);

  async function saveName(location: MapLocation) {
    const name = draftName.trim();
    if (!name) {
      window.alert("장소 이름을 입력해주세요.");
      return;
    }
    if (name === location.name) {
      setRenamingId(null);
      return;
    }
    setSavingName(true);
    try {
      await renameLocation(location.id, name);
      setRenamingId(null);
      router.refresh();
    } catch (err) {
      // The input stays open with the typed name so a failed save is retryable.
      window.alert(err instanceof Error ? err.message : "장소 이름 변경에 실패했습니다.");
    } finally {
      setSavingName(false);
    }
  }

  async function removeLocation(location: MapLocation) {
    const message = `'${location.name}' 장소와 그 안의 모든 활동·사진이 함께 삭제됩니다. 계속할까요?`;
    if (!window.confirm(message)) return;
    setDeleting(true);
    try {
      await deleteLocation(location.id);
      // The open folder no longer exists, so fall back to the album list.
      onBackToRoot();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "장소 삭제에 실패했습니다.");
    } finally {
      setDeleting(false);
      // Refetched even when the action reports a failure: it drops the rows
      // before its storage cleanup, so a late error still leaves a folder
      // that is gone from the database but alive on the map.
      router.refresh();
    }
  }

  // The panel lists folders, not activities: a folder with no activity yet
  // still has to show up (it exists on the map), and one with several has to
  // open its own list rather than jumping into whichever activity came first.
  const folders = useMemo(() => {
    const q = query.trim().toLowerCase();
    return locations
      .filter((location) => {
        if (!q) return true;
        // A folder matches on its own fields or on any activity inside it.
        return [
          location.name,
          location.region ?? "",
          ...location.hikes.flatMap((hike) => [
            hike.title,
            hike.date,
            ...hike.photos.map((p) => p.uploaderName),
          ]),
        ]
          .join(" ")
          .toLowerCase()
          .includes(q);
      })
      .map((location) => {
        // page.tsx hands hikes over newest-first.
        const latestHike: MapHike | null = location.hikes[0] ?? null;
        return {
          location,
          latestHike,
          sortKey: latestHike?.date ?? location.createdAt.slice(0, 10),
        };
      })
      .sort(
        (a, b) =>
          b.sortKey.localeCompare(a.sortKey) ||
          a.location.name.localeCompare(b.location.name, "ko"),
      );
  }, [locations, query]);

  // Only asked when the plain search above found nothing - the common case
  // is typing a mountain's own name, which folders already answers with no
  // round trip. 삼성산 숨은암장 is the case this exists for: five courses
  // already sit in course_library named for it, but before any album there
  // existed, folders had no field of its own to match "숨은암장" against at
  // all, and nothing said 삼성산 was where it lived.
  const [courseMatches, setCourseMatches] = useState<{ mountain: string; courseName: string }[]>([]);
  useEffect(() => {
    const q = query.trim();
    if (folders.length > 0 || q.length < 2) {
      setCourseMatches([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      searchCourseLibraryPlaces(q)
        .then((rows) => { if (!cancelled) setCourseMatches(rows); })
        .catch(() => { if (!cancelled) setCourseMatches([]); });
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [query, folders.length]);

  // Only a mountain course_library and locations actually agree on - a course
  // filed under a mountain nobody has made a folder for yet has nowhere this
  // can send a member, and guessing at creating one on their behalf is a
  // bigger decision than a search suggestion should make.
  const courseMatchLocations = courseMatches
    .map((match) => ({ match, location: locations.find((l) => l.name === match.mountain) ?? null }))
    .filter((row): row is { match: typeof courseMatches[number]; location: MapLocation } => row.location !== null);

  const activeHike = activeLocation?.hikes.find((h) => h.id === activeHikeId) ?? null;

  // Not while the member is asking KHUAC AI something. This returned an open
  // album before looking at the tabs at all, so on a phone the AI tab did
  // nothing once an album was open: the tab changed, this did not, and the
  // screen sat there. Only the AI tab overrides it - 지도 also leaves
  // mobileTab elsewhere while an album is open, and that must still come back
  // to the album rather than to the assistant.
  if (activeHike && activeLocation && !aiSelected) {
    return (
      <HikeDetail
        location={activeLocation}
        hike={activeHike}
        onBackToRoot={onBackToRoot}
        onBackToLocation={() => onOpenLocation(activeLocation.id)}
        onShowOnMap={onShowOnMap}
        isAdmin={isAdmin}
        canEdit={canEdit}
        focusedPhotoId={focusedPhotoId}
        onStartTrailPick={() => onStartTrailPick(activeHike, activeLocation.lat, activeLocation.lng)}
        onUseCourse={(course) => onUseCourse(activeHike, course)}
        trailBusy={trailBusy}
        onFocusedPhotoConsumed={onFocusedPhotoConsumed}
        onPickWaypoint={() => onPickWaypoint(activeHike.id)}
        courseDraft={courseDraft}
        onCourseDraftChange={onCourseDraftChange}
      />
    );
  }

  if (activeLocation) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="border-b border-club-line px-4 py-3">
          <div className="flex items-center justify-between gap-2">
            <button
              onClick={onBackToRoot}
              className="rounded border border-club-line px-2 py-1.5 text-xs text-club-ink-soft hover:bg-club-paper md:py-1"
            >
              {/* On a phone this button only moves the list: the map it also
                  resets is behind the other tab. */}
              <span className="md:hidden">← 전체 목록</span>
              <span className="hidden md:inline">← 전체 지도</span>
            </button>
            <button
              type="button"
              onClick={onShowOnMap}
              className="rounded border border-club-line px-2 py-1.5 text-xs text-club-ink-soft hover:bg-club-paper md:hidden"
            >
              지도에서 보기
            </button>
          </div>
          <div className="mt-2 flex items-center gap-2">
            {renamingId === activeLocation.id ? (
              <>
                <input
                  autoFocus
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void saveName(activeLocation);
                    } else if (e.key === "Escape") {
                      setRenamingId(null);
                    }
                  }}
                  disabled={savingName}
                  aria-label="장소 이름"
                  className="min-w-0 flex-1 rounded border border-club-line px-2 py-1 text-base font-semibold disabled:opacity-50"
                />
                <button
                  type="button"
                  onClick={() => saveName(activeLocation)}
                  disabled={savingName}
                  className="shrink-0 rounded bg-club-ink px-2.5 py-1.5 text-xs text-white hover:bg-club-ink-soft disabled:opacity-50 md:px-2 md:py-1 md:text-xs"
                >
                  저장
                </button>
                <button
                  type="button"
                  onClick={() => setRenamingId(null)}
                  disabled={savingName}
                  className="shrink-0 rounded border border-club-line px-2.5 py-1.5 text-xs text-club-ink-soft hover:bg-club-paper disabled:opacity-50 md:px-2 md:py-1 md:text-xs"
                >
                  취소
                </button>
              </>
            ) : (
              <>
                <FolderDot location={activeLocation} />
                <h1 className="min-w-0 truncate text-lg font-semibold">{activeLocation.name}</h1>
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => {
                      setDraftName(activeLocation.name);
                      setRenamingId(activeLocation.id);
                    }}
                    className="ml-auto shrink-0 rounded border border-club-line px-2 py-1 text-xs text-club-ink-soft hover:bg-club-paper md:py-0.5 md:text-xs"
                  >
                    이름 수정
                  </button>
                )}
                {isAdmin && (
                  <button
                    type="button"
                    onClick={() => removeLocation(activeLocation)}
                    disabled={deleting}
                    className="shrink-0 rounded border border-red-300 px-2 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50 md:py-0.5 md:text-xs"
                  >
                    장소 삭제
                  </button>
                )}
              </>
            )}
          </div>
          <p className="mt-0.5 text-xs text-club-muted">
            {[
              activeLocation.region,
              activeLocation.elevation ? activeLocation.elevation + "m" : null,
            ]
              .filter(Boolean)
              .join(" · ") || "정보 없음"}
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3">
          <p className="mb-2 text-xs text-club-muted">
            활동 기록 {activeLocation.hikes.length}건
          </p>
          <div className="mb-3">
            {canEdit ? (
              <NewHikeForm
                locationId={activeLocation.id}
                locationType={activeLocation.type}
                locationName={activeLocation.name}
                locationRegion={activeLocation.region}
                locationLat={activeLocation.lat}
                locationLng={activeLocation.lng}
                onPickCourse={(course, draft) => onPickCourse(course, activeLocation, draft)}
              />
            ) : (
              <LoginPrompt>로그인하고 이 장소에 앨범 만들기</LoginPrompt>
            )}
          </div>
          {activeLocation.hikes.length === 0 ? (
            <p className="py-8 text-center text-sm text-club-muted">
              아직 등록된 활동이 없습니다.
            </p>
          ) : (
            // A heading only when there is more than one kind on file - see
            // groupHikesByActivity. A mountain that only ever hosts one kind,
            // or a screen already narrowed by the site-wide 활동 필터, would
            // otherwise show a single redundant "워킹 3개" label above the
            // only three things there are to see.
            (() => {
              const groups = groupHikesByActivity(activeLocation.hikes);
              const showHeadings = groups.length > 1;
              return (
                <div className="flex flex-col gap-4">
                  {groups.map((group) => (
                    <div key={group.type}>
                      {showHeadings && (
                        <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-club-muted">
                          <span
                            className="h-2 w-2 shrink-0 rounded-full"
                            style={{ backgroundColor: ACTIVITY_COLOR[group.type] }}
                            aria-hidden="true"
                          />
                          {ACTIVITY_LABEL[group.type]} {group.hikes.length}개
                        </p>
                      )}
                      <ul className="flex flex-col gap-2">
                        {group.hikes.map((hike) => (
                          <li key={hike.id}>
                            <button
                              onClick={() => onOpenHike(hike)}
                              className={
                                "flex w-full items-center gap-3 rounded-lg border p-2 text-left transition-colors " +
                                (pinnedHikeId === hike.id
                                  ? "border-red-400 bg-red-50"
                                  : "border-club-line hover:border-club-faint")
                              }
                            >
                              <TrackThumb track={hike.track} pinned={pinnedHikeId === hike.id} hike={hike} />
                              <span className="min-w-0 flex-1">
                                <span className="flex items-center gap-1.5">
                                  <span className="min-w-0 truncate text-sm font-semibold">{hike.title}</span>
                                  {/* Redundant with the section heading once
                                      there is one, but still the only marker
                                      when groups collapse to one - see
                                      showHeadings above. */}
                                  {!showHeadings && <ActivityTag type={hike.activityType} />}
                                </span>
                                <span className="mt-0.5 block text-xs text-club-muted">
                                  {hikeMeta(hike).join(" · ")}
                                </span>
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              );
            })()
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Above the tabs, not inside one: asking a question is not a way of
          browsing albums, and living under 최근 앨범 meant it vanished the
          moment someone switched to 장소별 앨범. */}
      {showAi && (canEdit ? (
        <KhuacAiCard onPreviewRoute={onPreviewRoute} onCreateAlbum={onCreateAlbum} albumsByCourse={albumsByCourse} onOpenAlbum={onOpenHike} activeRouteName={activeRouteName} creatingAlbum={creatingAlbum} />
      ) : (
        // askAssistant requires an approved member - opening the panel's
        // question box for a stranger or a pending member would only throw
        // "Not authenticated" the moment they pressed submit. Whether to let
        // anyone outside the club ask it at all is still an open question
        // (cost, abuse - see CLAUDE.md's 비용 section), not something to
        // decide by accident here.
        <div className="club-ai-card">
          <div className="club-ai-heading">
            <span aria-hidden="true" className="club-ai-symbol"><ClubCrest /></span>
            <div><strong>KHUAC AI</strong><p>날씨 · 루트 · 장비 · 코스</p></div>
          </div>
          <div className="px-3 pb-4">
            <LoginPrompt>로그인하고 KHUAC AI에게 물어보기</LoginPrompt>
          </div>
        </div>
      ))}
      {/* The album lists belong to the 앨범 screen. Beside the map they were a
          second copy of it, pushing the one thing this screen is for - asking
          about what is on the map - up against the top edge. */}
      {showAlbums && (
      <div className="flex items-center justify-between border-b border-club-line pr-3">
        <div className="recent-tabs border-b-0"><button aria-pressed={rootView === "recent"} onClick={()=>setRootView("recent")}>최근 앨범</button><button aria-pressed={rootView === "places"} onClick={()=>setRootView("places")}>장소별 앨범</button></div>
        {/* 새 앨범 만들기 only ever lived inside 장소별 앨범 - a member landing
            on 최근 앨범 (the default) had no visible way to it at all, and had
            to already know to switch tabs first. This is reachable from
            either tab, and does the switching itself rather than asking the
            member to find the right one. */}
        {canEdit && (
          <button
            type="button"
            onClick={() => setRootView("places")}
            className="shrink-0 rounded-full bg-club-ink px-3 py-1.5 text-xs font-medium text-white hover:bg-club-ink-soft"
          >
            + 새 앨범
          </button>
        )}
      </div>
      )}
      {showAlbums && (rootView === "recent" ? <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain"><RecentAlbums locations={locations} onOpenHike={onOpenHike}/></div> : <>
      <div className="border-b border-club-line px-4 py-3">
        {picking && (
          <div className="mb-2 rounded bg-red-50 px-2 py-1.5 text-xs text-red-700">
            <p>지도를 클릭하거나, 아래 검색으로 새 장소의 위치를 지정하세요.</p>
            <div className="mt-1.5 flex gap-1.5">
              <button
                type="button"
                onClick={onShowOnMap}
                className="rounded border border-red-300 px-2 py-1 text-xs font-medium md:hidden"
              >
                지도 열기
              </button>
              <button
                type="button"
                onClick={() => onPickingChange(false)}
                className="rounded border border-red-300 px-2 py-1 text-xs font-medium"
              >
                취소
              </button>
            </div>
          </div>
        )}
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="장소, 활동, 날짜, 올린 사람으로 검색"
          className="w-full rounded-lg border border-club-line px-3 py-2 text-base md:text-sm"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3">
        <div className="mb-3">
          {canEdit ? (
            <NewLocationForm
              picking={picking}
              pickedPoint={pickedPoint}
              onPickingChange={onPickingChange}
              onPickPoint={onPickPoint}
              onCreated={onOpenLocation}
              existingNames={allLocationNames}
            />
          ) : (
            <LoginPrompt>로그인하고 새 장소 추가하기</LoginPrompt>
          )}
        </div>

        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold">장소 앨범</h2>
          <span className="text-xs text-club-muted">{folders.length}곳</span>
        </div>
        {/* The "+" on each row (below) says the same thing this does, but a
            mark alone is a mark someone has to already have learned the
            meaning of - a member who has never seen it before has no reason
            to read "+" as "you can add here". Said once, in words, above the
            list rather than repeated on every row: read once, it explains
            every "+" below it at the same time. */}
        {canEdit && folders.length > 0 && (
          <p className="mb-2 text-xs text-club-faint">
            장소를 누르면 그 안에서 새 앨범을 추가할 수 있습니다.
          </p>
        )}

        {folders.length === 0 ? (
          courseMatchLocations.length > 0 ? (
            // 삼성산 has no album named 숨은암장 yet - locations/hikes had
            // nothing for "숨은암장" to match - but course_library already
            // holds five courses filed under it. Rather than a dead end, this
            // is the connection the member was looking for: the crag they
            // typed is a route inside a mountain that already has a folder.
            <div className="py-4">
              <p className="mb-2 text-center text-sm text-club-muted">
                &lsquo;{query}&rsquo; 장소는 없지만, 그 이름의 코스가 있는 산을 찾았습니다.
              </p>
              <ul className="flex flex-col gap-2">
                {courseMatchLocations.map(({ match, location }) => (
                  <li key={location.id}>
                    <button
                      onClick={() => onOpenLocation(location.id)}
                      className="w-full rounded-lg border border-amber-300 bg-amber-50 p-3 text-left hover:border-amber-400"
                    >
                      <span className="flex items-center gap-2">
                        <FolderDot location={location} />
                        <span className="min-w-0 truncate text-sm font-semibold">{location.name}</span>
                      </span>
                      <span className="mt-1 block text-xs text-amber-900">
                        코스: {match.courseName}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="py-8 text-center text-sm text-club-muted">
              {query ? "검색 결과가 없습니다." : "아직 등록된 장소가 없습니다."}
            </p>
          )
        ) : (
          <ul className="flex flex-col gap-2">
            {folders.map(({ location, latestHike }) => (
              <li key={location.id}>
                <button
                  onClick={() => onOpenLocation(location.id)}
                  className="w-full rounded-lg border border-club-line p-3 text-left transition-colors hover:border-club-faint"
                >
                  <span className="flex items-center gap-2">
                    <FolderDot location={location} />
                    <span className="min-w-0 truncate text-sm font-semibold">{location.name}</span>
                    {/* Without a hike yet, the row below already spells out
                        "눌러서 첫 활동을 등록하세요" - but 북한산·관악산 등
                        activity가 이미 있는 장소는 최근 앨범 미리보기만 보이고
                        여기서도 새 앨범을 더 만들 수 있다는 신호가 전혀 없었다.
                        A member had to already know 장소를 열면 새 앨범
                        버튼이 있다는 것을 알아야 눌러볼 수 있었던 것이 바로
                        그 피드백. 활동 유무와 무관하게 같은 자리에 같은
                        마크를 두면, 빈 장소든 채워진 장소든 "여기서 앨범을
                        추가할 수 있다"는 뜻이 늘 같은 곳에서 읽힌다. */}
                    {canEdit && (
                      <span
                        title="새 앨범 만들기"
                        className="ml-auto flex shrink-0 items-center gap-1 text-club-faint"
                      >
                        <span aria-hidden="true" className="text-sm font-semibold leading-none">
                          +
                        </span>
                        <span className="sr-only">새 앨범 만들기 가능</span>
                      </span>
                    )}
                  </span>
                  <span className="mt-1 block text-xs text-club-muted">
                    {[
                      location.region,
                      "활동 " + location.hikes.length + "건",
                      "사진 " + location.photoCount + "장",
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                  {latestHike ? (
                    <span className="mt-1 flex items-center gap-1.5">
                      <span className="min-w-0 truncate text-xs text-club-ink-soft">
                        최근 · {latestHike.title}
                      </span>
                      <ActivityTag type={latestHike.activityType} />
                      <span className="shrink-0 text-xs text-club-muted">
                        {new Date(latestHike.date).toLocaleDateString("ko-KR")}
                      </span>
                    </span>
                  ) : (
                    <span className="mt-1 block text-xs text-club-faint">
                      {canEdit ? "아직 활동이 없습니다 · 눌러서 첫 활동을 등록하세요" : "아직 활동이 없습니다"}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      </>)}
    </div>
  );
}
