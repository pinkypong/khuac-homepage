"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { ActivityType, LocationType } from "@/types/database";
import { createHike } from "./actions";
import { ACTIVITY_HAS_OWN_SPOT, ACTIVITY_HINT, ACTIVITY_LABEL, ACTIVITY_TYPES, DEFAULT_ACTIVITY_FOR_LOCATION } from "./activity";
import { PlaceSearch, type PlaceResult } from "./place-search";
import { coursesForLocation, searchCoursesForLocation, type KnownCourse } from "./route-album-actions";
import { originLabel } from "./course-origin";

export function NewHikeForm({
  locationId,
  locationType,
  locationName,
  locationRegion,
  onPickCourse,
}: {
  locationId: string;
  locationType: LocationType;
  locationName: string;
  locationRegion: string | null;
  /** Draw a library course and let the member confirm it into a new album. */
  onPickCourse: (course: KnownCourse) => void;
}) {
  // What this folder mostly holds. 멀티피치/하드프리 have no reading but
  // climbing, and the form used to always open on 워킹 - every climb had to
  // be reselected by hand regardless of which kind of place it was filed
  // under.
  const defaultActivity = DEFAULT_ACTIVITY_FOR_LOCATION[locationType];
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [activityType, setActivityType] = useState<ActivityType>(defaultActivity);
  const [description, setDescription] = useState("");
  const [spot, setSpot] = useState<PlaceResult | null>(null);
  const [error, setError] = useState<string | null>(null);
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

  const term = courseQuery.trim().toLowerCase();
  const matching = (courses ?? []).filter((course) =>
    !term
    || course.name.toLowerCase().includes(term)
    || course.waypoints.some((point) => point.toLowerCase().includes(term)));

  // The server enforces this too; catching it here saves a round trip and can
  // point at the field that is missing.
  const spotRequired = ACTIVITY_HAS_OWN_SPOT[activityType];

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
        description: description || null,
        lat: spot?.lat ?? null,
        lng: spot?.lng ?? null,
      });
      setOpen(false);
      setTitle("");
      setDate("");
      setActivityType(defaultActivity);
      setDescription("");
      setSpot(null);
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

  return (
    <form onSubmit={submit} className="rounded-lg border border-club-line p-3">
      <p className="text-xs font-semibold">새 앨범 만들기</p>

      {/* Nothing on file, so ask rather than leave the member at a dead end.
          삼성산 숨은암장 is why: Google has no place by that name and the
          library holds one course for the whole mountain, so making an album
          for it simply could not be done - while the assistant, two screens
          away, can find it and does. The search is the same one the album's
          course section runs, and it saves what it finds, so this place is
          answered from the library from then on. */}
      {courses !== null && courses.length === 0 && (
        <div className="mt-2 rounded border border-club-line bg-club-paper p-2">
          <p className="text-xs text-club-muted">
            이 장소로 등록된 코스가 아직 없습니다. KHUAC AI가 찾아서 저장해둡니다 —
            한 번만 물어보면 이후 이 장소의 모든 앨범에서 바로 고를 수 있습니다.
          </p>
          <button
            type="button"
            disabled={asking}
            onClick={async () => {
              setAsking(true);
              const result = await searchCoursesForLocation(locationName, locationRegion, locationType);
              setAsking(false);
              if (!result.ok) { setError(result.reason); return; }
              setCourses(result.value);
            }}
            className="mt-2 w-full rounded-sm border border-club-faint py-2 text-xs font-medium text-club-ink hover:bg-white disabled:opacity-50"
          >
            {asking ? "찾는 중… (30초쯤 걸립니다)" : "KHUAC AI에게 이 장소 코스 물어보기"}
          </button>
        </div>
      )}

      {/* The courses this place already holds, before any search. Making an
          album used to start at a Google place box - a paid lookup that answers
          "what is near this name", not "which of our courses is this" - so the
          member got an unordered guess where the assistant shows a tidy list.
          These are the same rows the assistant offers, drawn the same way. */}
      {courses !== null && courses.length > 0 && (
        <div className="mt-2 rounded border border-club-line bg-club-paper p-2">
          <p className="text-xs font-medium">이 장소의 코스 {courses.length}개</p>
          <p className="mt-0.5 text-xs text-club-muted">
            고르면 지도에 그려집니다. 확인하고 앨범을 만드세요.
          </p>
          {courses.length > 4 && (
            <input
              type="search"
              value={courseQuery}
              onChange={(e) => setCourseQuery(e.target.value)}
              placeholder="코스·경유지로 찾기"
              className="mt-1.5 w-full rounded border border-club-line px-2 py-1 text-base md:text-xs"
            />
          )}
          <ul className="mt-1.5 flex max-h-56 flex-col gap-1 overflow-y-auto">
            {matching.map((course) => {
              const origin = originLabel(course.origin);
              return (
                <li key={course.id}>
                  <button
                    type="button"
                    onClick={() => onPickCourse(course)}
                    className="w-full rounded-sm border border-club-line bg-white px-2 py-1.5 text-left hover:border-club-muted"
                  >
                    <span className="flex items-start justify-between gap-2">
                      <span className="min-w-0 text-xs font-medium text-club-ink">{course.name}</span>
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
              );
            })}
            {matching.length === 0 && (
              <li className="px-1 py-2 text-xs text-club-muted">찾는 코스가 없습니다.</li>
            )}
          </ul>
        </div>
      )}

      <div className="mt-2">
        <label className="mb-1 block text-xs text-club-muted">
          {courses !== null && courses.length > 0 ? "코스 없이 지점만 지정" : "봉우리·코스 검색"}{" "}
          {spotRequired ? (
            <span className="text-red-600">(필수)</span>
          ) : (
            <span>(선택)</span>
          )}
        </label>
        <PlaceSearch
          onSelect={(place) => {
            setSpot(place);
            if (!title) setTitle(place.name);
          }}
        />
        {spot ? (
          <p className="mt-1 flex items-center gap-1.5 text-xs text-club-muted">
            <span className="min-w-0 truncate">
              {spot.name} · {spot.lat.toFixed(5)}, {spot.lng.toFixed(5)}
            </span>
            <button
              type="button"
              onClick={() => setSpot(null)}
              className="shrink-0 text-club-faint underline hover:text-club-ink-soft"
            >
              지우기
            </button>
          </p>
        ) : (
          spotRequired && (
            <p className="mt-1 text-xs text-club-faint">
              지도에 붉은 핀으로 표시될 지점입니다.
            </p>
          )
        )}
      </div>

      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="활동 이름 (예: 겨울 정기산행)"
        required
        className="mt-2 w-full rounded border border-club-line px-2 py-1.5 text-base md:text-sm"
      />
      <input
        value={date}
        onChange={(e) => setDate(e.target.value)}
        type="date"
        required
        className="mt-2 w-full rounded border border-club-line px-2 py-1.5 text-base md:text-sm"
      />
      <div className="mt-2">
        <label className="mb-1 block text-xs text-club-muted">활동 종류</label>
        <div className="flex flex-wrap gap-1.5">
          {ACTIVITY_TYPES.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setActivityType(t)}
              title={ACTIVITY_HINT[t]}
              className={
                "rounded border px-3 py-1.5 text-sm md:px-2 md:py-1 md:text-xs " +
                (activityType === t
                  ? "border-club-ink bg-club-ink text-white"
                  : "border-club-line text-club-ink-soft hover:border-club-muted")
              }
            >
              {ACTIVITY_LABEL[t]}
            </button>
          ))}
        </div>
        <p className="mt-1 text-xs text-club-faint">
          {ACTIVITY_HINT[activityType]}
        </p>
      </div>

      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="설명 (선택)"
        rows={2}
        className="mt-2 w-full rounded border border-club-line px-2 py-1.5 text-base md:text-sm"
      />
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded border border-club-line px-4 py-2 text-sm md:px-3 md:py-1.5 md:text-xs"
        >
          취소
        </button>
        <button
          type="submit"
          disabled={saving || (spotRequired && !spot)}
          className="rounded bg-club-ink px-4 py-2 text-sm text-white disabled:opacity-50 md:px-3 md:py-1.5 md:text-xs"
        >
          {saving ? "저장 중…" : "등록"}
        </button>
      </div>
    </form>
  );
}
