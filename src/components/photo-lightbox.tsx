"use client";

import { useCallback, useEffect, useState } from "react";
import { getPreviewUrl } from "@/lib/images/url";
import { getOriginalUrl } from "@/app/hikes/[id]/actions";

export interface LightboxPhoto {
  id: string;
  storageKey: string;
  takenAt: string | null;
  uploaderName: string;
}

function formatTaken(takenAt: string | null) {
  if (!takenAt) return "촬영일 정보 없음";
  return new Date(takenAt).toLocaleString("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function PhotoLightbox({
  photos,
  openIndex,
  onChangeIndex,
}: {
  photos: LightboxPhoto[];
  openIndex: number | null;
  onChangeIndex: (index: number | null) => void;
}) {
  const [downloading, setDownloading] = useState(false);

  const close = useCallback(() => onChangeIndex(null), [onChangeIndex]);
  const step = useCallback(
    (delta: number) => {
      if (openIndex === null || photos.length === 0) return;
      onChangeIndex((openIndex + delta + photos.length) % photos.length);
    },
    [openIndex, photos.length, onChangeIndex],
  );

  useEffect(() => {
    if (openIndex === null) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
      if (e.key === "ArrowRight") step(1);
      if (e.key === "ArrowLeft") step(-1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openIndex, close, step]);

  if (openIndex === null) return null;
  const open = photos[openIndex];
  if (!open) return null;

  async function downloadOriginal(photoId: string) {
    setDownloading(true);
    try {
      // Originals stay private in R2; this hands out a short-lived signed URL.
      const url = await getOriginalUrl(photoId);
      window.open(url, "_blank", "noopener");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-black/90"
      role="dialog"
      aria-modal="true"
      onClick={close}
    >
      <div className="flex items-start justify-between gap-4 p-4 text-white">
        <div>
          <p className="text-sm font-medium">{open.uploaderName}</p>
          <p className="text-xs text-white/70">{formatTaken(open.takenAt)}</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              downloadOriginal(open.id);
            }}
            disabled={downloading}
            className="rounded border border-white/40 px-3 py-1.5 text-xs disabled:opacity-50"
          >
            {downloading ? "여는 중…" : "원본 다운로드"}
          </button>
          <button type="button" onClick={close} className="text-2xl leading-none" aria-label="닫기">
            ×
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 items-center justify-center px-4 pb-6">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            step(-1);
          }}
          className="shrink-0 px-3 py-6 text-3xl text-white/70 hover:text-white"
          aria-label="이전 사진"
        >
          ‹
        </button>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={getPreviewUrl(open.storageKey)}
          alt={open.uploaderName + "님이 올린 사진"}
          onClick={(e) => e.stopPropagation()}
          className="max-h-full max-w-full object-contain"
        />
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            step(1);
          }}
          className="shrink-0 px-3 py-6 text-3xl text-white/70 hover:text-white"
          aria-label="다음 사진"
        >
          ›
        </button>
      </div>

      <p className="pb-4 text-center text-xs text-white/50">
        {openIndex + 1} / {photos.length}
      </p>
    </div>
  );
}
