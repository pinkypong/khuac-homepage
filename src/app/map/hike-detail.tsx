"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { getThumbnailUrl } from "@/lib/images/url";
import {
  downsampleTrack,
  formatDistance,
  parseGpxPoints,
  trackDistanceMeters,
} from "@/lib/gps/track";
import { PhotoLightbox, type LightboxPhoto } from "@/components/photo-lightbox";
import { CommentThread } from "@/components/comment-thread";
import type { MapHike, MapLocation } from "./map-shell";
import { saveHikeTrack, updateActivity, updateCourseDetails } from "./actions";
import { rebuildCourseTrack } from "./route-actions";
import { deleteActivity } from "./admin-actions";
import { deletePhoto } from "./photo-actions";
import { ACTIVITY_COLOR, ACTIVITY_HINT, ACTIVITY_LABEL, ACTIVITY_TYPES } from "./activity";
import type { ActivityType } from "@/types/database";
import { isValidGps } from "@/lib/gps/validate";
import { HikePhotoUpload } from "./hike-photo-upload";
import { coursesForLocation, searchCoursesForLocation, type KnownCourse } from "./route-album-actions";
import { originLabel } from "./course-origin";
import { draftFromHike, type CourseDraft } from "./course-draft";
import { staleDeploymentMessage } from "@/app/stale-deployment";

