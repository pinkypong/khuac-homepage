"use client";

import { useMemo, useState } from "react";
import type { LocationType } from "@/types/database";
import { formatDistance, trackDistanceMeters, type TrackPoint } from "@/lib/gps/track";
import type { MapHike, MapLocation } from "./map-shell";
import { HikeDetail } from "./hike-detail";

export const TYPE_LABEL: Record<LocationType, string> = {
  mountain: "산",
  climbing_gym: "실내 클라이밍짐",
  crag: "실외 암장",
};

export const TYPE_COLOR: Record<LocationType, string> = {
  mountain: "#C4622D",
  climbing_gym: "#3D6E86",
  crag: "#7A4F79",
};

function TypeTag({ type }: { type: LocationType }) {
  return (
    <span
      className="rounded-full px-1.5 py-0.5 text-[10px] font-medium text-white"
      style={{ backgroundColor: TYPE_COLOR[type] }}
    >
      {TYPE_LABEL[type]}
    </span>
  );
}

/** Small preview of a route, shown next to each hike in a location's list. */
function TrackThumb({ track, pinned }: { track: TrackPoint[] | null; pinned: boolean }) {
  if (!track || track.length < 2) {
    return (
      <span className="flex h-11 w-14 shrink-0 items-center justify-center rounded border border-neutral-200 bg-neutral-50 text-center text-[9px] leading-tight text-neutral-400">
        경로 없음
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
    if (hike.trackSource === "photos") parts.push("사진 기반");
  }
  parts.push("사진 " + hike.photos.length);
  return parts;
}

export function SidePanel({
  locations,
  activeLocation,
  activeHikeId,
  pinnedHikeId,
  onOpenLocation,
  onOpenHike,
  onHoverHike,
  onBackToRoot,
}: {
  locations: MapLocation[];
  activeLocation: MapLocation | null;
  activeHikeId: string | null;
  pinnedHikeId: string | null;
  onOpenLocation: (locationId: string) => void;
  onOpenHike: (hike: MapHike) => void;
  onHoverHike: (hikeId: string | null) => void;
  onBackToRoot: () => void;
}) {
  const [query, setQuery] = useState("");

  const albums = useMemo(() => {
    const entries = locations.flatMap((location) =>
      location.hikes.map((hike) => ({ location, hike })),
    );
    const q = query.trim().toLowerCase();
    const filtered = q
      ? entries.filter(({ location, hike }) =>
          [
            location.name,
            location.region ?? "",
            hike.title,
            hike.date,
            ...hike.photos.map((p) => p.uploaderName),
          ]
            .join(" ")
            .toLowerCase()
            .includes(q),
        )
      : entries;
    return filtered.sort((a, b) => b.hike.date.localeCompare(a.hike.date));
  }, [locations, query]);

  const activeHike = activeLocation?.hikes.find((h) => h.id === activeHikeId) ?? null;

  if (activeHike && activeLocation) {
    return (
      <HikeDetail
        location={activeLocation}
        hike={activeHike}
        onBackToRoot={onBackToRoot}
        onBackToLocation={() => onOpenLocation(activeLocation.id)}
      />
    );
  }

  if (activeLocation) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="border-b border-neutral-200 px-4 py-3">
          <button onClick={onBackToRoot} className="text-xs text-neutral-500 hover:underline">
            ← 전체 지도
          </button>
          <div className="mt-2 flex items-center gap-2">
            <h1 className="text-lg font-semibold">{activeLocation.name}</h1>
            <TypeTag type={activeLocation.type} />
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
            산행 기록 {activeLocation.hikes.length}건
          </p>
          {activeLocation.hikes.length === 0 ? (
            <p className="py-8 text-center text-sm text-neutral-500">
              아직 등록된 산행이 없습니다.
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
                    <TrackThumb track={hike.track} pinned={pinnedHikeId === hike.id} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{hike.title}</span>
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
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="산 이름, 산행, 날짜, 올린 사람으로 검색"
          className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold">산행 앨범</h2>
          <span className="text-xs text-neutral-500">{albums.length}건</span>
        </div>

        {albums.length === 0 ? (
          <p className="py-8 text-center text-sm text-neutral-500">
            {query ? "검색 결과가 없습니다." : "아직 등록된 산행이 없습니다."}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {albums.map(({ location, hike }) => (
              <li key={hike.id}>
                <button
                  onClick={() => onOpenHike(hike)}
                  className="w-full rounded-lg border border-neutral-200 p-3 text-left transition-colors hover:border-neutral-400"
                >
                  <span className="flex items-center gap-2">
                    <span className="text-sm font-semibold">{location.name}</span>
                    <TypeTag type={location.type} />
                  </span>
                  <span className="mt-1 block truncate text-sm text-neutral-700">{hike.title}</span>
                  <span className="mt-1 block text-[11px] text-neutral-500">
                    {new Date(hike.date).toLocaleDateString("ko-KR")} · 사진{" "}
                    {hike.photos.length}장
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
