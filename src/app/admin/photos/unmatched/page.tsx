import { createClient } from "@/lib/supabase/server";
import { getThumbnailUrl } from "@/lib/images/url";
import { matchExistingLocation, createLocationAndMatch } from "./actions";

interface UnmatchedPhotoRow {
  id: string;
  storage_key_original: string;
  exif_lat: number | null;
  exif_lng: number | null;
  created_at: string;
}

interface LocationOption {
  id: string;
  name: string;
}

export default async function UnmatchedPhotosPage() {
  const supabase = await createClient();

  const { data: photosData, error } = await supabase
    .from("photos")
    .select("id, storage_key_original, exif_lat, exif_lng, created_at")
    .eq("location_match_status", "manual_pending")
    .order("created_at", { ascending: true });
  if (error) throw error;
  const photos = photosData as unknown as UnmatchedPhotoRow[];

  const { data: locationsData } = await supabase.from("locations").select("id, name").order("name");
  const locations = (locationsData ?? []) as LocationOption[];

  return (
    <main className="mx-auto max-w-4xl px-4 py-8 md:py-10">
      <h1 className="mb-2 text-xl font-semibold">위치 매칭 대기 사진</h1>
      <p className="mb-6 text-sm text-neutral-500">
        EXIF GPS로 자동 매칭되지 않았거나, GPS 자체가 없고 산행에도 위치가 없는 사진입니다.
        기존 장소에 연결하거나 새 장소로 등록해주세요.
      </p>

      {photos.length === 0 ? (
        <p className="text-sm text-neutral-500">대기 중인 사진이 없습니다.</p>
      ) : (
        <ul className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          {photos.map((photo) => (
            <li key={photo.id} className="rounded border border-neutral-200 p-3">
              {/* Plain <img>, not next/image: remotePatterns/loader config is Phase 5 scope. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={getThumbnailUrl(photo.storage_key_original)}
                alt=""
                className="mb-3 aspect-video w-full rounded object-cover"
              />
              <p className="mb-2 text-xs text-neutral-400">
                {photo.exif_lat != null && photo.exif_lng != null
                  ? `EXIF 좌표: ${photo.exif_lat.toFixed(5)}, ${photo.exif_lng.toFixed(5)}`
                  : "EXIF 좌표 없음"}
              </p>

              <form
                action={matchExistingLocation.bind(null, photo.id)}
                className="mb-2 flex gap-2"
              >
                <select
                  name="locationId"
                  required
                  defaultValue=""
                  className="flex-1 rounded border border-neutral-300 px-2 py-1 text-sm"
                >
                  <option value="" disabled>
                    기존 장소 선택
                  </option>
                  {locations.map((loc) => (
                    <option key={loc.id} value={loc.id}>
                      {loc.name}
                    </option>
                  ))}
                </select>
                <button
                  type="submit"
                  className="rounded bg-neutral-900 px-3 py-1 text-sm text-white"
                >
                  연결
                </button>
              </form>

              <details>
                <summary className="cursor-pointer text-sm text-neutral-500">
                  새 장소로 등록
                </summary>
                <form
                  action={createLocationAndMatch.bind(null, photo.id)}
                  className="mt-2 flex flex-col gap-2"
                >
                  <input
                    name="name"
                    required
                    placeholder="장소 이름"
                    className="rounded border border-neutral-300 px-2 py-1 text-sm"
                  />
                  <div className="flex gap-2">
                    <input
                      name="lat"
                      type="number"
                      step="any"
                      defaultValue={photo.exif_lat ?? ""}
                      placeholder="위도"
                      className="w-1/2 rounded border border-neutral-300 px-2 py-1 text-sm"
                    />
                    <input
                      name="lng"
                      type="number"
                      step="any"
                      defaultValue={photo.exif_lng ?? ""}
                      placeholder="경도"
                      className="w-1/2 rounded border border-neutral-300 px-2 py-1 text-sm"
                    />
                  </div>
                  <button
                    type="submit"
                    className="self-start rounded border border-neutral-300 px-3 py-1 text-sm"
                  >
                    장소 만들고 연결
                  </button>
                </form>
              </details>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
