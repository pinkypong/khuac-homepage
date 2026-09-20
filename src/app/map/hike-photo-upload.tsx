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

    // Counted as they go and reported at the end, deliberately not asked about.
    // A photo with no position still belongs in the album - it is a picture of
    // the day either way - so nothing here stops it. It is worth saying though,
    // because it is the one property a member cannot see and cannot repair
    // afterwards: 네이버 밴드 strips GPS on the way through, measured on four
    // photos that arrived with all 46 of their other EXIF tags intact, while
    // the same phone uploading straight here keeps them.
    let withoutGps = 0;

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
          const exif = await parseExif(file).catch(() => null);
          if (exif?.lat == null || exif?.lng == null) withoutGps += 1;
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
            // Null throughout when the header could not be read at all, which
            // the server treats the same as a photo that carried nothing.
            exif: {
              lat: exif?.lat ?? null,
              lng: exif?.lng ?? null,
              takenAt: exif?.takenAt ? exif.takenAt.toISOString() : null,
              width: exif?.width ?? null,
              height: exif?.height ?? null,
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
    setProgress([
      `${done}장 업로드 완료`,
      skipped > 0 ? `${skipped}장 제외됨` : null,
      withoutGps > 0 ? `${withoutGps}장은 위치정보가 없어 지도에 표시되지 않습니다` : null,
    ].filter(Boolean).join(" · "));
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
            {/* Said before the files are chosen, not only after. Measured: a
                photo saved out of 네이버 밴드 arrives with every EXIF tag it
                started with except the GPS ones. */}
            <p className="mt-1 text-xs text-amber-700">
              밴드·카카오톡에서 받은 사진은 위치정보가 지워져 지도에 뜨지 않습니다.
              찍은 폰에서 바로 올려주세요.
            </p>
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
