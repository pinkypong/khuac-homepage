"use client";

import { useState } from "react";
import { getThumbnailUrl } from "@/lib/images/url";
import { PhotoLightbox, type LightboxPhoto } from "@/components/photo-lightbox";

export type GalleryPhoto = LightboxPhoto;

export function HikeGallery({ photos }: { photos: GalleryPhoto[] }) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  return (
    <>
      <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
        {photos.map((photo, index) => (
          <li key={photo.id}>
            <button
              type="button"
              onClick={() => setOpenIndex(index)}
              className="relative block w-full overflow-hidden rounded-lg border border-neutral-200 bg-neutral-100"
              style={{ aspectRatio: "4 / 5" }}
            >
              {/* Plain <img>: /api/images already resizes, so next/image would
                  only re-wrap the same endpoint. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={getThumbnailUrl(photo.storageKey)}
                alt={photo.uploaderName + "님이 올린 사진"}
                loading="lazy"
                className="h-full w-full object-cover"
              />
              <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-2 py-1.5 text-left">
                <span className="block text-[11px] font-medium text-white">
                  {photo.uploaderName}
                </span>
                {photo.takenAt && (
                  <span className="block text-[10px] text-white/75">
                    {new Date(photo.takenAt).toLocaleDateString("ko-KR")}
                  </span>
                )}
              </span>
            </button>
          </li>
        ))}
      </ul>

      <PhotoLightbox photos={photos} openIndex={openIndex} onChangeIndex={setOpenIndex} />
    </>
  );
}
