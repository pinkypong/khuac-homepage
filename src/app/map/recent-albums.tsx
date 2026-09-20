"use client";

import Image from "next/image";
import type { MapHike, MapLocation } from "./map-shell";
import { getPreviewUrl, getThumbnailUrl } from "@/lib/images/url";
import { ACTIVITY_LABEL } from "./activity";
import { albumCover, newPhotoCount, newestFirst } from "./album-cover";

export function RecentAlbums({ locations, onOpenHike }: {
  locations: MapLocation[];
  onOpenHike: (hike: MapHike) => void;
}) {
  const albums = locations.flatMap(location => location.hikes.map(hike => ({ location, hike })))
    .sort((a, b) => b.hike.date.localeCompare(a.hike.date) || a.hike.id.localeCompare(b.hike.id));
  const latest = albums[0];
  if (!latest) return <p className="px-6 py-10 text-sm text-club-muted">아직 등록된 활동이 없습니다.</p>;
  const { hike, location } = latest;
  // Newest upload first here, unlike the album itself: this is the front page,
  // and what it is for is showing that something new arrived.
  const recent = newestFirst(hike.photos);
  const cover = recent[0];
  const fresh = newPhotoCount(hike.photos);

  return (
    <section className="recent-albums" aria-label="최근 앨범">
      <div className="recent-feature">
        <div className="recent-kicker">최근 앨범 <span>/ {location.name}</span></div>
        <button className="recent-title" onClick={() => onOpenHike(hike)}>
          {hike.title}<span aria-hidden="true">↗</span>
        </button>
        <p className="recent-meta">
          {ACTIVITY_LABEL[hike.activityType]} · {hike.date.replaceAll("-", ".")} · 사진 {hike.photos.length}
          {fresh > 0 && <span className="recent-new" suppressHydrationWarning>새 사진 {fresh}</span>}
        </p>
        {cover ? (
          <button className="recent-cover" aria-label={`${hike.title} 앨범 열기`} onClick={() => onOpenHike(hike)}>
            <Image unoptimized src={getPreviewUrl(cover.storageKey)} alt={hike.title} width={1000} height={750} />
          </button>
        ) : (
          <button className="recent-empty" onClick={() => onOpenHike(hike)}>
            <span aria-hidden="true">＋</span>사진 추가하기
          </button>
        )}
        {hike.photos.length > 1 && (
          <div className="recent-strip">
            {recent.slice(1, 4).map(photo => (
              <button key={photo.id} onClick={() => onOpenHike(hike)} aria-label={`${hike.title} 사진 보기`}>
                <Image unoptimized src={getThumbnailUrl(photo.storageKey)} alt="" width={240} height={180} />
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="recent-archive">
        <div className="recent-list-label">다른 기록 <span>{Math.max(0, albums.length - 1)}</span></div>
        {albums.length === 1 && <p className="py-6 text-sm text-club-muted">등록된 첫 번째 앨범입니다.</p>}
        {albums.slice(1).map(({ hike: item, location: place }) => (
          <button key={item.id} className="recent-row" onClick={() => onOpenHike(item)}>
            {albumCover(item.photos) ? <Image unoptimized src={getThumbnailUrl(albumCover(item.photos)!.storageKey)} width={96} height={72} alt="" /> : <span className="recent-row-placeholder">사진 없음</span>}
            <span className="recent-row-text"><strong>{item.title}{newPhotoCount(item.photos) > 0 && <span className="recent-new" suppressHydrationWarning>새 사진 {newPhotoCount(item.photos)}</span>}</strong><small>{place.name} · {item.date.replaceAll("-", ".")} · 사진 {item.photos.length}</small></span>
            <span aria-hidden="true">↗</span>
          </button>
        ))}
      </div>
    </section>
  );
}
