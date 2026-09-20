"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { LocationType } from "@/types/database";
import { createLocation } from "./actions";
import type { PickedPoint } from "./map-shell";
import { TYPE_LABEL } from "./side-panel";
import { PlaceSearch, type PlaceResult } from "./place-search";

const TYPES: LocationType[] = ["mountain", "climbing_gym", "crag", "multi_pitch", "hard_free"];

export function NewLocationForm({
  picking,
  pickedPoint,
  onPickingChange,
  onPickPoint,
  onCreated,
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
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<LocationType>("mountain");
  const [region, setRegion] = useState("");
  const [elevation, setElevation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function handlePlace(place: PlaceResult) {
    onPickPoint({ lat: place.lat, lng: place.lng });
    if (!name) setName(place.name);
    if (!region && place.address) setRegion(place.address);
    setError(null);
  }

  function toggle(next: boolean) {
    setOpen(next);
    onPickingChange(next);
    if (!next) {
      setName("");
      setRegion("");
      setElevation("");
      setError(null);
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
        + 새 장소 추가 (산·암장)
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="rounded-lg border border-club-line p-3">
      <p className="text-xs font-semibold">새 장소 추가</p>
      <p className="mt-0.5 text-xs text-club-muted">
        앨범을 담을 곳입니다. 이미 있는 산이면 목록에서 그 산을 눌러 들어가세요.
      </p>
      <div className="mt-2">
        <label className="mb-1 block text-xs text-club-muted">장소 검색</label>
        <PlaceSearch onSelect={handlePlace} />
      </div>

      <p className="mt-2 text-xs text-club-muted">
        {pickedPoint
          ? `선택한 위치: ${pickedPoint.lat.toFixed(5)}, ${pickedPoint.lng.toFixed(5)} (지도를 클릭해 미세 조정 가능)`
          : "검색해서 고르거나, 지도를 직접 클릭해 지정하세요."}
      </p>

      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="장소 이름 (예: 관악산)"
        required
        className="mt-2 w-full rounded border border-club-line px-2 py-1.5 text-base md:text-sm"
      />

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
