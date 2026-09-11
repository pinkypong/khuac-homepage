"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ActivityType } from "@/types/database";
import { createHike } from "./actions";
import { ACTIVITY_HAS_OWN_SPOT, ACTIVITY_HINT, ACTIVITY_LABEL, ACTIVITY_TYPES } from "./activity";
import { PlaceSearch, type PlaceResult } from "./place-search";

export function NewHikeForm({ locationId }: { locationId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [activityType, setActivityType] = useState<ActivityType>("hiking");
  const [description, setDescription] = useState("");
  const [spot, setSpot] = useState<PlaceResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

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
      setActivityType("hiking");
      setDescription("");
      setSpot(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "활동 등록에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full rounded-lg border border-dashed border-neutral-300 py-2 text-xs text-neutral-600 hover:border-neutral-500"
      >
        + 새 활동 등록
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="rounded-lg border border-neutral-300 p-3">
      <p className="text-xs font-semibold">새 활동 등록</p>

      <div className="mt-2">
        <label className="mb-1 block text-[11px] text-neutral-500">
          봉우리·코스 검색{" "}
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
          <p className="mt-1 flex items-center gap-1.5 text-[11px] text-neutral-500">
            <span className="min-w-0 truncate">
              {spot.name} · {spot.lat.toFixed(5)}, {spot.lng.toFixed(5)}
            </span>
            <button
              type="button"
              onClick={() => setSpot(null)}
              className="shrink-0 text-neutral-400 underline hover:text-neutral-700"
            >
              지우기
            </button>
          </p>
        ) : (
          spotRequired && (
            <p className="mt-1 text-[11px] text-neutral-400">
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
        className="mt-2 w-full rounded border border-neutral-300 px-2 py-1.5 text-sm"
      />
      <input
        value={date}
        onChange={(e) => setDate(e.target.value)}
        type="date"
        required
        className="mt-2 w-full rounded border border-neutral-300 px-2 py-1.5 text-sm"
      />
      <div className="mt-2">
        <label className="mb-1 block text-[11px] text-neutral-500">활동 종류</label>
        <div className="flex flex-wrap gap-1.5">
          {ACTIVITY_TYPES.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setActivityType(t)}
              title={ACTIVITY_HINT[t]}
              className={
                "rounded border px-2 py-1 text-xs " +
                (activityType === t
                  ? "border-neutral-900 bg-neutral-900 text-white"
                  : "border-neutral-300 text-neutral-700 hover:border-neutral-500")
              }
            >
              {ACTIVITY_LABEL[t]}
            </button>
          ))}
        </div>
        <p className="mt-1 text-[11px] text-neutral-400">
          {ACTIVITY_HINT[activityType]}
        </p>
      </div>

      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="설명 (선택)"
        rows={2}
        className="mt-2 w-full rounded border border-neutral-300 px-2 py-1.5 text-sm"
      />
      {error && <p className="mt-2 text-[11px] text-red-600">{error}</p>}
      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded border border-neutral-300 px-3 py-1.5 text-xs"
        >
          취소
        </button>
        <button
          type="submit"
          disabled={saving || (spotRequired && !spot)}
          className="rounded bg-neutral-900 px-3 py-1.5 text-xs text-white disabled:opacity-50"
        >
          {saving ? "저장 중…" : "등록"}
        </button>
      </div>
    </form>
  );
}
