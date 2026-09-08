"use client";

import dynamic from "next/dynamic";

export interface MapLocation {
  id: string;
  name: string;
  region: string | null;
  elevation: number | null;
  lat: number;
  lng: number;
  photoCount: number;
  hikes: { id: string; title: string; date: string }[];
}

// Referenced literally, not through a helper: Next only inlines NEXT_PUBLIC_*
// vars into the client bundle when it can see the property access statically.
const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
// Advanced markers need a map ID. Google's DEMO_MAP_ID works without any
// dashboard setup; set a real one to use Cloud-based map styling.
const mapId = process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID || "DEMO_MAP_ID";

// ssr: false keeps the Maps SDK (which touches window on load) out of the
// server render. It's only allowed in a client component, which is why this
// wrapper exists between the page and the map itself.
const MapView = dynamic(() => import("./map-view").then((m) => m.MapView), {
  ssr: false,
  loading: () => <p className="p-4 text-sm text-neutral-400">지도를 불러오는 중…</p>,
});

export function MapLoader({ locations }: { locations: MapLocation[] }) {
  if (!apiKey) {
    return (
      <div className="p-4">
        <p className="font-medium">지도를 표시할 수 없습니다</p>
        <p className="mt-1 text-sm text-neutral-600">
          <code>NEXT_PUBLIC_GOOGLE_MAPS_API_KEY</code>가 설정되지 않았습니다. Google Cloud
          Console에서 Maps JavaScript API 키를 발급받아 <code>.env.local</code>에 넣어주세요
          (설정 체크리스트는 README의 &ldquo;지도&rdquo; 항목 참고).
        </p>
      </div>
    );
  }

  if (locations.length === 0) {
    return (
      <p className="p-4 text-sm text-neutral-500">
        좌표가 등록된 장소가 아직 없습니다. 사진을 업로드하고 위치를 매칭하면 여기에 표시됩니다.
      </p>
    );
  }

  return <MapView apiKey={apiKey} mapId={mapId} locations={locations} />;
}
