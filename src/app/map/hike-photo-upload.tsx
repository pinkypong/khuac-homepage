"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  MAX_PHOTO_BYTES,
  PHOTO_ACCEPT_ATTR,
  PHOTO_LIMITS_HINT,
  resolvePhotoType,
} from "@/lib/photos/limits";
import { presignPhotoUpload, processUploadedPhoto } from "@/app/photos/upload/actions";
import { parseExif } from "@/lib/gps/exif";

// A dialog rather than its own page: the hike is already open, so there is
// nothing to choose - asking again would mean searching a list that only grows.
export function HikePhotoUpload({ hikeId, onClose }: { hikeId: string; onClose: () => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  async function onFiles(fileList: FileList | null) {
    if (!fileList?.length) return;
    const files = Array.from(fileList);
    setError(null);
    setBusy(true);

    // Three at a time. Strictly sequential meant a phone sat idle through each
    // round trip before starting the next file; unbounded would have a hike's
    // worth of multi-megabyte uploads fighting over one mobile connection.
    const CONCURRENCY = 3;

    let done = 0;
    let skipped = 0;
    let failure: string | null = null;

    const queue = files.filter((file) => {
      const ok = resolvePhotoType(file.name, file.type) && file.size <= MAX_PHOTO_BYTES;
      if (!ok) skipped += 1;
      return ok;
    });

    setProgress(`0/${queue.length} 업로드 중…`);

    let next = 0;
    async function worker() {
      while (!failure) {
        const index = next++;
        const file = queue[index];
        if (!file) return;

        const contentType = resolvePhotoType(file.name, file.type) as string;
        try {
          // Read here rather than on the server: exifr range-reads the header
          // straight from the File, so the bytes never make a second trip.
          const exif = await parseExif(file);
          const { storageKey, uploadUrl } = await presignPhotoUpload({
            filename: file.name,
            contentType,
          });
          const put = await fetch(uploadUrl, {
            method: "PUT",
            body: file,
            headers: { "content-type": contentType },
            signal: AbortSignal.timeout(120_000),
          });
          if (!put.ok) throw new Error(`업로드 실패 (${put.status})`);
          await processUploadedPhoto({
            storageKey,
            hikeId,
            exif: {
              lat: exif.lat,
              lng: exif.lng,
              takenAt: exif.takenAt ? exif.takenAt.toISOString() : null,
              width: exif.width,
              height: exif.height,
            },
          });
          done += 1;
          setProgress(`${done}/${queue.length} 업로드 중…`);
        } catch (err) {
          failure = err instanceof Error ? err.message : "업로드에 실패했습니다.";
        }
      }
    }

    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
    if (failure) setError(failure);

    setBusy(false);
    setProgress(
      skipped > 0 ? `${done}장 업로드 완료 · ${skipped}장 제외됨` : `${done}장 업로드 완료`,
    );
    router.refresh();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      onClick={() => !busy && onClose()}
    >
      <div
        className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold">사진 올리기</h2>
            <p className="mt-0.5 text-xs text-club-muted">{PHOTO_LIMITS_HINT}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="닫기"
            className="px-2 py-1 text-xl leading-none text-club-faint hover:text-club-ink-soft disabled:opacity-40"
          >
            ×
          </button>
        </div>

        <input
          type="file"
          accept={PHOTO_ACCEPT_ATTR}
          multiple
          disabled={busy}
          onChange={(e) => onFiles(e.target.files)}
          className="mt-4 w-full rounded border border-club-line px-3 py-2 text-sm md:text-xs"
        />

        {progress && <p className="mt-2 text-xs text-club-muted">{progress}</p>}
        {error && <p className="mt-2 text-xs text-red-600">{error}</p>}

        <div className="mt-5 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded bg-club-ink px-4 py-2 text-sm text-white disabled:opacity-50 md:py-1.5 md:text-xs"
          >
            {busy ? "업로드 중…" : "닫기"}
          </button>
        </div>
      </div>
    </div>
  );
}
