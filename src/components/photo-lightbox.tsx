"use client";

import { useCallback, useEffect, useState } from "react";
import { getPreviewUrl, getThumbnailUrl } from "@/lib/images/url";
import { getOriginalUrl } from "@/app/hikes/[id]/actions";
import { CommentThread } from "./comment-thread";

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
  // Which photo's full-size file has actually arrived, so the stand-in below
  // stays until it does.
  const [loadedId, setLoadedId] = useState<string | null>(null);

  const close = useCallback(() => onChangeIndex(null), [onChangeIndex]);
  const step = useCallback(
    (delta: number) => {
      if (openIndex === null || photos.length === 0) return;
      onChangeIndex((openIndex + delta + photos.length) % photos.length);
    },
    [openIndex, photos.length, onChangeIndex],
  );

  // Fetch the pictures either side in the background. Stepping through an
  // album otherwise starts every download from nothing at the moment the
  // arrow is pressed, which is the whole of the wait.
  useEffect(() => {
    if (openIndex === null || photos.length < 2) return;
    for (const delta of [1, -1]) {
      const neighbour = photos[(openIndex + delta + photos.length) % photos.length];
      if (!neighbour) continue;
      const preload = new window.Image();
      preload.src = getPreviewUrl(neighbour.storageKey);
    }
  }, [openIndex, photos]);

  useEffect(() => {
    if (openIndex === null) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
      // Arrow keys move the caret while a comment is being typed; stepping to
      // the next photo mid-sentence would throw the draft away.
      const target = e.target as HTMLElement | null;
      if (target?.tagName === "TEXTAREA" || target?.tagName === "INPUT") return;
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
    } catch {
      // Any member may delete any photo, so the one on screen can be gone by
      // the time this button is pressed. Without this the rejection was
      // swallowed and the button simply did nothing, twice, forever.
      window.alert("사진을 찾을 수 없습니다. 이미 삭제되었을 수 있습니다.");
      close();
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
      <div className="flex items-start justify-between gap-3 px-4 pb-3 pt-[calc(1rem+env(safe-area-inset-top))] text-white">
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
            className="rounded border border-white/40 px-3 py-2 text-xs disabled:opacity-50 md:py-1.5"
          >
            {downloading ? "여는 중…" : "원본 다운로드"}
          </button>
          <button type="button" onClick={close} className="px-1 text-2xl leading-none" aria-label="닫기">
            ×
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] md:flex-row md:gap-4">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="relative flex min-h-0 flex-1 items-center justify-center">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                step(-1);
              }}
              className="absolute left-0 top-1/2 z-10 -translate-y-1/2 px-3 py-6 text-3xl text-white/70 drop-shadow-md hover:text-white md:static md:translate-y-0 md:shrink-0 md:drop-shadow-none"
              aria-label="이전 사진"
            >
              ‹
            </button>
            <span
              className="relative flex min-h-0 min-w-0 flex-1 items-center justify-center"
              onClick={(e) => e.stopPropagation()}
            >
              {/* The grid already downloaded this one, so it paints instantly
                  and the screen is never blank while the full-size file is on
                  its way. Blurred so nobody mistakes it for a bad photo. */}
              {loadedId !== open.id && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={getThumbnailUrl(open.storageKey)}
                  alt=""
                  aria-hidden="true"
                  className="absolute inset-0 h-full w-full scale-105 object-contain blur-lg"
                />
              )}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                key={open.id}
                src={getPreviewUrl(open.storageKey)}
                alt={open.uploaderName + "님이 올린 사진"}
                onLoad={() => setLoadedId(open.id)}
                className={
                  "relative max-h-full max-w-full object-contain transition-opacity duration-200 " +
                  (loadedId === open.id ? "opacity-100" : "opacity-0")
                }
              />
            </span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                step(1);
              }}
              className="absolute right-0 top-1/2 z-10 -translate-y-1/2 px-3 py-6 text-3xl text-white/70 drop-shadow-md hover:text-white md:static md:translate-y-0 md:shrink-0 md:drop-shadow-none"
              aria-label="다음 사진"
            >
              ›
            </button>
          </div>

          <p className="pt-2 text-center text-xs text-white/50">
            {openIndex + 1} / {photos.length}
          </p>
        </div>

        {/* A light panel rather than a dark variant of the thread: it is the
            same component the activity panel renders, and one styling keeps
            the two readings of a comment identical.
            Keyed by photo so stepping to the next one drops the half-typed
            draft with the photo it was meant for. */}
        <aside
          onClick={(e) => e.stopPropagation()}
          className="max-h-[40dvh] w-full shrink-0 overflow-y-auto rounded-lg bg-white p-3 md:max-h-none md:w-80"
        >
          <CommentThread key={open.id} subjectKind="photo" subjectId={open.id} />
        </aside>
      </div>
    </div>
  );
}
