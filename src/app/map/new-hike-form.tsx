"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { ActivityType, ClimbingStyle, LocationType } from "@/types/database";
import { createHike } from "./actions";
import {
  ACTIVITY_HINT, ACTIVITY_LABEL, ACTIVITY_TYPES, CLIMBING_STYLES, CLIMBING_STYLE_LABEL,
  DEFAULT_ACTIVITY_FOR_LOCATION, activityForCourse, needsOwnSpot,
} from "./activity";
import { PlaceSearch, type PlaceResult } from "./place-search";
import { coursesForLocation, searchCoursesForLocation, type KnownCourse } from "./route-album-actions";
import { originLabel } from "./course-origin";

/** Today on the member's own clock. toISOString is UTC, which before 9am in
    Korea is still yesterday - the morning of a climb is exactly when an album
    tends to get started. */
function localToday(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * A folder's own 새 앨범 만들기.
 *
 * Laid out in the order a member actually knows things: what they did, when,
 * and then which way they went. It used to open on the course list and the
 * assistant box, with 활동 종류 at the very bottom under the title and date -
 * so a climb at 삼성산 was offered 삼성산's walks first, the assistant was
 * asked for "등산 코스", and only afterwards could the member say it had been
 * a climb at all.
 *
 * The two ways out are two separate endings and are laid out as such: pick a
 * course and the album is made from it over the map (with this form's
 * activity and date, see newAlbumFor in map-shell), or record it without one
 * using the fields at the bottom.
 */
export function NewHikeForm({
  locationId,
  locationType,
  locationName,
  locationRegion,
  locationLat,
  locationLng,
  onPickCourse,
}: {
  locationId: string;
  locationType: LocationType;
  locationName: string;
  locationRegion: string | null;
  /** The folder's own pin - the fallback spot when the member's crag is one
      Google has never heard of, as 숨은암장 is. */
  locationLat: number;
  locationLng: number;
  /** Draw a library course and let the member confirm it into a new album,
      carrying what they already chose here. */
  onPickCourse: (
    course: KnownCourse,
    draft: { activityType: ActivityType; climbingStyle: ClimbingStyle | null; date: string },
  ) => void;
}) {
  const defaultActivity = DEFAULT_ACTIVITY_FOR_LOCATION[locationType];
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(localToday);
  const [activityType, setActivityType] = useState<ActivityType>(defaultActivity);
  // A refinement on 암벽등반 only, and optional even then - see
  // CLIMBING_STYLE_LABEL in activity.ts for why this is a tag on the climb
  // rather than its own activity or its own place.
  const [climbingStyle, setClimbingStyle] = useState<ClimbingStyle | null>(null);
  const [description, setDescription] = useState("");
  const [spot, setSpot] = useState<PlaceResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Said beside the course step rather than at the foot of the form: on a
  // phone the foot is a screen away from the button that failed.
  const [courseError, setCourseError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // The courses this place already has. Read when the form opens rather than on
  // every render of the location screen - most visits never make an album.
  const [courses, setCourses] = useState<KnownCourse[] | null>(null);
  const [courseQuery, setCourseQuery] = useState("");
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    if (!open || courses !== null) return;
    let cancelled = false;
    coursesForLocation(locationName, locationRegion)
      .then((rows) => { if (!cancelled) setCourses(rows); })
      .catch(() => { if (!cancelled) setCourses([]); });
    return () => { cancelled = true; };
  }, [open, courses, locationName, locationRegion]);

  // A mountain holds its walks and its climbs together now, so the list is
  // ordered by what the member said they did: 숨은암장's approach ahead of
  // 삼성산's ridge walks for a climb, and the other way round for a walk.
  // Ordered, not filtered - a course's own name is only a guess at which it
  // is, and hiding the right one on a wrong guess would be worse than
  // listing it second.
  const term = courseQuery.trim().toLowerCase();
  const matching = (courses ?? [])
    .filter((course) =>
      !term
      || course.name.toLowerCase().includes(term)
      || course.waypoints.some((point) => point.toLowerCase().includes(term)))
    .map((course, index) => ({
      course,
      index,
      fits: activityForCourse(course.name, course.waypoints.join(" ")) === activityType,
    }))
    .sort((a, b) => Number(b.fits) - Number(a.fits) || a.index - b.index)
    .map(({ course }) => course);

  // The server enforces this too; catching it here saves a round trip and can
  // point at the field that is missing. Every location a member can navigate
  // to is now a whole mountain or a real venue (climbing_gym/crag) - see
  // needsOwnSpot in activity.ts for why a mountain still asks and a venue
  // does not.
  const spotRequired = needsOwnSpot(activityType, locationType);

  function reset() {
    setOpen(false);
    setTitle("");
    setDate(localToday());
    setActivityType(defaultActivity);
    setClimbingStyle(null);
    setDescription("");
    setSpot(null);
    setError(null);
    setCourseError(null);
    setCourseQuery("");
  }

  function pickCourse(course: KnownCourse) {
    setCourseError(null);
    if (!date) {
      setCourseError("날짜를 먼저 골라주세요.");
      return;
    }
    onPickCourse(course, { activityType, climbingStyle, date });
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (spotRequired && !spot) {
      setError("산행·등반은 봉우리나 코스 위치를 검색해 지정해주세요.");
      return;
    }
    setSaving(true);
    try {
      await createHike({
        locationId,
        title,
        date,
        activityType,
        climbingStyle: activityType === "climbing" ? climbingStyle : null,
        description: description || null,
        lat: spot?.lat ?? null,
        lng: spot?.lng ?? null,
      });
      reset();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "앨범을 만들지 못했습니다.");
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full rounded-lg border border-dashed border-club-line py-2.5 text-sm text-club-muted hover:border-club-muted md:py-2 md:text-xs"
      >
        + 새 앨범 만들기
      </button>
    );
  }

  const stepLabel = "mb-1 block text-xs font-semibold text-club-ink";

  return (
    <form onSubmit={submit} className="rounded-lg border border-club-line p-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-semibold">새 앨범 만들기</p>
        <button
          type="button"
          onClick={reset}
          className="shrink-0 text-xs text-club-muted underline underline-offset-2 hover:text-club-ink"
        >
          닫기
        </button>
      </div>
      <p className="mt-0.5 text-xs text-club-muted">{locationName}에서 한 활동을 기록합니다.</p>

      <div className="mt-3">
        <span className={stepLabel}>1. 무엇을 했나요?</span>
        <div className="grid grid-cols-2 gap-1.5">
          {ACTIVITY_TYPES.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => { setActivityType(t); if (t !== "climbing") setClimbingStyle(null); }}
              aria-pressed={activityType === t}
              className={
                "rounded border px-2 py-2 text-sm md:py-1.5 md:text-xs " +
                (activityType === t
                  ? "border-club-ink bg-club-ink text-white"
                  : "border-club-line text-club-ink-soft hover:border-club-muted")
              }
            >
              {ACTIVITY_LABEL[t]}
            </button>
          ))}
        </div>
        <p className="mt-1 text-xs text-club-faint">{ACTIVITY_HINT[activityType]}</p>

        {/* 암벽등반을 골랐을 때만 - 멀티피치·하드프리는 등반의 세부 태그일
            뿐, 자체 활동도 자체 장소도 아니다. 고르지 않아도 앨범은 그대로
            만들어진다. */}
        {activityType === "climbing" && (
          <div className="mt-2 flex gap-1.5">
            {CLIMBING_STYLES.map((style) => (
              <button
                key={style}
                type="button"
                onClick={() => setClimbingStyle((current) => (current === style ? null : style))}
                aria-pressed={climbingStyle === style}
                className={
                  "rounded border px-2.5 py-1 text-xs " +
                  (climbingStyle === style
                    ? "border-club-ink bg-club-ink text-white"
                    : "border-club-line text-club-ink-soft hover:border-club-muted")
                }
              >
                {CLIMBING_STYLE_LABEL[style]}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="mt-3">
        <label htmlFor="new-hike-date" className={stepLabel}>2. 언제?</label>
        <input
          id="new-hike-date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          type="date"
          required
          className="w-full rounded border border-club-line px-2 py-1.5 text-base md:text-sm"
        />
      </div>

      <div className="mt-3">
        <span className={stepLabel}>3. 어느 코스로 갔나요?</span>
        <p className="text-xs text-club-muted">
          코스를 누르면 지도에 선이 그려지고, 지도 위 &lsquo;앨범 만들기&rsquo;를 누르면 완성됩니다.
        </p>

        {courses === null && (
          <p className="mt-2 text-xs text-club-muted">이 장소의 코스를 불러오는 중…</p>
        )}

        {/* The courses this place already holds, before any search. Making an
            album used to start at a Google place box - a paid lookup that
            answers "what is near this name", not "which of our courses is
            this" - so the member got an unordered guess where the assistant
            shows a tidy list. These are the same rows the assistant offers,
            drawn the same way. */}
        {courses !== null && courses.length > 0 && (
          <div className="mt-2">
            {courses.length > 4 && (
              <input
                type="search"
                value={courseQuery}
                onChange={(e) => setCourseQuery(e.target.value)}
                placeholder="코스·경유지 이름으로 찾기"
                aria-label="코스 찾기"
                className="mb-1.5 w-full rounded border border-club-line px-2 py-1.5 text-base md:py-1 md:text-xs"
              />
            )}
            <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto overscroll-contain">
              {matching.map((course) => {
                const origin = originLabel(course.origin);
                return (
                  <li key={course.id}>
                    <button
                      type="button"
                      onClick={() => pickCourse(course)}
                      className="w-full rounded-sm border border-club-line bg-white px-2 py-2 text-left hover:border-club-muted md:py-1.5"
                    >
                      <span className="flex items-start justify-between gap-2">
                        <span className="min-w-0 break-keep text-[13px] font-medium text-club-ink md:text-xs">{course.name}</span>
                        <span
                          title={origin.hint}
                          className={
                            "shrink-0 rounded px-1.5 py-px text-[10px] leading-4 "
                            + (origin.unverified ? "bg-amber-100 text-amber-900" : "bg-club-sunken text-club-muted")
                          }
                        >
                          {origin.text}
                        </span>
                      </span>
                      {course.waypoints.length > 0 && (
                        <span className="mt-0.5 block break-keep text-[11px] leading-relaxed text-club-ink-soft">
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
                );
              })}
              {matching.length === 0 && (
                <li className="px-1 py-2 text-xs text-club-muted">그 이름의 코스가 없습니다.</li>
              )}
            </ul>
          </div>
        )}

        {/* Where KHUAC AI stands in a manual album: one step inside choosing
            the course, not a separate box competing with it. It used to show
            only when the place held nothing and vanish once any course
            existed, so a member whose route was not among them had no way
            back to it. It asks for what the member said they did - a climb
            gets "암벽등반 어프로치와 등반 루트", a walk gets "등산 코스" - and
            what it finds is filed for this place, so the next album here just
            picks it. */}
        {courses !== null && (
          <div className="mt-2 rounded border border-amber-300 bg-amber-50 p-2">
            <p className="text-xs text-amber-900">
              {courses.length === 0
                ? `${locationName}에 등록된 코스가 아직 없습니다. KHUAC AI가 웹에서 찾아 저장해둡니다.`
                : "찾는 코스가 목록에 없나요? KHUAC AI가 웹에서 더 찾아 목록에 더합니다."}
            </p>
            <button
              type="button"
              disabled={asking}
              onClick={async () => {
                setCourseError(null);
                setAsking(true);
                try {
                  const result = await searchCoursesForLocation(locationName, locationRegion, locationType, activityType);
                  if (!result.ok) { setCourseError(result.reason); return; }
                  setCourses(result.value);
                } catch {
                  setCourseError("코스를 찾지 못했습니다. 잠시 후 다시 시도해주세요.");
                } finally {
                  setAsking(false);
                }
              }}
              className="mt-1.5 w-full rounded-sm border border-amber-400 bg-white py-2 text-xs font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50"
            >
              {asking
                ? "찾는 중… 30초쯤 걸립니다"
                : `KHUAC AI로 ${ACTIVITY_LABEL[activityType]} 코스 찾기`}
            </button>
          </div>
        )}
        {courseError && <p role="alert" className="mt-1.5 text-xs text-red-600">{courseError}</p>}
      </div>

      {/* The other ending. Kept visibly apart from the course list so it
          reads as an alternative, not as more fields the course path also
          needs - a member who picked a course never comes back down here. */}
      <div className="mt-4 border-t border-club-line pt-3">
        <span className={stepLabel}>코스 없이 기록하기</span>
        <p className="text-xs text-club-muted">코스를 모르거나 목록에 없으면 여기서 바로 만드세요.</p>

        {spotRequired && (
          <div className="mt-2">
            <label className="mb-1 block text-xs text-club-muted">
              간 곳 (봉우리·암장·입구) <span className="text-red-600">필수</span>
            </label>
            <PlaceSearch
              onSelect={(place) => {
                setSpot(place);
                if (!title) setTitle(place.name);
              }}
            />
            {spot ? (
              <p className="mt-1 flex items-center gap-1.5 text-xs text-club-muted">
                <span className="min-w-0 truncate">{spot.name}</span>
                <button
                  type="button"
                  onClick={() => setSpot(null)}
                  className="shrink-0 text-club-faint underline hover:text-club-ink-soft"
                >
                  지우기
                </button>
              </p>
            ) : (
              <p className="mt-1 text-xs text-club-faint">
                지도에 붉은 핀으로 표시될 지점입니다. 검색에 안 나오면{" "}
                {/* Google has no 숨은암장 and no 인수봉 고독길 들머리. Without
                    this the only way past a required field it could not fill
                    was to give up - the folder's own pin is honest about being
                    "somewhere on this mountain", which is what the member
                    actually knows. */}
                <button
                  type="button"
                  onClick={() => setSpot({ name: locationName, address: null, lat: locationLat, lng: locationLng })}
                  className="text-club-ink-soft underline underline-offset-2 hover:text-club-ink"
                >
                  {locationName} 위치로 기록
                </button>
              </p>
            )}
          </div>
        )}

        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="앨범 이름 (예: 겨울 정기산행)"
          aria-label="앨범 이름"
          required
          className="mt-2 w-full rounded border border-club-line px-2 py-1.5 text-base md:text-sm"
        />
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="설명 (선택)"
          aria-label="설명"
          rows={2}
          className="mt-2 w-full rounded border border-club-line px-2 py-1.5 text-base md:text-sm"
        />
        <button
          type="submit"
          disabled={saving || (spotRequired && !spot)}
          className="mt-2 w-full rounded bg-club-ink py-2 text-sm text-white disabled:opacity-50 md:py-1.5 md:text-xs"
        >
          {saving ? "저장 중…" : "코스 없이 앨범 만들기"}
        </button>
      </div>

      {error && <p role="alert" className="mt-2 text-xs text-red-600">{error}</p>}
    </form>
  );
}
