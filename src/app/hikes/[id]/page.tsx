import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { UNKNOWN_MEMBER_NAME, memberDirectory } from "@/lib/supabase/member-names";
import { HikeGallery, type GalleryPhoto } from "./gallery";

interface HikeRow {
  id: string;
  title: string;
  date: string;
  description: string | null;
  location: { name: string; region: string | null; elevation: number | null } | null;
  photos: {
    id: string;
    storage_key_original: string;
    taken_at: string | null;
    uploader_id: string | null;
  }[];
}

export default async function HikePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("hikes")
    .select(
      "id, title, date, description, location:locations!location_id(name, region, elevation), photos(id, storage_key_original, taken_at, uploader_id)",
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) notFound();

  const hike = data as unknown as HikeRow;
  const names = await memberDirectory(supabase, hike.photos.map((p) => p.uploader_id));
  const photos: GalleryPhoto[] = [...hike.photos]
    .sort((a, b) => (a.taken_at ?? "").localeCompare(b.taken_at ?? ""))
    .map((p) => ({
      id: p.id,
      storageKey: p.storage_key_original,
      takenAt: p.taken_at,
      uploaderName:
        (p.uploader_id ? names.get(p.uploader_id)?.name : null) ?? UNKNOWN_MEMBER_NAME,
    }));

  const locationLine = hike.location
    ? [hike.location.name, hike.location.region, hike.location.elevation ? `${hike.location.elevation}m` : null]
        .filter(Boolean)
        .join(" · ")
    : "장소 미지정";

  return (
    <main className="mx-auto max-w-5xl px-4 pb-[calc(2.5rem+env(safe-area-inset-bottom))] pt-[calc(2.5rem+env(safe-area-inset-top))]">
      <Link href="/map" className="inline-block py-1 text-sm text-neutral-500 underline">
        ← 지도로
      </Link>

      <header className="mt-4 border-b border-neutral-200 pb-5">
        <h1 className="text-2xl font-semibold">{hike.title}</h1>
        <p className="mt-1 text-sm text-neutral-600">
          {new Date(hike.date).toLocaleDateString("ko-KR")} · {locationLine}
        </p>
        {hike.description && (
          <p className="mt-3 text-sm text-neutral-700">{hike.description}</p>
        )}
      </header>

      <div className="mt-6 flex items-baseline justify-between">
        <h2 className="text-base font-semibold">사진</h2>
        <span className="text-sm text-neutral-500">{photos.length}장</span>
      </div>

      {photos.length === 0 ? (
        <p className="mt-8 text-center text-sm text-neutral-500">
          아직 올라온 사진이 없습니다.{" "}
          <Link href="/photos/upload" className="underline">
            사진 업로드
          </Link>
        </p>
      ) : (
        <HikeGallery photos={photos} />
      )}
    </main>
  );
}
