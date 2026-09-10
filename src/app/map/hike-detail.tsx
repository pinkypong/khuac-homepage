"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { getThumbnailUrl } from "@/lib/images/url";
import {
  downsampleTrack,
  formatDistance,
  parseGpxPoints,
  trackDistanceMeters,
} from "@/lib/gps/track";
import { PhotoLightbox, type LightboxPhoto } from "@/components/photo-lightbox";
import type { MapHike, MapLocation } from "./map-shell";
import { renameActivity, saveHikeTrack } from "./actions";
import { deleteActivity } from "./admin-actions";
import { deletePhoto } from "./photo-actions";
import { ACTIVITY_LABEL } from "./activity";
import { HikePhotoUpload } from "./hike-photo-upload";

export function HikeDetail({
  location,
  hike,
  onBackToRoot,
  onBackToLocation,
  isAdmin,
}: {
  location: MapLocation;
  hike: MapHike;
  onBackToRoot: () => void;
  onBackToLocation: () => void;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [gpxError, setGpxError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // Keyed by hike id so moving to another activity can't carry a stale draft.
  const [renaming, setRenaming] = useState<{ hikeId: string; title: string } | null>(null);
  const [savingName, setSavingName] = useState(false);

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
      setGpxError(err instanceof Error ? err.message : "GPX 업로드에 실패했습니다.");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function submitRename() {
    if (!renaming) return;
    setSavingName(true);
    try {
      await renameActivity(hike.id, renaming.title);
      setRenaming(null);
      router.refresh();
    } catch (err) {
      // The input stays open with what was typed so it can be retried.
      window.alert(err instanceof Error ? err.message : "활동 이름 수정에 실패했습니다.");
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

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-neutral-200 px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <button
            onClick={onBackToLocation}
            className="rounded border border-neutral-300 px-2 py-1 text-xs text-neutral-700 hover:bg-neutral-50"
          >
            ← {location.name}
          </button>
          <button onClick={onBackToRoot} className="text-xs text-neutral-500 hover:underline">
            전체 지도
          </button>
        </div>
        {renaming?.hikeId === hike.id ? (
          <div className="mt-2 flex items-center gap-1.5">
            <input
              value={renaming.title}
              onChange={(e) => setRenaming({ hikeId: hike.id, title: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitRename();
                if (e.key === "Escape") setRenaming(null);
              }}
              autoFocus
              className="min-w-0 flex-1 rounded border border-neutral-300 px-2 py-1 text-sm"
            />
            <button
              type="button"
              onClick={submitRename}
              disabled={savingName}
              className="shrink-0 rounded bg-neutral-900 px-2 py-1 text-[11px] text-white disabled:opacity-50"
            >
              저장
            </button>
            <button
              type="button"
              onClick={() => setRenaming(null)}
              className="shrink-0 rounded border border-neutral-300 px-2 py-1 text-[11px] text-neutral-600"
            >
              취소
            </button>
          </div>
        ) : (
        <div className="mt-2 flex items-center gap-2">
          <h1 className="min-w-0 truncate text-lg font-semibold">{hike.title}</h1>
          <span className="shrink-0 rounded border border-neutral-300 px-1 py-px text-[10px] text-neutral-600">
            {ACTIVITY_LABEL[hike.activityType]}
          </span>
          <button
            type="button"
            onClick={() => setRenaming({ hikeId: hike.id, title: hike.title })}
            className="shrink-0 rounded border border-neutral-300 px-2 py-0.5 text-[11px] text-neutral-600 hover:bg-neutral-50"
          >
            이름 수정
          </button>
          {isAdmin && (
            <button
              type="button"
              onClick={removeActivity}
              disabled={deleting}
              className="ml-auto shrink-0 rounded border border-red-300 px-2 py-0.5 text-[11px] text-red-600 hover:bg-red-50 disabled:opacity-50"
            >
              활동 삭제
            </button>
          )}
        </div>
        )}
        <p className="mt-0.5 text-xs text-neutral-500">
          {new Date(hike.date).toLocaleDateString("ko-KR")}
          {distance ? " · " + distance : ""}
          {hike.trackSource === "photos" ? " · 사진 기반 경로" : ""}
          {" · 사진 " + hike.photos.length + "장"}
        </p>
        {hike.description && (
          <p className="mt-2 text-sm text-neutral-700">{hike.description}</p>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <button
          type="button"
          onClick={() => setUploadOpen(true)}
          className="mb-4 w-full rounded-lg border border-dashed border-neutral-300 py-2 text-xs text-neutral-600 hover:border-neutral-500"
        >
          + 이 활동에 사진 올리기
        </button>

        {location.type !== "climbing_gym" && (
          <div className="mb-4 rounded-lg border border-dashed border-neutral-300 p-3">
            <p className="text-xs font-medium">
              {hike.trackSource === "gpx" ? "GPX 경로 등록됨" : "GPX 경로 없음"}
            </p>
            <p className="mt-0.5 text-[11px] text-neutral-500">
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
            {uploading && <p className="mt-1 text-[11px] text-neutral-500">업로드 중…</p>}
            {gpxError && <p className="mt-1 text-[11px] text-red-600">{gpxError}</p>}
          </div>
        )}

        {photos.length === 0 ? (
          <p className="py-8 text-center text-sm text-neutral-500">아직 올라온 사진이 없습니다.</p>
        ) : (
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {photos.map((photo, index) => (
              <li key={photo.id} className="relative">
                <button
                  type="button"
                  onClick={() => setOpenIndex(index)}
                  className="relative block w-full overflow-hidden rounded-lg border border-neutral-200 bg-neutral-100"
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
                  <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-1.5 py-1 text-left text-[10px] text-white">
                    {photo.uploaderName}
                  </span>
                </button>
                {/* Any approved member may remove a photo, not just admins. */}
                <button
                  type="button"
                  onClick={() => removePhoto(photo.id)}
                  disabled={deleting}
                  aria-label="사진 삭제"
                  className="absolute right-1 top-1 rounded bg-black/60 px-1.5 py-0.5 text-[11px] leading-none text-white hover:bg-red-600 disabled:opacity-50"
                >
                  삭제
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {uploadOpen && (
        <HikePhotoUpload hikeId={hike.id} onClose={() => setUploadOpen(false)} />
      )}

      <PhotoLightbox photos={photos} openIndex={openIndex} onChangeIndex={setOpenIndex} />
    </div>
  );
}
