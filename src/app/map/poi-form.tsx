"use client";

import { useState } from "react";
import { saveClubPoi } from "./route-actions";
import { isValidGps } from "@/lib/gps/validate";

/**
 * Records where a local name actually is.
 *
 * Deliberately not a permanent fixture of the map. It appears only when a
 * course names somewhere nothing could place - which is the moment a member
 * both knows the answer and has a reason to give it - and closes as soon as
 * the point is saved.
 *
 * Two ways in, because the two situations are different. Tapping the map suits
 * somewhere the member can see; typing coordinates suits a photo, where the
 * GPS is already exact and pointing at it by hand would only lose precision.
 */
export function PoiForm({
  name,
  picked,
  onPickRequest,
  onDone,
  onCancel,
}: {
  name: string;
  /** Set once the member has tapped the map. */
  picked: { lat: number; lng: number } | null;
  onPickRequest: () => void;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [manual, setManual] = useState(false);
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const typed = manual ? { lat: Number(lat), lng: Number(lng) } : null;
  const point = manual ? typed : picked;
  const ready = !!point && isValidGps(point.lat, point.lng);

  async function save() {
    if (!point || !ready) return;
    setSaving(true);
    setError(null);
    try {
      const result = await saveClubPoi({ name, lat: point.lat, lng: point.lng });
      // A refusal arrives as a value; only a genuine fault throws, and in a
      // production build its message is replaced before it gets here.
      if (!result.ok) {
        setError(result.reason);
        setSaving(false);
        return;
      }
      onDone();
    } catch {
      setError("저장하지 못했습니다. 잠시 후 다시 시도해주세요.");
      setSaving(false);
    }
  }

  return (
    <div className="pointer-events-auto m-2 w-[min(22rem,calc(100vw-2rem))] rounded-lg border border-club-line bg-white/95 p-3 shadow-lg backdrop-blur">
      <p className="text-xs font-semibold text-club-ink">{name} 위치 지정</p>

      {!manual ? (
        <p className="mt-1 text-xs text-club-muted">
          {picked
            ? `선택한 위치: ${picked.lat.toFixed(5)}, ${picked.lng.toFixed(5)}`
            : "지도를 눌러 위치를 지정하세요."}
        </p>
      ) : (
        <div className="mt-2 flex gap-1.5">
          <input
            inputMode="decimal"
            value={lat}
            onChange={(e) => setLat(e.target.value)}
            placeholder="위도 37.6640"
            aria-label="위도"
            className="min-w-0 flex-1 rounded border border-club-line px-2 py-1 text-base md:text-xs"
          />
          <input
            inputMode="decimal"
            value={lng}
            onChange={(e) => setLng(e.target.value)}
            placeholder="경도 126.9672"
            aria-label="경도"
            className="min-w-0 flex-1 rounded border border-club-line px-2 py-1 text-base md:text-xs"
          />
        </div>
      )}

      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}

      <div className="mt-2 flex items-center gap-1.5">
        {!manual && !picked && (
          <button
            type="button"
            onClick={onPickRequest}
            className="rounded bg-club-ink px-2.5 py-1.5 text-xs font-medium text-white"
          >
            지도에서 찍기
          </button>
        )}
        <button
          type="button"
          onClick={() => setManual(!manual)}
          className="rounded border border-club-line px-2.5 py-1.5 text-xs text-club-ink-soft"
        >
          {manual ? "지도에서 찍기" : "좌표 입력"}
        </button>
        <button
          type="button"
          onClick={save}
          disabled={!ready || saving}
          className="ml-auto rounded bg-[#5b1a23] px-2.5 py-1.5 text-xs font-medium text-white disabled:opacity-40"
        >
          {saving ? "저장 중…" : "저장"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded border border-club-line px-2 py-1.5 text-xs text-club-muted"
        >
          닫기
        </button>
      </div>
    </div>
  );
}
