import { createClient } from "@/lib/supabase/server";
import { MapLoader, type MapLocation } from "./map-loader";

interface LocationRow {
  id: string;
  name: string;
  region: string | null;
  elevation: number | null;
  lat: number;
  lng: number;
  hikes: { id: string; title: string; date: string }[];
  // PostgREST returns aggregates on a to-many embed as [{ count: n }].
  photos: { count: number }[];
}

export default async function MapPage() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("locations")
    .select("id, name, region, elevation, lat, lng, hikes(id, title, date), photos(count)")
    .not("lat", "is", null)
    .not("lng", "is", null)
    .order("name");
  if (error) throw error;

  const locations: MapLocation[] = (data as unknown as LocationRow[]).map((row) => ({
    id: row.id,
    name: row.name,
    region: row.region,
    elevation: row.elevation,
    lat: row.lat,
    lng: row.lng,
    photoCount: row.photos?.[0]?.count ?? 0,
    hikes: [...(row.hikes ?? [])].sort((a, b) => b.date.localeCompare(a.date)),
  }));

  return (
    <main className="flex h-screen flex-col">
      <header className="border-b border-neutral-200 px-4 py-3">
        <h1 className="text-lg font-semibold">산행 지도</h1>
        <p className="text-sm text-neutral-500">
          등록된 장소 {locations.length}곳 · 마커를 누르면 그 장소의 산행 목록이 나옵니다.
        </p>
      </header>
      <div className="min-h-0 flex-1">
        <MapLoader locations={locations} />
      </div>
    </main>
  );
}
