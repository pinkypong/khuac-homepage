"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { ActivityType, LocationType } from "@/types/database";
import { formatDistance, trackDistanceMeters, type TrackPoint } from "@/lib/gps/track";
import type { MapHike, MapLocation, PickedPoint } from "./map-shell";
import { HikeDetail } from "./hike-detail";
import { NewLocationForm } from "./new-location-form";
import { NewHikeForm } from "./new-hike-form";
import { ACTIVITY_COLOR, ACTIVITY_LABEL, folderMarkerColor } from "./activity";
import { getThumbnailUrl } from "@/lib/images/url";
import { isValidGps } from "@/lib/gps/validate";
import { deleteLocation } from "./admin-actions";
import { renameLocation } from "./actions";

export const TYPE_LABEL: Record<LocationType, string> = {
  mountain: "산",
  climbing_gym: "실내 클라이밍짐",
  crag: "실외 암장",
};

/** Same colour the marker uses, so a badge here reads as that dot out there. */
function ActivityTag({ type }: { type: ActivityType }) {
  return (
    <span
      className="shrink-0 rounded px-1.5 py-px text-[10px] font-medium text-white"
      style={{ backgroundColor: ACTIVITY_COLOR[type] }}
    >
      {ACTIVITY_LABEL[type]}
    </span>
  );
}

/** The folder's own dot, repeated beside its name in the list. Grey when the
    folder mixes kinds of outing - the activity badges below carry the detail. */
function FolderDot({ location }: { location: MapLocation }) {
  return (
    <span
      className="h-2.5 w-2.5 shrink-0 rounded-full"
      style={{ backgroundColor: folderMarkerColor(location.hikes.map((h) => h.activityType)) }}
    />
  );
}

/** Small preview of a route, shown next to each hike in a location's list. */
/**
 * A route sketch, or the first photo when there is no route.
 *
 * Most activities have no GPX - a track is only drawn from a real one now - so
 * "경로 없음" would be what nearly every row showed. A thumbnail says more
 * about an outing than the absence of a file does.
 */
function TrackThumb({
  track,
  pinned,
  hike,
}: {
  track: TrackPoint[] | null;
  pinned: boolean;
  hike: MapHike;
}) {
  if (!track || track.length < 2) {
    const cover = hike.photos[0];
    if (cover) {
      return (
        <span className="h-11 w-14 shrink-0 overflow-hidden rounded border border-neutral-200 bg-neutral-100">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={getThumbnailUrl(cover.storageKey)}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover"
          />
        </span>
      );
    }
    return (
      <span className="flex h-11 w-14 shrink-0 items-center justify-center rounded border border-neutral-200 bg-neutral-50 text-center text-[9px] leading-tight text-neutral-400">
        사진 없음
      </span>
    );
  }

  const lats = track.map((p) => p[0]);
  const lngs = track.map((p) => p[1]);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const spanLat = Math.max(maxLat - minLat, 1e-6);
  const spanLng = Math.max(maxLng - minLng, 1e-6);

  // y is flipped: latitude grows north, SVG coordinates grow downward.
  const d = track
    .map((p, i) => {
      const x = ((p[1] - minLng) / spanLng) * 100;
      const y = 100 - ((p[0] - minLat) / spanLat) * 100;
      return (i === 0 ? "M" : "L") + x.toFixed(1) + "," + y.toFixed(1);
    })
    .join(" ");

  return (
    <span className="h-11 w-14 shrink-0 rounded border border-neutral-200 bg-neutral-50 p-1">
      <svg viewBox="-6 -6 112 112" className="h-full w-full" preserveAspectRatio="xMidYMid meet">
        <path
          d={d}
          fill="none"
          stroke={pinned ? "#D23B2E" : "#4A6B52"}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </span>
  );
}

