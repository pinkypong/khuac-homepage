"use client";

import { useRef, useState } from "react";
import { presignPhotoUpload, processUploadedPhoto } from "./actions";
import { parseExif } from "@/lib/gps/exif";
import {
  MAX_PHOTO_BYTES,
  PHOTO_ACCEPT_ATTR,
  PHOTO_LIMITS_HINT,
  resolvePhotoType,
} from "@/lib/photos/limits";
import type { ActivityType, PhotoLocationMatchStatus } from "@/types/database";

interface Hike {
  id: string;
  title: string;
  date: string;
  activity_type: ActivityType;
  location_id: string;
  locationName: string;
  region: string;
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
  const [query, setQuery] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [activity, setActivity] = useState("");
  const [region, setRegion] = useState("");
  const [place, setPlace] = useState("");
  const labels: Record<ActivityType,string> = {hiking:"워킹",climbing:"등반",outdoor_wall:"외벽",indoor_climbing:"실내"};
  const regions = [...new Set(hikes.map(h=>h.region))].sort((a,b)=>a.localeCompare(b,"ko"));
  const places = [...new Map(hikes.filter(h=>!region||h.region===region).map(h=>[h.location_id,h.locationName])).entries()];
  const invalidRange = Boolean(from && to && from > to);
  const filtered = hikes.filter(h=>(!from||h.date>=from)&&(!to||h.date<=to)&&(!activity||h.activity_type===activity)&&(!region||h.region===region)&&(!place||h.location_id===place)&&[h.title,h.locationName,h.region].join(" ").toLowerCase().includes(query.trim().toLowerCase()));
  const selected = hikes.find(h=>h.id===hikeId);
  function changeFilter(set:(v:string)=>void,value:string){set(value);setHikeId("");}

