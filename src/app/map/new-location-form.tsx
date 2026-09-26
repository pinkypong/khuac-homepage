"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { LocationType } from "@/types/database";
import { createLocation } from "./actions";
import type { PickedPoint } from "./map-shell";
import { TYPE_LABEL } from "./side-panel";
import { PlaceSearch, type PlaceResult } from "./place-search";
import { similarLocationName } from "./location-names";
import { parseExif } from "@/lib/gps/exif";

/**
 * multi_pitch and hard_free are deliberately absent here.
 *
 * They used to mean "this location is itself a specific crag or peak, not the
 * whole mountain" - which is why 인수봉 and 삼성산 숨은암장 were each given
 * their own location row. That was the wrong layer for it: course_library
 * already groups by the mountain a route is on (인수봉's approaches are all
 * filed under mountain=북한산, named as waypoints), so a second, independent
 * location row for the same feature just gave a member two names to choose
 * between for one place, with no way to tell which the club's own courses
 * would actually match.
 *
 * A location created from here is now always the whole named area - one row
 * per mountain, the same grouping course_library already uses - and which
 * specific peak or wall a hike happened at is the job of its own spot (see
 * needsOwnSpot in activity.ts) and the course attached to it, not a second
 * location. climbing_gym and crag stay: a gym or an artificial wall is a real
 * separate building, not a feature of a mountain that already has its own
 * location.
 *
 * The enum still carries multi_pitch/hard_free - Postgres does not drop enum
 * values cheaply - but nothing here offers them, and no row uses them after
 * migrating 인수봉's hikes onto 북한산 and remaking 삼성산 숨은암장 as 삼성산.
 */
const TYPES: LocationType[] = ["mountain", "climbing_gym", "crag"];

