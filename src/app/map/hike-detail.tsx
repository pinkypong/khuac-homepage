"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import Link from "next/link";
import { getThumbnailUrl } from "@/lib/images/url";
import {
  downsampleTrack,
  formatDistance,
  parseGpxPoints,
  trackDistanceMeters,
} from "@/lib/gps/track";
import { PhotoLightbox, type LightboxPhoto } from "@/components/photo-lightbox";
import type { MapHike, MapLocation } from "./map-shell";
import { saveHikeTrack } from "./actions";

export function HikeDetail({
  location,
  hike,
  onBackToRoot,
  onBackToLocation,
}: {
  location: MapLocation;
  hike: MapHike;
  onBackToRoot: () => void;
  onBackToLocation: () => void;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [gpxError, setGpxError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

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

  const distance =
    hike.track && hike.track.length >= 2 ? formatDistance(trackDistanceMeters(hike.track)) : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-neutral-200 px-4 py-3">
        <nav className="flex items-center gap-1.5 text-xs text-neutral-500">
          <button onClick={onBackToRoot} className="hover:underline">
            전체 지도
          </button>
          <span>›</span>
          <button onClick={onBackToLocation} className="hover:underline">
            {location.name}
          </button>
        </nav>
        <h1 className="mt-2 text-lg font-semibold">{hike.title}</h1>
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
          <p className="py-8 text-center text-sm text-neutral-500">
            아직 올라온 사진이 없습니다.{" "}
            <Link href="/photos/upload" className="underline">
              사진 업로드
            </Link>
          </p>
        ) : (
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {photos.map((photo, index) => (
              <li key={photo.id}>
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
              </li>
            ))}
          </ul>
        )}
      </div>

      <PhotoLightbox photos={photos} openIndex={openIndex} onChangeIndex={setOpenIndex} />
    </div>
  );
}