  const [files, setFiles] = useState<{ file: File; status: FileStatus }[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [rejectedCount, setRejectedCount] = useState(0);
  /** How many of the chosen files carry no position. Null until counted. */
  const [noGpsCount, setNoGpsCount] = useState<number | null>(null);
  const uploaded = useRef(new WeakMap<File, { storageKey: string; hikeId: string }>());

  async function onFilesSelected(selected: FileList | null) {
    if (!selected) return;
    const picked = Array.from(selected);
    const usable = picked.filter(
      (file) => resolvePhotoType(file.name, file.type) !== null && file.size <= MAX_PHOTO_BYTES,
    );
    setRejectedCount(picked.length - usable.length);
    setFiles(usable.map((file) => ({ file, status: { state: "pending" } })));

    // Counted here rather than reported after the upload: whether a photo still
    // carries where it was taken is the one thing that cannot be fixed later,
    // and 네이버 밴드 strips it on the way through. This screen keeps its files
    // in a list, so the count sits above the button instead of interrupting.
    setNoGpsCount(null);
    let missing = 0;
    for (let i = 0; i < usable.length; i += 8) {
      const batch = await Promise.all(usable.slice(i, i + 8).map((file) => parseExif(file).catch(() => null)));
      missing += batch.filter((exif) => exif?.lat == null || exif?.lng == null).length;
    }
    setNoGpsCount(missing);
  }

  async function uploadOne(file: File): Promise<FileStatus> {
    // Resolved rather than taken from file.type directly: an empty type would
    // land in R2 as application/octet-stream and fail the server-side check.
    const contentType = resolvePhotoType(file.name, file.type);
    if (!contentType) return { state: "error", message: PHOTO_LIMITS_HINT };

    const previous = uploaded.current.get(file);
    let storageKey = previous?.hikeId === hikeId ? previous.storageKey : undefined;
    if (!storageKey) {
      const signed = await presignPhotoUpload({
        filename: file.name,
        contentType,
      });

      const putResponse = await fetch(signed.uploadUrl, {
        method: "PUT",
        body: file,
        headers: { "content-type": contentType },
        signal: AbortSignal.timeout(120_000),
      });
      if (!putResponse.ok) {
        return { state: "error", message: `업로드 실패 (${putResponse.status})` };
      }
      storageKey = signed.storageKey;
      uploaded.current.set(file, { storageKey, hikeId });
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
    if (files.length === 0 || submitting || !hikeId || invalidRange) return;
    setSubmitting(true);

    for (let i = 0; i < files.length; i++) {
      if (files[i].status.state === "done") continue;
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
      <fieldset disabled={submitting} className="upload-selection">
        <legend className="mb-4 font-semibold">1. 업로드할 앨범 찾기</legend>
        <div className="upload-filter-grid">
          <label>시작일<input type="date" value={from} max={to||undefined} onChange={e=>changeFilter(setFrom,e.target.value)}/></label>
          <label>종료일<input type="date" value={to} min={from||undefined} onChange={e=>changeFilter(setTo,e.target.value)}/></label>
          <label>활동<select value={activity} onChange={e=>changeFilter(setActivity,e.target.value)}><option value="">전체 활동</option>{Object.entries(labels).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label>
          <label>지역<select value={region} onChange={e=>{changeFilter(setRegion,e.target.value);setPlace("");}}><option value="">전체 지역</option>{regions.map(r=><option key={r}>{r}</option>)}</select></label>
          <label>장소<select value={place} onChange={e=>changeFilter(setPlace,e.target.value)}><option value="">전체 장소</option>{places.map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label>
          <label>검색<input type="search" placeholder="활동명·장소명" value={query} onChange={e=>changeFilter(setQuery,e.target.value)}/></label>
        </div>
        <div className="my-4 flex items-center justify-between text-xs text-neutral-500"><span aria-live="polite">{filtered.length}개 앨범</span><button type="button" onClick={()=>{setFrom("");setTo("");setActivity("");setRegion("");setPlace("");setQuery("");setHikeId("");}}>필터 초기화</button></div>
        {invalidRange && <p role="alert" className="text-sm text-red-700">종료일은 시작일 이후로 선택해주세요.</p>}
        <div className="upload-results" role="radiogroup" aria-label="업로드 대상 앨범">
        {filtered.map(h=><label key={h.id} className={hikeId===h.id?"selected":""}><input type="radio" name="album" value={h.id} checked={hikeId===h.id} onChange={()=>setHikeId(h.id)}/><span><strong>{h.title}</strong><small>{h.region} / {h.locationName} · {labels[h.activity_type]} · {h.date}</small></span></label>)}
        {!filtered.length && <p className="p-5 text-sm text-neutral-500">조건에 맞는 앨범이 없습니다. 기간이나 활동을 변경해주세요.</p>}
        </div>
        {selected && <p className="mt-4 border-l-2 border-[#5b1a23] pl-3 text-sm">업로드 위치: {selected.region} / {selected.locationName} / {selected.title} · {selected.date}</p>}
      </fieldset>

      <label className="flex flex-col gap-1 text-sm">
        2. 사진 선택
        <input
          disabled={submitting}
          type="file"
          accept={PHOTO_ACCEPT_ATTR}
          multiple
          onChange={(e) => onFilesSelected(e.target.files)}
          className="rounded border border-neutral-300 px-3 py-2"
        />
        <span className="text-xs text-neutral-500">{PHOTO_LIMITS_HINT}</span>
        <span className="text-xs text-neutral-700">
          찍은 사람이 누구든 <strong>전부 올려주세요.</strong> 밴드·카톡에서 받은 사진도 괜찮습니다.
        </span>
        <span className="text-xs text-neutral-500">
          다만 밴드·카톡을 거친 사진은 위치정보가 지워져 지도에만 안 뜹니다. 폰에서 바로 올리면 지도에도 표시됩니다.
        </span>
        {rejectedCount > 0 && (
          <span className="text-xs text-red-600">
            {rejectedCount}개 파일은 지원하지 않는 형식이거나 용량이 커서 제외했습니다.
          </span>
        )}
        {noGpsCount !== null && noGpsCount > 0 && (
          <span className="rounded border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs text-amber-900">
            {noGpsCount === files.length
              ? `고르신 ${noGpsCount}장 모두 위치정보가 없습니다.`
              : `${files.length}장 중 ${noGpsCount}장에 위치정보가 없습니다.`}
            {" "}앨범에는 정상으로 들어가고, 지도에만 표시되지 않습니다.
          </span>
        )}
      </label>

      <button
        type="submit"
        disabled={files.length === 0 || files.every((file) => file.status.state === "done") || submitting || !hikeId || invalidRange}
        className="self-start rounded bg-[#5b1a23] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
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
