"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { LocationType } from "@/types/database";
import { createLocation } from "./actions";
import type { PickedPoint } from "./map-shell";
import { TYPE_LABEL } from "./side-panel";
import { PlaceSearch, type PlaceResult } from "./place-search";

const TYPES: LocationType[] = ["mountain", "climbing_gym", "crag"];

export function NewLocationForm({
  pickedPoint,
  onPickingChange,
  onPickPoint,
  onCreated,
}: {
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
        className="w-full rounded-lg border border-dashed border-neutral-300 py-2 text-xs text-neutral-600 hover:border-neutral-500"
      >
        + 새 장소 등록
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="rounded-lg border border-neutral-300 p-3">
      <p className="text-xs font-semibold">새 장소 등록</p>
      <div className="mt-2">
        <label className="mb-1 block text-[11px] text-neutral-500">장소 검색</label>
        <PlaceSearch onSelect={handlePlace} />
      </div>

      <p className="mt-2 text-[11px] text-neutral-500">
        {pickedPoint
          ? `선택한 위치: ${pickedPoint.lat.toFixed(5)}, ${pickedPoint.lng.toFixed(5)} (지도를 클릭해 미세 조정 가능)`
          : "검색해서 고르거나, 지도를 직접 클릭해 지정하세요."}
      </p>

      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="장소 이름 (예: 관악산)"
        required
        className="mt-2 w-full rounded border border-neutral-300 px-2 py-1.5 text-sm"
      />

      <div className="mt-2 flex gap-2">
        <select
          value={type}
          onChange={(e) => setType(e.target.value as LocationType)}
          className="flex-1 rounded border border-neutral-300 px-2 py-1.5 text-sm"
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
          className="flex-1 rounded border border-neutral-300 px-2 py-1.5 text-sm"
        />
      </div>

      {type === "mountain" && (
        <input
          value={elevation}
          onChange={(e) => setElevation(e.target.value)}
          type="number"
          placeholder="고도(m, 선택)"
          className="mt-2 w-full rounded border border-neutral-300 px-2 py-1.5 text-sm"
        />
      )}

      {error && <p className="mt-2 text-[11px] text-red-600">{error}</p>}

      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          onClick={() => toggle(false)}
          className="rounded border border-neutral-300 px-3 py-1.5 text-xs"
        >
          취소
        </button>
        <button
          type="submit"
          disabled={saving}
          className="rounded bg-neutral-900 px-3 py-1.5 text-xs text-white disabled:opacity-50"
        >
          {saving ? "저장 중…" : "등록"}
        </button>
      </div>
    </form>
  );
}