function hikeMeta(hike: MapHike) {
  const parts: string[] = [new Date(hike.date).toLocaleDateString("ko-KR")];
  if (hike.track && hike.track.length >= 2) {
    parts.push(formatDistance(trackDistanceMeters(hike.track)));
  }
  const mapped = hike.photos.filter((p) => isValidGps(p.exifLat, p.exifLng)).length;
  parts.push("사진 " + hike.photos.length);
  // Worth saying out loud: it is what decides whether this row has anything to
  // show on the map at all.
  if (mapped > 0) parts.push("위치 " + mapped);
  return parts;
}

export function SidePanel({
  locations,
  activeLocation,
  activeHikeId,
  pinnedHikeId,
  onOpenLocation,
  onOpenHike,
  focusedPhotoId,
  onFocusedPhotoConsumed,
  onHoverHike,
  onBackToRoot,
  onShowOnMap,
  isAdmin,
  picking,
  pickedPoint,
  onPickingChange,
  onPickPoint,
}: {
  locations: MapLocation[];
  activeLocation: MapLocation | null;
  activeHikeId: string | null;
  pinnedHikeId: string | null;
  onOpenLocation: (locationId: string) => void;
  onOpenHike: (hike: MapHike) => void;
  focusedPhotoId: string | null;
  onFocusedPhotoConsumed: () => void;
  onHoverHike: (hikeId: string | null) => void;
  onBackToRoot: () => void;
  // Below md the map is a tab away rather than beside the panel, so every
  // screen that puts something on the map needs a way to go and look at it.
  onShowOnMap: () => void;
  isAdmin: boolean;
  picking: boolean;
  pickedPoint: PickedPoint | null;
  onPickingChange: (picking: boolean) => void;
  onPickPoint: (point: PickedPoint) => void;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [deleting, setDeleting] = useState(false);
  // Holds the id of the folder being renamed, not a boolean: leaving the folder
  // and opening another one must not carry a stale draft over to it.
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [savingName, setSavingName] = useState(false);

  async function saveName(location: MapLocation) {
    const name = draftName.trim();
    if (!name) {
      window.alert("장소 이름을 입력해주세요.");
      return;
    }
    if (name === location.name) {
      setRenamingId(null);
      return;
    }
    setSavingName(true);
    try {
      await renameLocation(location.id, name);
      setRenamingId(null);
      router.refresh();
    } catch (err) {
      // The input stays open with the typed name so a failed save is retryable.
      window.alert(err instanceof Error ? err.message : "장소 이름 변경에 실패했습니다.");
    } finally {
      setSavingName(false);
    }
  }

  async function removeLocation(location: MapLocation) {
    const message = `'${location.name}' 장소와 그 안의 모든 활동·사진이 함께 삭제됩니다. 계속할까요?`;
    if (!window.confirm(message)) return;
    setDeleting(true);
    try {
      await deleteLocation(location.id);
      // The open folder no longer exists, so fall back to the album list.
      onBackToRoot();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "장소 삭제에 실패했습니다.");
    } finally {
      setDeleting(false);
      // Refetched even when the action reports a failure: it drops the rows
      // before its storage cleanup, so a late error still leaves a folder
      // that is gone from the database but alive on the map.
      router.refresh();
    }
  }

  // The panel lists folders, not activities: a folder with no activity yet
  // still has to show up (it exists on the map), and one with several has to
  // open its own list rather than jumping into whichever activity came first.
  const folders = useMemo(() => {
    const q = query.trim().toLowerCase();
    return locations
      .filter((location) => {
        if (!q) return true;
        // A folder matches on its own fields or on any activity inside it.
        return [
          location.name,
          location.region ?? "",
          ...location.hikes.flatMap((hike) => [
            hike.title,
            hike.date,
            ...hike.photos.map((p) => p.uploaderName),
          ]),
        ]
          .join(" ")
          .toLowerCase()
          .includes(q);
      })
      .map((location) => {
        // page.tsx hands hikes over newest-first.
        const latestHike: MapHike | null = location.hikes[0] ?? null;
        return {
          location,
          latestHike,
          sortKey: latestHike?.date ?? location.createdAt.slice(0, 10),
        };
      })
      .sort(
        (a, b) =>
          b.sortKey.localeCompare(a.sortKey) ||
          a.location.name.localeCompare(b.location.name, "ko"),
      );
  }, [locations, query]);

  const activeHike = activeLocation?.hikes.find((h) => h.id === activeHikeId) ?? null;

  if (activeHike && activeLocation) {
    return (
      <HikeDetail
        location={activeLocation}
        hike={activeHike}
        onBackToRoot={onBackToRoot}
        onBackToLocation={() => onOpenLocation(activeLocation.id)}
        onShowOnMap={onShowOnMap}
        isAdmin={isAdmin}
        focusedPhotoId={focusedPhotoId}
        onFocusedPhotoConsumed={onFocusedPhotoConsumed}
      />
    );
  }

  if (activeLocation) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="border-b border-neutral-200 px-4 py-3">
          <div className="flex items-center justify-between gap-2">
            <button
              onClick={onBackToRoot}
              className="rounded border border-neutral-300 px-2 py-1.5 text-xs text-neutral-700 hover:bg-neutral-50 md:py-1"
            >
              {/* On a phone this button only moves the list: the map it also
                  resets is behind the other tab. */}
              <span className="md:hidden">← 전체 목록</span>
              <span className="hidden md:inline">← 전체 지도</span>
            </button>
            <button
              type="button"
              onClick={onShowOnMap}
              className="rounded border border-neutral-300 px-2 py-1.5 text-xs text-neutral-700 hover:bg-neutral-50 md:hidden"
            >
              지도에서 보기
            </button>
          </div>
          <div className="mt-2 flex items-center gap-2">
            {renamingId === activeLocation.id ? (
              <>
                <input
                  autoFocus
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void saveName(activeLocation);
                    } else if (e.key === "Escape") {
                      setRenamingId(null);
                    }
                  }}
                  disabled={savingName}
                  aria-label="장소 이름"
                  className="min-w-0 flex-1 rounded border border-neutral-300 px-2 py-1 text-base font-semibold disabled:opacity-50"
                />
                <button
                  type="button"
                  onClick={() => saveName(activeLocation)}
                  disabled={savingName}
                  className="shrink-0 rounded bg-neutral-800 px-2.5 py-1.5 text-xs text-white hover:bg-neutral-700 disabled:opacity-50 md:px-2 md:py-1 md:text-[11px]"
                >
                  저장
                </button>
                <button
                  type="button"
                  onClick={() => setRenamingId(null)}
                  disabled={savingName}
                  className="shrink-0 rounded border border-neutral-300 px-2.5 py-1.5 text-xs text-neutral-700 hover:bg-neutral-50 disabled:opacity-50 md:px-2 md:py-1 md:text-[11px]"
                >
                  취소
                </button>
              </>
            ) : (
              <>
                <FolderDot location={activeLocation} />
                <h1 className="min-w-0 truncate text-lg font-semibold">{activeLocation.name}</h1>
                <button
                  type="button"
                  onClick={() => {
                    setDraftName(activeLocation.name);
                    setRenamingId(activeLocation.id);
                  }}
                  className="ml-auto shrink-0 rounded border border-neutral-300 px-2 py-1 text-xs text-neutral-700 hover:bg-neutral-50 md:py-0.5 md:text-[11px]"
                >
                  이름 수정
                </button>
                {isAdmin && (
                  <button
                    type="button"
                    onClick={() => removeLocation(activeLocation)}
                    disabled={deleting}
                    className="shrink-0 rounded border border-red-300 px-2 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50 md:py-0.5 md:text-[11px]"
                  >
                    장소 삭제
                  </button>
                )}
              </>
            )}
          </div>
          <p className="mt-0.5 text-xs text-neutral-500">
            {[
              activeLocation.region,
              activeLocation.elevation ? activeLocation.elevation + "m" : null,
            ]
              .filter(Boolean)
              .join(" · ") || "정보 없음"}
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          <p className="mb-2 text-xs text-neutral-500">
            활동 기록 {activeLocation.hikes.length}건
          </p>
          <div className="mb-3">
            <NewHikeForm locationId={activeLocation.id} />
          </div>
          {activeLocation.hikes.length === 0 ? (
            <p className="py-8 text-center text-sm text-neutral-500">
              아직 등록된 활동이 없습니다.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {activeLocation.hikes.map((hike) => (
                <li key={hike.id}>
                  <button
                    onClick={() => onOpenHike(hike)}
                    onMouseEnter={() => onHoverHike(hike.id)}
                    onMouseLeave={() => onHoverHike(null)}
                    className={
                      "flex w-full items-center gap-3 rounded-lg border p-2 text-left transition-colors " +
                      (pinnedHikeId === hike.id
                        ? "border-red-400 bg-red-50"
                        : "border-neutral-200 hover:border-neutral-400")
                    }
                  >
                    <TrackThumb track={hike.track} pinned={pinnedHikeId === hike.id} hike={hike} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="min-w-0 truncate text-sm font-semibold">{hike.title}</span>
                        <ActivityTag type={hike.activityType} />
                      </span>
                      <span className="mt-0.5 block text-[11px] text-neutral-500">
                        {hikeMeta(hike).join(" · ")}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-neutral-200 px-4 py-3">
        {picking && (
          <div className="mb-2 rounded bg-red-50 px-2 py-1.5 text-[11px] text-red-700">
            <p>지도를 클릭해 새 장소의 위치를 지정하세요.</p>
            <button
              type="button"
              onClick={onShowOnMap}
              className="mt-1.5 rounded border border-red-300 px-2 py-1 text-xs font-medium md:hidden"
            >
              지도 열기
            </button>
          </div>
        )}
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="장소, 활동, 날짜, 올린 사람으로 검색"
          className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-base md:text-sm"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <div className="mb-3">
          <NewLocationForm
            pickedPoint={pickedPoint}
            onPickingChange={onPickingChange}
            onPickPoint={onPickPoint}
            onCreated={onOpenLocation}
          />
        </div>

        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold">장소 앨범</h2>
          <span className="text-xs text-neutral-500">{folders.length}곳</span>
        </div>

        {folders.length === 0 ? (
          <p className="py-8 text-center text-sm text-neutral-500">
            {query ? "검색 결과가 없습니다." : "아직 등록된 장소가 없습니다."}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {folders.map(({ location, latestHike }) => (
              <li key={location.id}>
                <button
                  onClick={() => onOpenLocation(location.id)}
                  className="w-full rounded-lg border border-neutral-200 p-3 text-left transition-colors hover:border-neutral-400"
                >
                  <span className="flex items-center gap-2">
                    <FolderDot location={location} />
                    <span className="min-w-0 truncate text-sm font-semibold">{location.name}</span>
                  </span>
                  <span className="mt-1 block text-[11px] text-neutral-500">
                    {[
                      location.region,
                      "활동 " + location.hikes.length + "건",
                      "사진 " + location.photoCount + "장",
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                  {latestHike ? (
                    <span className="mt-1 flex items-center gap-1.5">
                      <span className="min-w-0 truncate text-xs text-neutral-700">
                        최근 · {latestHike.title}
                      </span>
                      <ActivityTag type={latestHike.activityType} />
                      <span className="shrink-0 text-[11px] text-neutral-500">
                        {new Date(latestHike.date).toLocaleDateString("ko-KR")}
                      </span>
                    </span>
                  ) : (
                    <span className="mt-1 block text-xs text-neutral-400">
                      아직 활동이 없습니다 · 눌러서 첫 활동을 등록하세요
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
