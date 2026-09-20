"use client";

import Image from "next/image";
import { getThumbnailUrl } from "@/lib/images/url";
import { albumCover, byLastActivity } from "./album-cover";
import { ACTIVITY_LABEL } from "./activity";
import type { MapHike, MapLocation } from "./map-shell";

export function RecentActivityStrip({
  locations,
  onOpenHike,
  onViewAll,
}: {
  locations: MapLocation[];
  onOpenHike: (hike: MapHike) => void;
  onViewAll: () => void;
}) {
  const activities = locations
    .flatMap((location) => location.hikes.map((hike) => ({ location, hike })))
    .sort(byLastActivity)
    .slice(0, 3);

  if (activities.length === 0) return null;

  return (
    <section className="map-recent-strip" aria-label="최근 활동">
      <div className="map-recent-heading">
        <div>
          <strong>최근 활동</strong>
          <button type="button" onClick={onViewAll}>장소별 앨범</button>
        </div>
        <p><span>{String(activities.length).padStart(2, "0")}</span>개의 최신 기록</p>
        <button type="button" onClick={onViewAll}>전체보기 <span aria-hidden="true">→</span></button>
      </div>
      <ul className="map-recent-grid">
        {activities.map(({ location, hike }) => (
          <li key={hike.id}>
            <button
              type="button"
              onClick={() => onOpenHike(hike)}
            >
              {albumCover(hike.photos) ? (
                <Image
                  unoptimized
                  src={getThumbnailUrl(albumCover(hike.photos)!.storageKey)}
                  width={360}
                  height={220}
                  alt=""
                />
              ) : (
                <span className="map-recent-placeholder" aria-hidden="true">
                  <svg viewBox="0 0 240 100" preserveAspectRatio="none">
                    <path d="M0 91 38 55l19 14 37-51 28 34 17-18 42 44 22-29 37 42" />
                    <path d="m77 42 17-24 13 16M165 61l16 17 12-16" />
                  </svg>
                  <span>KHUAC</span>
                </span>
              )}
              <span className="map-recent-copy">
                <small>{hike.date.replaceAll("-", ". ")}</small>
                <strong>{hike.title}</strong>
                <span>{location.name} · {ACTIVITY_LABEL[hike.activityType]}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
