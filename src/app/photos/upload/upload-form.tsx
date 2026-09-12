"use client";

import { useState } from "react";
import { presignPhotoUpload, processUploadedPhoto } from "./actions";
import { parseExif } from "@/lib/gps/exif";
import {
  MAX_PHOTO_BYTES,
  PHOTO_ACCEPT_ATTR,
  PHOTO_LIMITS_HINT,
  resolvePhotoType,
} from "@/lib/photos/limits";
import type { PhotoLocationMatchStatus } from "@/types/database";

interface Hike {
  id: string;
  title: string;
  date: string;
}

type FileStatus =
  | { state: "pending" }
  | { state: "uploading" }
  | { state: "processing" }
  | { state: "done"; status: PhotoLocationMatchStatus }
  | { state: "error"; message: string };

const STATUS_LABEL: Record<PhotoLocationMatchStatus, string> = {
  auto_matched: "위치 자동 매칭됨",
  manual_matched: "산행 위치로 매칭됨",
  manual_pending: "관리자 확인 필요",
  no_gps: "위치 정보 없음",
};

export function UploadForm({ hikes }: { hikes: Hike[] }) {
  const [hikeId, setHikeId] = useState("");
  const [files, setFiles] = useState<{ file: File; status: FileStatus }[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [rejectedCount, setRejectedCount] = useState(0);

  function onFilesSelected(selected: FileList | null) {
    if (!selected) return;
    const picked = Array.from(selected);
    const usable = picked.filter(
      (file) => resolvePhotoType(file.name, file.type) !== null && file.size <= MAX_PHOTO_BYTES,
    );
    setRejectedCount(picked.length - usable.length);
    setFiles(usable.map((file) => ({ file, status: { state: "pending" } })));
  }

  async function uploadOne(file: File): Promise<FileStatus> {
    // Resolved rather than taken from file.type directly: an empty type would
    // land in R2 as application/octet-stream and fail the server-side check.
    const contentType = resolvePhotoType(file.name, file.type);
    if (!contentType) return { state: "error", message: PHOTO_LIMITS_HINT };

    const { storageKey, uploadUrl } = await presignPhotoUpload({
      filename: file.name,
      contentType,
    });

    const putResponse = await fetch(uploadUrl, {
      method: "PUT",
      body: file,
      headers: { "content-type": contentType },
    });
    if (!putResponse.ok) {
      return { state: "error", message: `업로드 실패 (${putResponse.status})` };
    }

    // The server no longer reads the file back to find this - see
    // processUploadedPhoto.
    const exif = await parseExif(file);
    const result = await processUploadedPhoto({
      storageKey,
      hikeId: hikeId || null,
      exif: {
        lat: exif.lat,
        lng: exif.lng,
        takenAt: exif.takenAt ? exif.takenAt.toISOString() : null,
        width: exif.width,
        height: exif.height,
      },
    });
    return { state: "done", status: result.status };
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (files.length === 0 || submitting) return;
    setSubmitting(true);

    for (let i = 0; i < files.length; i++) {
      setFiles((prev) =>
        prev.map((f, idx) => (idx === i ? { ...f, status: { state: "uploading" } } : f)),
      );
      try {
        setFiles((prev) =>
          prev.map((f, idx) => (idx === i ? { ...f, status: { state: "processing" } } : f)),
        );
        const status = await uploadOne(files[i].file);
        setFiles((prev) => prev.map((f, idx) => (idx === i ? { ...f, status } : f)));
      } catch (err) {
        const message = err instanceof Error ? err.message : "알 수 없는 오류";
        setFiles((prev) =>
          prev.map((f, idx) => (idx === i ? { ...f, status: { state: "error", message } } : f)),
        );
      }
    }

    setSubmitting(false);
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1 text-sm">
        산행 (선택)
        <select
          value={hikeId}
          onChange={(e) => setHikeId(e.target.value)}
          className="rounded border border-neutral-300 px-3 py-2"
        >
          <option value="">선택 안 함</option>
          {hikes.map((hike) => (
            <option key={hike.id} value={hike.id}>
              {new Date(hike.date).toLocaleDateString("ko-KR")} · {hike.title}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-sm">
        사진 파일
        <input
          type="file"
          accept={PHOTO_ACCEPT_ATTR}
          multiple
          onChange={(e) => onFilesSelected(e.target.files)}
          className="rounded border border-neutral-300 px-3 py-2"
        />
        <span className="text-xs text-neutral-500">{PHOTO_LIMITS_HINT}</span>
        {rejectedCount > 0 && (
          <span className="text-xs text-red-600">
            {rejectedCount}개 파일은 지원하지 않는 형식이거나 용량이 커서 제외했습니다.
          </span>
        )}
      </label>

      <button
        type="submit"
        disabled={files.length === 0 || submitting}
        className="self-start rounded bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {submitting ? "업로드 중…" : `${files.length || ""} 장 업로드`}
      </button>

      {files.length > 0 && (
        <ul className="flex flex-col gap-1 text-sm">
          {files.map(({ file, status }, i) => (
            <li key={i} className="flex justify-between gap-4 text-neutral-600">
              <span className="truncate">{file.name}</span>
              <span className="shrink-0">
                {status.state === "pending" && "대기 중"}
                {status.state === "uploading" && "업로드 중…"}
                {status.state === "processing" && "처리 중…"}
                {status.state === "done" && STATUS_LABEL[status.status]}
                {status.state === "error" && (
                  <span className="text-red-600">{status.message}</span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </form>
  );
}