export function NewLocationForm({
  picking,
  pickedPoint,
  onPickingChange,
  onPickPoint,
  onCreated,
  existingNames,
}: {
  /** The shared map-picking flag, also used by the missing-waypoint flow.
      Watched rather than owned: cancelling from the floating map banner or
      from this form's own button both have to close this form the same way,
      and there is only one flag to cancel through. */
  picking: boolean;
  pickedPoint: PickedPoint | null;
  onPickingChange: (picking: boolean) => void;
  onPickPoint: (point: PickedPoint) => void;
  onCreated: (locationId: string) => void;
  /** Every location's name, so a new one can be checked against them before
      it is saved - see location-names.ts for the collision this catches. */
  existingNames: string[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<LocationType>("mountain");
  const [region, setRegion] = useState("");
  const [elevation, setElevation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Ticked once the member has looked at the collision below and still means
  // a different place. Reset whenever the name changes so it cannot survive
  // past the warning it was ticked for.
  const [confirmedDifferent, setConfirmedDifferent] = useState(false);
  const photoRef = useRef<HTMLInputElement>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);

  const similar = similarLocationName(name, existingNames);

  function handlePlace(place: PlaceResult) {
    onPickPoint({ lat: place.lat, lng: place.lng });
    if (!name) setName(place.name);
    if (!region && place.address) setRegion(place.address);
    setError(null);
  }

  /**
   * A point from a photo's own GPS, for exactly the place Places has no
   * listing for - 숨은암장, 인수봉 고독길 들머리, none of it. Tapping the
   * map was the only fallback for those, and asking a member to find one
   * unmarked point among a wall of green on a phone screen, at the zoom
   * level where the map still shows the whole ridge, is not a realistic ask.
   * A photo taken standing there already carries a far better fix than any
   * tap would land - the phone's own GPS chip, recorded at the moment of
   * pressing the shutter.
   *
   * Feeds the same onPickPoint map-tap already does, not a parallel path -
   * this is a second way to answer "where", not a second kind of answer.
   */
  async function onPhotoSelected(file: File | undefined) {
    if (!file) return;
    setPhotoError(null);
    setPhotoBusy(true);
    try {
      const exif = await parseExif(file);
      if (exif.lat == null || exif.lng == null) {
        setPhotoError("이 사진에는 위치 정보가 없습니다. 다른 사진을 선택하거나 검색·지도로 지정해주세요.");
        return;
      }
      onPickPoint({ lat: exif.lat, lng: exif.lng });
      setError(null);
    } catch {
      setPhotoError("사진에서 위치를 읽지 못했습니다.");
    } finally {
      setPhotoBusy(false);
      if (photoRef.current) photoRef.current.value = "";
    }
  }

  function toggle(next: boolean) {
    setOpen(next);
    onPickingChange(next);
    if (!next) {
      setName("");
      setRegion("");
      setElevation("");
      setError(null);
      setConfirmedDifferent(false);
      setPhotoError(null);
    }
  }

  // Cancelling has two other doors besides this form's own button: the
  // floating banner over the map, reachable while the map fills the screen
  // on a phone, and the picking banner above the album list. Both cancel by
  // turning `picking` off rather than calling back into this form, because
  // neither knows this form is what is open - the flag is the one thing every
  // picker, this one and the missing-waypoint one, agrees to watch. This form
  // closing itself in response is what makes either door actually work.
  useEffect(() => {
    if (!picking && open) toggle(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picking]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (!pickedPoint) {
      setError("지도를 클릭해서 위치를 지정해주세요.");
      return;
    }
    // The warning is a checkbox to tick, not just text to have read - a
    // member skimming past a paragraph is exactly how 삼성산 would have been
    // saved bare instead of as 삼성산 숨은암장.
    if (similar && !confirmedDifferent) {
      setError(`이미 있는 ‘${similar}’과(와) 다른 곳이면 위 체크박스를 눌러주세요.`);
      return;
    }
    setSaving(true);
    try {
      const { locationId } = await createLocation({
        name,
        type,
        region: region || null,
        elevation: elevation ? Number(elevation) : null,
        lat: pickedPoint.lat,
        lng: pickedPoint.lng,
      });
      toggle(false);
      router.refresh();
      onCreated(locationId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "장소 등록에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => toggle(true)}
        className="w-full rounded-lg border border-dashed border-club-line py-2.5 text-sm text-club-muted hover:border-club-muted md:py-2 md:text-xs"
      >
        + 목록에 없는 산·실내암장 추가
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="rounded-lg border border-club-line p-3">
      <p className="text-xs font-semibold">새 장소 추가</p>
      {/* Said before anything else, because the commonest wrong turn is
          making a second folder for a crag on a mountain that already has
          one - see location-names.ts. */}
      <p className="mt-0.5 break-keep text-xs text-club-muted">
        목록에 이미 있는 산이면 여기가 아니라 그 산을 눌러 앨범을 만드세요.
        산 안의 암장·봉우리(예: 삼성산 숨은암장)도 산 이름 하나로 둡니다.
      </p>
      <div className="mt-2">
        <label className="mb-1 block text-xs text-club-muted">장소 검색</label>
        <PlaceSearch onSelect={handlePlace} />
      </div>

      {/* Google이 모르는 곳(숨은암장 등)을 위한 두 번째 방법. 지도를 손끝으로
          찍어 봉우리 하나를 맞히는 것보다, 그 자리에서 찍은 사진 하나의 GPS가
          훨씬 정확하고 훨씬 쉽다. */}
      <div className="mt-2">
        <input
          ref={photoRef}
          type="file"
          accept="image/*"
          id="new-location-photo"
          onChange={(e) => onPhotoSelected(e.target.files?.[0])}
          className="hidden"
        />
        <label
          htmlFor="new-location-photo"
          className="flex w-full cursor-pointer items-center justify-center gap-1.5 rounded border border-dashed border-club-line py-2 text-xs text-club-muted hover:border-club-muted"
        >
          {photoBusy ? "위치 읽는 중…" : "📷 그 자리에서 찍은 사진으로 위치 지정"}
        </label>
        {photoError && <p className="mt-1 text-xs text-red-600">{photoError}</p>}
      </div>

      <p className="mt-2 text-xs text-club-muted">
        {pickedPoint
          ? `선택한 위치: ${pickedPoint.lat.toFixed(5)}, ${pickedPoint.lng.toFixed(5)} (지도를 클릭해 미세 조정 가능)`
          : "검색이나 사진으로 안 되면, 지도를 직접 클릭해 지정하세요."}
      </p>

      <input
        value={name}
        onChange={(e) => { setName(e.target.value); setConfirmedDifferent(false); }}
        placeholder="장소 이름 (예: 관악산)"
        required
        className="mt-2 w-full rounded border border-club-line px-2 py-1.5 text-base md:text-sm"
      />

      {/* Never a hard block - 관악산 and a same-named mountain 300km away are
          both real, and only a person can tell which this is. What it must
          not be is skippable without being seen: a name this close to an
          existing one, saved as a bare mountain name, is exactly how 삼성산
          would have been filed instead of 삼성산 숨은암장, which
          coursesForLocation cannot tell apart from an unrelated 삼성산
          already in course_library once only one of them exists to check
          against. */}
      {similar && (
        <div className="mt-2 rounded border border-amber-300 bg-amber-50 px-2.5 py-2">
          <p className="break-keep text-xs text-amber-900">
            이미 <span className="font-medium">&lsquo;{similar}&rsquo;</span> 장소가 있습니다.
            그 산의 암장·봉우리라면 새 장소를 만들지 말고, 목록에서 &lsquo;{similar}&rsquo;을(를) 눌러
            앨범을 만드세요. 암장·봉우리는 앨범에서 코스로 지정합니다.
          </p>
          <label className="mt-1.5 flex items-start gap-1.5 text-xs text-amber-900">
            <input
              type="checkbox"
              checked={confirmedDifferent}
              onChange={(e) => setConfirmedDifferent(e.target.checked)}
              className="mt-0.5"
            />
            이름만 비슷한 다른 곳입니다
          </label>
        </div>
      )}

      <div className="mt-2 flex gap-2">
        <select
          value={type}
          onChange={(e) => setType(e.target.value as LocationType)}
          className="flex-1 rounded border border-club-line px-2 py-1.5 text-base md:text-sm"
        >
          {TYPES.map((t) => (
            <option key={t} value={t}>
              {TYPE_LABEL[t]}
            </option>
          ))}
        </select>
        <input
          value={region}
          onChange={(e) => setRegion(e.target.value)}
          placeholder="지역"
          className="flex-1 rounded border border-club-line px-2 py-1.5 text-base md:text-sm"
        />
      </div>

      {type === "mountain" && (
        <input
          value={elevation}
          onChange={(e) => setElevation(e.target.value)}
          type="number"
          placeholder="고도(m, 선택)"
          className="mt-2 w-full rounded border border-club-line px-2 py-1.5 text-base md:text-sm"
        />
      )}

      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}

      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          onClick={() => toggle(false)}
          className="rounded border border-club-line px-4 py-2 text-sm md:px-3 md:py-1.5 md:text-xs"
        >
          취소
        </button>
        <button
          type="submit"
          disabled={saving}
          className="rounded bg-club-ink px-4 py-2 text-sm text-white disabled:opacity-50 md:px-3 md:py-1.5 md:text-xs"
        >
          {saving ? "저장 중…" : "등록"}
        </button>
      </div>
    </form>
  );
}
