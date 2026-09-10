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

    let done = 0;
    let skipped = 0;
    for (const file of files) {
      const contentType = resolvePhotoType(file.name, file.type);
      if (!contentType || file.size > MAX_PHOTO_BYTES) {
        skipped += 1;
        continue;
      }
      setProgress(`${done + 1}/${files.length} 업로드 중…`);
      try {
        const { storageKey, uploadUrl } = await presignPhotoUpload({
          filename: file.name,
          contentType,
        });
        const put = await fetch(uploadUrl, {
          method: "PUT",
          body: file,
          headers: { "content-type": contentType },
        });
        if (!put.ok) throw new Error(`업로드 실패 (${put.status})`);
        await processUploadedPhoto({ storageKey, hikeId });
        done += 1;
      } catch (err) {
        setError(err instanceof Error ? err.message : "업로드에 실패했습니다.");
        break;
      }
    }

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
            <p className="mt-0.5 text-[11px] text-neutral-500">{PHOTO_LIMITS_HINT}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="닫기"
            className="text-xl leading-none text-neutral-400 hover:text-neutral-700 disabled:opacity-40"
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
          className="mt-4 w-full rounded border border-neutral-300 px-3 py-2 text-xs"
        />

        {progress && <p className="mt-2 text-xs text-neutral-600">{progress}</p>}
        {error && <p className="mt-2 text-xs text-red-600">{error}</p>}

        <div className="mt-5 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded bg-neutral-900 px-4 py-1.5 text-xs text-white disabled:opacity-50"
          >
            {busy ? "업로드 중…" : "닫기"}
          </button>
        </div>
      </div>
    </div>
  );
}