export function HikeDetail({
  location,
  hike,
  onBackToRoot,
  onBackToLocation,
  onShowOnMap,
  isAdmin,
  focusedPhotoId,
  onFocusedPhotoConsumed,
  onStartTrailPick,
  onUseCourse,
  trailBusy,
  onPickWaypoint,
  courseDraft,
  onCourseDraftChange,
}: {
  location: MapLocation;
  hike: MapHike;
  onBackToRoot: () => void;
  onBackToLocation: () => void;
  onShowOnMap: () => void;
  isAdmin: boolean;
  focusedPhotoId: string | null;
  onFocusedPhotoConsumed: () => void;
  onStartTrailPick: () => void;
  /** Draw a course we already hold, for the member to confirm onto this album. */
  onUseCourse: (course: KnownCourse) => void;
  trailBusy: boolean;
  /** Turn the map into a picker so a new waypoint can be placed. */
  onPickWaypoint: () => void;
  /** The course being edited. Held by map-shell - see course-draft.ts. */
  courseDraft: CourseDraft | null;
  onCourseDraftChange: (draft: CourseDraft | null) => void;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [gpxError, setGpxError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // Keyed by hike id so moving to another activity can't carry a stale draft.
  const [renaming, setRenaming] = useState<{
    hikeId: string; title: string; date: string; activityType: ActivityType;
    baseUpdatedAt: string;
  } | null>(null);
  const [savingName, setSavingName] = useState(false);
  // The course box edits itself, in place. It used to share the header's form,
  // which holds none of the fields it shows and opens at the top of the panel -
  // so pressing 수정 down here scrolled nothing into view and looked dead.
  //
  // The draft is a prop rather than state here: reaching the map to place a
  // waypoint can unmount this component, which twice took the edit with it.
  const editingCourse = courseDraft?.hikeId === hike.id ? courseDraft : null;
  const setEditingCourse = onCourseDraftChange;
  const [savingCourse, setSavingCourse] = useState(false);
  const [redrawing, setRedrawing] = useState(false);
  // The courses already on file for this place. Read once the route section is
  // opened rather than on every album view: most visits never open it, and a
  // list nobody asked for is a query nobody needed.
  const [known, setKnown] = useState<KnownCourse[] | null>(null);
  const [knownFailed, setKnownFailed] = useState(false);
  const [searching, setSearching] = useState(false);

  // Tapping a photo pin on the map asks for that picture, so open it here and
  // hand the request back - leaving it set would reopen the lightbox the moment
  // it was closed.
  useEffect(() => {
    if (!focusedPhotoId) return;
    const index = hike.photos.findIndex((p) => p.id === focusedPhotoId);
    if (index >= 0) setOpenIndex(index);
    onFocusedPhotoConsumed();
  }, [focusedPhotoId, hike.photos, onFocusedPhotoConsumed]);

  const photos: LightboxPhoto[] = hike.photos.map((p) => ({
    id: p.id,
    storageKey: p.storageKey,
    takenAt: p.takenAt,
    uploaderName: p.uploaderName,
  }));

  async function onGpxSelected(file: File | undefined) {
    if (!file) return;
    setGpxError(null);
    setUploading(true);
    try {
      // Parsed here rather than on the server: Workers have no XML parser, and
      // this keeps a multi-MB GPX file out of the server action payload.
      const points = downsampleTrack(parseGpxPoints(await file.text()));
      if (points.length < 2) throw new Error("GPX에서 좌표를 찾지 못했습니다.");
      await saveHikeTrack(hike.id, points);
      router.refresh();
    } catch (err) {
      setGpxError(staleDeploymentMessage(err) ?? (err instanceof Error ? err.message : "GPX 업로드에 실패했습니다."));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function openEditor() {
    setEditingCourse(null); // never two forms at once
    setRenaming({
      hikeId: hike.id,
      title: hike.title,
      date: hike.date,
      activityType: hike.activityType,
      baseUpdatedAt: hike.updatedAt,
    });
  }

  // The points as the album stores them, which is also what the map draws.
  const waypointNames = (hike.routeWaypoints ?? [])
    .map((point) => point.name)
    .filter((name): name is string => Boolean(name && name.trim()));

  function openCourseEditor() {
    setRenaming(null); // never two forms at once
    setEditingCourse(draftFromHike(hike));
  }

  async function redrawTrack() {
    // Warned, not assumed. There is no column saying where a track came from,
    // so this cannot tell a member's recorded GPX from a line drawn here
    // before - and quietly replacing the former would lose the only copy.
    if (hike.track && hike.track.length >= 2
      && !window.confirm("지금 그려진 경로를 지우고 경유지를 따라 다시 그립니다. GPX로 올린 경로였다면 사라집니다. 계속할까요?")) return;
    setRedrawing(true);
    try {
      const result = await rebuildCourseTrack(hike.id);
      if (!result.ok) { window.alert(result.reason); return; }
      const { drawnLegs, totalLegs } = result.value;
      if (drawnLegs < totalLegs) {
        window.alert(`구간 ${totalLegs}개 중 ${drawnLegs}개만 등산로를 찾았습니다. 찾은 구간만 그렸습니다.`);
      }
      router.refresh();
    } catch (err) {
      window.alert(staleDeploymentMessage(err) ?? (err instanceof Error ? err.message : "경로를 다시 그리지 못했습니다."));
    } finally {
      setRedrawing(false);
    }
  }

  async function submitCourse() {
    if (!editingCourse) return;
    // Refused rather than quietly dropped. A nameless point is almost always
    // one just tapped onto the map and not yet labelled, and deleting it on
    // save would throw away the tap that placed it.
    const blank = editingCourse.waypoints.findIndex((point) => !point.removed && !point.name.trim());
    if (blank >= 0) {
      window.alert(`${blank + 1}번 경유지의 이름을 적어주세요. 지우려면 × 를 누르세요.`);
      return;
    }
    setSavingCourse(true);
    try {
      const result = await updateCourseDetails({
        hikeId: hike.id,
        baseUpdatedAt: editingCourse.baseUpdatedAt,
        description: editingCourse.description,
        waypoints: editingCourse.waypoints
          .filter((point) => !point.removed)
          .map(({ name, lat, lng }) => ({ name, lat, lng })),
        distanceText: editingCourse.distanceText,
        durationText: editingCourse.durationText,
        difficulty: editingCourse.difficulty,
        notes: editingCourse.notes,
      });
      if (!result.ok) {
        window.alert(result.reason);
        return;
      }
      // Saved either way; this only says the line could not follow the points.
      if (result.value.trackWarning) {
        window.alert(`저장했습니다.\n\n지도의 선은 다시 그리지 못했습니다: ${result.value.trackWarning}`);
      }
      setEditingCourse(null);
      router.refresh();
    } catch (err) {
      window.alert(staleDeploymentMessage(err) ?? (err instanceof Error ? err.message : "코스 정보 수정에 실패했습니다."));
    } finally {
      setSavingCourse(false);
    }
  }

  async function submitRename() {
    if (!renaming) return;
    setSavingName(true);
    try {
      const result = await updateActivity({
        hikeId: hike.id,
        title: renaming.title,
        date: renaming.date,
        activityType: renaming.activityType,
        baseUpdatedAt: renaming.baseUpdatedAt,
        // Left out on purpose: the memo is the course box's field now, and
        // passing it here would let this form overwrite an edit made there.
      });
      if (!result.ok) {
        window.alert(result.reason);
        return;
      }
      setRenaming(null);
      router.refresh();
    } catch (err) {
      // The input stays open with what was typed so it can be retried.
      window.alert(staleDeploymentMessage(err) ?? (err instanceof Error ? err.message : "활동 정보 수정에 실패했습니다."));
    } finally {
      setSavingName(false);
    }
  }

  async function removeActivity() {
    if (!window.confirm(`'${hike.title}' 활동과 그 사진이 모두 삭제됩니다. 계속할까요?`)) return;
    setDeleting(true);
    try {
      await deleteActivity(hike.id);
      // This detail view now points at nothing, so step back to the folder.
      onBackToLocation();
      router.refresh();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "활동 삭제에 실패했습니다.");
    } finally {
      setDeleting(false);
    }
  }

  async function removePhoto(photoId: string) {
    if (!window.confirm("이 사진을 삭제할까요?")) return;
    setDeleting(true);
    try {
      await deletePhoto(photoId);
      router.refresh();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "사진 삭제에 실패했습니다.");
    } finally {
      setDeleting(false);
    }
  }

  const distance =
    hike.track && hike.track.length >= 2 ? formatDistance(trackDistanceMeters(hike.track)) : null;

  // Offering "see it on the map" for an activity with nothing mapped sends
  // people to a map that has not moved, which reads as a broken button.
  const mappedPhotos = hike.photos.filter((p) => isValidGps(p.exifLat, p.exifLng)).length;
  const hasSomethingToShow = mappedPhotos > 0 || (hike.track?.length ?? 0) >= 2;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-club-line px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <button
            onClick={onBackToLocation}
            className="min-w-0 truncate rounded border border-club-line px-2 py-1.5 text-xs text-club-ink-soft hover:bg-club-paper md:py-1"
          >
            ← {location.name}
          </button>
          {/* Below md the map is on the other tab, so this is the only way to
              it. Filled rather than outlined, and named after what appears
              there: a bordered button reading "지도에서 보기" sat among four
              other bordered buttons and went unnoticed in testing. */}
          {hasSomethingToShow && (
          <button
            type="button"
            onClick={onShowOnMap}
            className="shrink-0 rounded bg-club-ink px-2.5 py-1.5 text-xs font-medium text-white md:hidden"
          >
            {mappedPhotos > 0 ? `지도에서 사진 위치 ${mappedPhotos}곳 보기` : "지도에서 경로 보기"}
          </button>
          )}
          <button
            onClick={onBackToRoot}
            className="hidden shrink-0 text-xs text-club-muted hover:underline md:block"
          >
            전체 지도
          </button>
        </div>
        {renaming?.hikeId === hike.id ? (
          <div className="mt-2 flex flex-col gap-1.5">
            <input
              value={renaming.title}
              onChange={(e) => setRenaming({ ...renaming, title: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitRename();
                if (e.key === "Escape") setRenaming(null);
              }}
              autoFocus
              aria-label="활동 이름"
              className="min-w-0 rounded border border-club-line px-2 py-1 text-base md:text-sm"
            />
            {/* 메모 is not here any more. It lives in the course box below,
                under that box's own 수정 button. The two buttons used to open
                this same form, which is what "기능이 같음" meant: this one is
                the album's identity - what it is called, when it was, what kind
                of outing - and the course box holds what the day was like. */}
            {/* What kind of outing it was. Editable because it is guessed: an
                album made from a course is filed by reading the words in it,
                and a guess from words is wrong sometimes. */}
            <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="활동 종류">
              {ACTIVITY_TYPES.map((type) => (
                <button
                  key={type}
                  type="button"
                  role="radio"
                  aria-checked={renaming.activityType === type}
                  title={ACTIVITY_HINT[type]}
                  onClick={() => setRenaming({ ...renaming, activityType: type })}
                  className={
                    "rounded border px-2 py-1 text-xs transition-colors "
                    + (renaming.activityType === type
                      ? "border-transparent font-medium text-white"
                      : "border-club-line text-club-muted hover:bg-club-paper")
                  }
                  style={renaming.activityType === type
                    ? { backgroundColor: ACTIVITY_COLOR[type] }
                    : undefined}
                >
                  {ACTIVITY_LABEL[type]}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1.5">
              <input
                type="date"
                value={renaming.date}
                onChange={(e) => setRenaming({ ...renaming, date: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submitRename();
                  if (e.key === "Escape") setRenaming(null);
                }}
                aria-label="활동 날짜"
                className="min-w-0 flex-1 rounded border border-club-line px-2 py-1 text-base md:text-sm"
              />
              <button
                type="button"
                onClick={submitRename}
                disabled={savingName}
                className="shrink-0 rounded bg-club-ink px-2.5 py-1.5 text-xs text-white disabled:opacity-50 md:px-2 md:py-1 md:text-xs"
              >
                저장
              </button>
              <button
                type="button"
                onClick={() => setRenaming(null)}
                className="shrink-0 rounded border border-club-line px-2.5 py-1.5 text-xs text-club-muted md:px-2 md:py-1 md:text-xs"
              >
                취소
              </button>
            </div>
          </div>
        ) : (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {/* Wraps rather than squeezing: the buttons never shrink, so a long
              title was left with whatever pixels they did not want - about
              fifty of them beside 수정 and 활동 삭제. The floor below pushes
              them onto their own line instead when the panel is narrow. */}
          <h1 className="min-w-[10rem] flex-1 truncate text-lg font-semibold">{hike.title}</h1>
          <span
            className="shrink-0 rounded px-1.5 py-px text-xs font-medium text-white"
            style={{ backgroundColor: ACTIVITY_COLOR[hike.activityType] }}
          >
            {ACTIVITY_LABEL[hike.activityType]}
          </span>
          <button
            type="button"
            onClick={() => openEditor()}
            className="shrink-0 rounded border border-club-line px-2 py-1 text-xs text-club-muted hover:bg-club-paper md:py-0.5 md:text-xs"
          >
            수정
          </button>
          {isAdmin && (
            <button
              type="button"
              onClick={removeActivity}
              disabled={deleting}
              className="ml-auto shrink-0 rounded border border-red-300 px-2 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50 md:py-0.5 md:text-xs"
            >
              활동 삭제
            </button>
          )}
        </div>
        )}
        <p className="mt-0.5 text-xs text-club-muted">
          {new Date(hike.date).toLocaleDateString("ko-KR")}
          {distance ? " · " + distance : ""}
          {" · 사진 " + hike.photos.length + "장"}
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {/* The course, above the photos, because opening an album to plan a
            walk asks "what was this route" before it asks what it looked like.
            In the scrolling part rather than the header it shares with the
            title: notes worth writing are longer than a line, and a header
            that grows with them pushes the photos off the screen.

            Laid out as the separate things it is. It was one string - the
            waypoints as a sentence, the distance as prose, the caveats run in
            after them - and a reader looking for "do I need a reservation" had
            to read all of it to find out. */}
        {editingCourse?.hikeId === hike.id ? (
          <section
            aria-label="코스 정보 수정"
            className="mb-4 rounded-sm border border-club-muted bg-club-paper px-3 py-2.5"
          >
            <h2 className="mb-2 text-xs font-semibold tracking-wide text-club-muted">코스 수정</h2>

            <div className="mb-3">
              <p className="mb-1 text-xs text-club-faint">
                경유지 — 지우려면 × 를 누르세요.
              </p>
              {editingCourse.waypoints.length > 0 && (
                <ul className="flex flex-col gap-1">
                  {editingCourse.waypoints.map((point, i) => (
                    <li key={i} className="flex items-center gap-1.5">
                      <span className="w-4 shrink-0 text-right text-xs text-club-faint">{i + 1}</span>
                      <input
                        value={point.name}
                        onChange={(e) => {
                          const next = [...editingCourse.waypoints];
                          next[i] = { ...point, name: e.target.value };
                          setEditingCourse({ ...editingCourse, waypoints: next });
                        }}
                        placeholder={point.name ? "" : "이 지점의 이름"}
                        autoFocus={!point.name && !point.removed && i === editingCourse.waypoints.length - 1}
                        disabled={point.removed}
                        aria-label={`경유지 ${i + 1}`}
                        className={
                          "min-w-0 flex-1 rounded border px-2 py-1 text-sm md:text-xs "
                          + (point.removed
                            ? "border-club-line bg-club-sunken text-club-faint line-through"
                            : point.name.trim() ? "border-club-line bg-white" : "border-amber-400 bg-white")
                        }
                      />
                      <span
                        title={`${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`}
                        className="shrink-0 text-[10px] tabular-nums text-club-faint"
                      >
                        {point.lat.toFixed(4)}
                      </span>
                      {/* Removing is its own button. It used to be "clear the
                          name", which collided with adding: a point tapped on
                          the map arrives without a name, so the new row was
                          born already marked for deletion and vanished on save
                          if the member did not type fast enough. */}
                      <button
                        type="button"
                        onClick={() => setEditingCourse({
                          ...editingCourse,
                          waypoints: editingCourse.waypoints.map((p, at) =>
                            at === i ? { ...p, removed: !p.removed } : p),
                        })}
                        aria-label={point.removed ? `경유지 ${i + 1} 삭제 취소` : `경유지 ${i + 1} 삭제`}
                        title={point.removed ? "삭제 취소" : "저장할 때 지웁니다"}
                        className={
                          "shrink-0 rounded border px-1.5 py-0.5 text-xs leading-none "
                          + (point.removed
                            ? "border-club-faint text-club-ink hover:bg-white"
                            : "border-club-line text-club-faint hover:border-red-300 hover:text-red-600")
                        }
                      >
                        {point.removed ? "되돌리기" : "×"}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {/* A point needs a position, and typing one is not something to
                  ask of anybody - so a new one is placed by tapping the map,
                  the same way a new place is. It lands at the end of the list
                  with an empty name waiting to be filled in. */}
              <button
                type="button"
                onClick={onPickWaypoint}
                className="mt-1.5 w-full rounded-sm border border-dashed border-club-line py-1.5 text-xs text-club-muted hover:border-club-muted hover:text-club-ink-soft"
              >
                + 지도에서 경유지 추가
              </button>
              {/* Separate from 저장 on purpose. Saving writes the names and the
                  numbers; the line on the map is its own column, and redrawing
                  it can replace a GPX somebody recorded - so it is asked for
                  rather than assumed. */}
              {editingCourse.waypoints.filter((p) => !p.removed).length >= 2 && (
                <button
                  type="button"
                  onClick={redrawTrack}
                  disabled={redrawing}
                  className="mt-1.5 w-full rounded-sm border border-club-faint py-1.5 text-xs font-medium text-club-ink hover:bg-white disabled:opacity-50"
                >
                  {redrawing ? "등산로 따라 그리는 중…" : "경유지를 따라 지도에 경로 그리기"}
                </button>
              )}
              <p className="mt-1 text-xs text-club-faint">
                경유지를 저장해도 지도의 선은 그대로입니다. 선을 다시 그리려면 위 버튼을 누르세요.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              {([
                ["거리", "distanceText", "약 6.6km"],
                ["소요", "durationText", "4시간"],
                ["난이도", "difficulty", "중급"],
              ] as const).map(([label, field, placeholder]) => (
                <label key={field} className="flex min-w-[6rem] flex-1 flex-col gap-0.5">
                  <span className="text-xs text-club-faint">{label}</span>
                  <input
                    value={editingCourse[field]}
                    onChange={(e) => setEditingCourse({ ...editingCourse, [field]: e.target.value })}
                    placeholder={placeholder}
                    className="min-w-0 rounded border border-club-line bg-white px-2 py-1 text-sm md:text-xs"
                  />
                </label>
              ))}
            </div>

            <label className="mt-2 flex flex-col gap-0.5">
              <span className="text-xs text-club-faint">주의할 점 (비법정탐방로 · 예약 · 낙석 등)</span>
              <textarea
                value={editingCourse.notes}
                onChange={(e) => setEditingCourse({ ...editingCourse, notes: e.target.value })}
                rows={3}
                className="w-full resize-y rounded border border-club-line bg-white px-2 py-1 text-sm leading-relaxed md:text-xs"
              />
            </label>

            <label className="mt-2 flex flex-col gap-0.5">
              <span className="text-xs text-club-faint">메모 — 부원이 남기는 말</span>
              <textarea
                value={editingCourse.description}
                onChange={(e) => setEditingCourse({ ...editingCourse, description: e.target.value })}
                rows={4}
                placeholder={"물 뜨는 곳, 실제 걸린 시간, 다음에 갈 사람이 알면 좋을 것"}
                className="w-full resize-y rounded border border-club-line bg-white px-2 py-1 text-sm leading-relaxed md:text-xs"
              />
            </label>

            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditingCourse(null)}
                className="rounded border border-club-line bg-white px-3 py-1.5 text-xs text-club-muted"
              >
                취소
              </button>
              <button
                type="button"
                onClick={submitCourse}
                disabled={savingCourse}
                className="rounded bg-club-ink px-3 py-1.5 text-xs text-white disabled:opacity-50"
              >
                {savingCourse ? "저장 중…" : "저장"}
              </button>
            </div>
          </section>
        ) : (hike.courseInfo || waypointNames.length > 0 || hike.description) ? (
          <section
            aria-label="코스 정보"
            className="mb-4 rounded-sm border border-club-line bg-club-paper px-3 py-2.5"
          >
            {/* The heading and the button both name the memo. "코스" over a
                plain 수정 read as "edit the course", so the memo underneath
                looked like something only the album's author could have put
                there - and nobody pressed the button to write one. */}
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <h2 className="text-xs font-semibold tracking-wide text-club-muted">코스 · 메모</h2>
              <button
                type="button"
                onClick={openCourseEditor}
                className="shrink-0 rounded border border-club-muted bg-white px-2 py-1 text-xs font-medium text-club-ink hover:bg-club-paper"
              >
                ✎ 코스 · 메모 수정
              </button>
            </div>

            {/* The points, from the column that holds them with coordinates -
                the same ones the map draws and the profile labels. */}
            {waypointNames.length > 0 && (
              <p className="text-sm leading-relaxed text-club-ink">
                {waypointNames.map((name, i) => (
                  <span key={`${name}-${i}`}>
                    {i > 0 && <span aria-hidden="true" className="px-1 text-club-faint">›</span>}
                    {name}
                  </span>
                ))}
              </p>
            )}

            {/* Time and difficulty are what the answer knew and the geometry
                cannot say. Distance only when there is no line: a drawn one is
                measured, the profile under the map shows it, and two numbers
                claiming to be the same thing is worse than one. */}
            {(hike.courseInfo?.durationText || hike.courseInfo?.difficulty
              || (!hike.track && hike.courseInfo?.distanceText)) && (
              <dl className="mt-1.5 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-xs text-club-muted">
                {!hike.track && hike.courseInfo?.distanceText && (
                  <div className="flex items-baseline gap-1">
                    <dt className="text-club-faint">거리</dt>
                    <dd className="text-club-ink-soft">{hike.courseInfo.distanceText}</dd>
                  </div>
                )}
                {hike.courseInfo?.durationText && (
                  <div className="flex items-baseline gap-1">
                    <dt className="text-club-faint">소요</dt>
                    <dd className="text-club-ink-soft">{hike.courseInfo.durationText}</dd>
                  </div>
                )}
                {hike.courseInfo?.difficulty && (
                  <div className="flex items-baseline gap-1">
                    <dt className="text-club-faint">난이도</dt>
                    <dd className="text-club-ink-soft">{hike.courseInfo.difficulty}</dd>
                  </div>
                )}
              </dl>
            )}

            {/* The caveats, given a box of their own. 비법정탐방로 or 예약 필요
                is the one line that changes whether somebody can go at all, and
                it was set in the smallest type on the card behind a hairline -
                quieter than the distance, which nobody is stopped by. */}
            {hike.courseInfo?.notes && (
              <div className="mt-2.5 rounded-sm border border-amber-300 bg-amber-50 px-2.5 py-2">
                <h3 className="mb-0.5 flex items-center gap-1 text-xs font-semibold tracking-wide text-amber-800">
                  <span aria-hidden="true">⚠</span> 주의할 점
                </h3>
                <p className="whitespace-pre-line text-sm leading-relaxed text-amber-950">
                  {hike.courseInfo.notes}
                </p>
              </div>
            )}

            {/* What a member wrote, last, under their own heading - so an
                answer's words and a member's are never mistaken for each other. */}
            {hike.description && (
              <div className="mt-2.5 rounded-sm border border-club-line bg-white px-2.5 py-2">
                <h3 className="mb-0.5 flex items-center gap-1 text-xs font-semibold tracking-wide text-club-muted">
                  <span aria-hidden="true">✎</span> 메모
                </h3>
                <p className="whitespace-pre-line text-sm leading-relaxed text-club-ink">
                  {hike.description}
                </p>
              </div>
            )}

            {/* Shown where the memo would be, rather than as a link below the
                card. An empty space says nothing; this says what the space is
                for and that the button above fills it. */}
            {!hike.description && (
              <div className="mt-2.5">
                <h3 className="mb-0.5 flex items-center gap-1 text-xs font-semibold tracking-wide text-club-muted">
                  <span aria-hidden="true">✎</span> 메모
                </h3>
                <button
                  type="button"
                  onClick={openCourseEditor}
                  className="w-full rounded-sm border border-dashed border-club-line bg-white px-2.5 py-2 text-left text-sm leading-relaxed text-club-faint hover:border-club-muted hover:text-club-muted"
                >
                  위 <span className="font-medium">✎ 코스 · 메모 수정</span> 을 눌러 메모를 남겨주세요.
                  <br />
                  <span className="text-xs">물 뜨는 곳, 실제 걸린 시간, 다음에 갈 사람이 알면 좋을 것</span>
                </button>
              </div>
            )}
          </section>
        ) : (
          <button
            type="button"
            onClick={openCourseEditor}
            className="mb-4 w-full rounded-sm border border-dashed border-club-line py-2 text-xs text-club-muted hover:border-club-muted hover:text-club-ink-soft"
          >
            + 코스 정보 적기 (거리 · 소요 · 난이도 · 주의할 점 · 메모)
          </button>
        )}

        <button
          type="button"
          onClick={() => setUploadOpen(true)}
          className="mb-4 w-full rounded-sm border border-dashed border-club-line py-2.5 text-sm text-club-muted hover:border-club-muted md:py-2 md:text-xs"
        >
          + 이 활동에 사진 올리기
        </button>

        {photos.length === 0 ? (
          <p className="py-8 text-center text-sm text-club-muted">아직 올라온 사진이 없습니다.</p>
        ) : (
          <ul className="club-photo-grid grid grid-cols-2 gap-2 sm:grid-cols-3">
            {photos.map((photo, index) => (
              <li key={photo.id} className="relative">
                <button
                  type="button"
                  onClick={() => setOpenIndex(index)}
                  className="relative block w-full overflow-hidden border border-club-line bg-club-sunken"
                  style={{ aspectRatio: "4 / 5" }}
                >
                  {/* Plain <img>: /api/images already resizes. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={getThumbnailUrl(photo.storageKey)}
                    alt={photo.uploaderName + "님이 올린 사진"}
                    loading="lazy"
                    className="h-full w-full object-cover"
                  />
                  <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-1.5 py-1 text-left text-xs text-white">
                    {photo.uploaderName}
                  </span>
                </button>
                {/* Any approved member may remove a photo, not just admins. */}
                <button
                  type="button"
                  onClick={() => removePhoto(photo.id)}
                  disabled={deleting}
                  aria-label="사진 삭제"
                  className="absolute right-1 top-1 rounded bg-black/60 px-2 py-1 text-xs leading-none text-white hover:bg-red-600 disabled:opacity-50 md:px-1.5 md:py-0.5 md:text-xs"
                >
                  삭제
                </button>
              </li>
            ))}
          </ul>
        )}

        {/* Below the photos, and folded.
            Two dashed boxes and a file input stood between the album's title
            and its first photograph, and neither is what anybody opens an
            album for - hardly any outing has a GPX, and the route is drawn
            already for a course made from an answer. The summary says which
            of the two states this activity is in, so folding it away costs no
            information. */}
        {location.type !== "climbing_gym" && (
          <details
            className="mt-5 border-t border-club-line pt-4"
            onToggle={(e) => {
              if (!(e.currentTarget as HTMLDetailsElement).open || known !== null) return;
              coursesForLocation(location.name, location.region)
                .then(setKnown)
                .catch(() => setKnownFailed(true));
            }}
          >
            <summary className="cursor-pointer list-none text-xs text-club-muted hover:text-club-ink">
              경로 직접 등록
              <span className="ml-1.5 text-xs text-club-faint">
                {hike.trackSource === "gpx" ? "· GPX 등록됨" : hike.track ? "· 경로 있음" : "· 경로 없음"}
              </span>
            </summary>
            <div className="mt-3">
            <p className="text-xs font-medium">
              {hike.trackSource === "gpx" ? "GPX 경로 등록됨" : "GPX 경로 없음"}
            </p>
            <p className="mt-0.5 text-xs text-club-muted">
              {hike.trackSource === "gpx"
                ? "다시 올리면 기존 경로를 덮어씁니다."
                : "램블러·산스마일 등에서 내보낸 GPX를 올리면 지도에 실제 경로가 그려집니다."}
            </p>
            <input
              ref={fileRef}
              type="file"
              accept=".gpx,application/gpx+xml,application/xml,text/xml"
              onChange={(e) => onGpxSelected(e.target.files?.[0])}
              disabled={uploading}
              className="mt-2 w-full text-xs"
            />
            {uploading && <p className="mt-1 text-xs text-club-muted">업로드 중…</p>}
            {gpxError && <p className="mt-1 text-xs text-red-600">{gpxError}</p>}

            {/* Before asking anybody to trace anything: the courses we already
                hold for this place. 북한산 has thirteen, four of them approaches
                to 인수봉's routes that differ only in where they start, so the
                usual answer to "draw the approach" is already sitting in a list
                four long. Picking one draws it on the map to be confirmed; it
                is not saved until the member says so. */}
            {known !== null && known.length > 0 && (
              <div className="mt-3 border-t border-club-line pt-3">
                <p className="text-xs font-medium">이 장소의 알려진 코스 {known.length}개</p>
                <p className="mt-0.5 text-xs text-club-muted">
                  고르면 지도에 그려서 보여드립니다. 확인 후 저장합니다.
                </p>
                <ul className="mt-2 flex flex-col gap-1.5">
                  {known.map((course) => (
                    <li key={course.id}>
                      <button
                        type="button"
                        onClick={() => onUseCourse(course)}
                        className="w-full rounded-sm border border-club-line px-2.5 py-2 text-left hover:border-club-muted"
                      >
                        <span className="flex items-start justify-between gap-2">
                          <span className="min-w-0 text-xs font-medium text-club-ink">{course.name}</span>
                          {/* Where it came from. Without this a 산림청 survey and
                              a web answer read the same, which is how 비둘기샘
                              went unquestioned. */}
                          {(() => {
                            const origin = originLabel(course.origin);
                            return (
                              <span
                                title={origin.hint}
                                className={
                                  "shrink-0 rounded px-1.5 py-px text-[10px] leading-4 " +
                                  (origin.unverified
                                    ? "bg-amber-100 text-amber-900"
                                    : "bg-club-sunken text-club-muted")
                                }
                              >
                                {origin.text}
                              </span>
                            );
                          })()}
                        </span>
                        {course.waypoints.length > 0 && (
                          <span className="mt-0.5 block text-[11px] leading-relaxed text-club-ink-soft">
                            {course.waypoints.join(" → ")}
                          </span>
                        )}
                        {(course.distanceText || course.durationText) && (
                          <span className="mt-0.5 block text-[11px] text-club-muted">
                            {[course.distanceText, course.durationText].filter(Boolean).join(" · ")}
                          </span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {known !== null && known.length === 0 && (
              <div className="mt-3 border-t border-club-line pt-3">
                <p className="text-xs text-club-muted">
                  이 장소로 등록된 코스가 아직 없습니다. KHUAC AI에 물어보면 찾아서 저장해둡니다 —
                  한 번만 물어보면 이후 이 장소의 모든 앨범에서 바로 고를 수 있습니다.
                </p>
                <button
                  type="button"
                  disabled={searching}
                  onClick={async () => {
                    setSearching(true);
                    const result = await searchCoursesForLocation(
                      location.name, location.region, location.type,
                    );
                    setSearching(false);
                    if (!result.ok) { window.alert(result.reason); return; }
                    setKnown(result.value);
                  }}
                  className="mt-2 w-full rounded-sm border border-club-faint py-2 text-xs font-medium text-club-ink hover:bg-club-paper disabled:opacity-50"
                >
                  {searching ? "찾는 중… (30초쯤 걸립니다)" : "KHUAC AI에게 이 장소 코스 물어보기"}
                </button>
              </div>
            )}
            {knownFailed && (
              <p className="mt-3 border-t border-club-line pt-3 text-xs text-club-muted">
                이 장소의 코스 목록을 불러오지 못했습니다.
              </p>
            )}

            {/* Hardly any outing has a GPX - nobody remembers to record one -
                so the usual case needs a way to draw the route that is not a
                file nobody has. These are real OpenStreetMap paths, picked by
                the person who walked them. */}
            <div className="mt-3 border-t border-club-line pt-3">
              <p className="text-xs text-club-muted">
                GPX 파일이 없다면, 지도에서 걸었던 등산로를 직접 골라 경로를 만들 수 있습니다.
              </p>
              <button
                type="button"
                onClick={onStartTrailPick}
                disabled={trailBusy}
                className="mt-2 w-full rounded-sm border border-club-faint py-2 text-xs font-medium text-club-ink hover:bg-club-paper disabled:opacity-50"
              >
                {trailBusy ? "등산로 불러오는 중…" : "지도에서 등산로 고르기"}
              </button>
            </div>
            </div>
          </details>
        )}

        {/* Keyed by hike so switching activities inside the panel remounts the
            thread instead of showing the previous one's comments. */}
        <div className="mt-5 border-t border-club-line pt-4">
          <CommentThread key={hike.id} subjectKind="hike" subjectId={hike.id} />
        </div>
      </div>

      {uploadOpen && (
        <HikePhotoUpload hikeId={hike.id} onClose={() => setUploadOpen(false)} />
      )}

      <PhotoLightbox photos={photos} openIndex={openIndex} onChangeIndex={setOpenIndex} />
    </div>
  );
}
