"use client";

import { useEffect, useState } from "react";
import { ControlPosition, MapControl, Polyline, useMap } from "@vis.gl/react-google-maps";
import { loadSatelliteTrails } from "./route-actions";
import type { TrailSegment } from "@/lib/routes/trails";

/** Surveyed trail geometry stays readable when the imagery reaches its limit. */
export function SatelliteTrails() {
  const map = useMap();
  const [visible, setVisible] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [segments, setSegments] = useState<TrailSegment[]>([]);
  const [status, setStatus] = useState("");

  useEffect(() => {
    if (!map) return;
    let alive = true;
    let sequence = 0;
    let timer: ReturnType<typeof setTimeout>;
    const cache = new Map<string, TrailSegment[]>();
    const refresh = () => {
      clearTimeout(timer);
      const request = ++sequence;
      const satellite = map.getMapTypeId() === "hybrid" || map.getMapTypeId() === "satellite";
      setVisible(satellite);
      if (!satellite || !enabled) { setSegments([]); return; }
      if ((map.getZoom() ?? 0) < 14) {
        setSegments([]); setStatus("확대하면 등산로가 표시됩니다"); return;
      }
      timer = setTimeout(async () => {
        const bounds = map.getBounds()?.toJSON();
        if (!bounds) return;
        const key = Object.values(bounds).map((n) => n.toFixed(3)).join(":");
        const saved = cache.get(key);
        if (saved) { setSegments(saved); setStatus(saved.length ? "" : "이 영역의 등산로 자료가 없습니다"); return; }
        setStatus("등산로 불러오는 중…");
        try {
          const trails = await loadSatelliteTrails(bounds);
          if (!alive || sequence !== request) return;
          if (cache.size >= 12) cache.delete(cache.keys().next().value!);
          const paths = trails.filter((trail) => /^(path|footway|track|steps)$/.test(trail.kind));
          if (trails.length) cache.set(key, paths);
          setSegments(paths);
          setStatus(trails.length ? "" : "이 영역의 등산로 자료를 불러오지 못했습니다");
        } catch {
          if (!alive || sequence !== request) return;
          setStatus("등산로를 불러오지 못했습니다. 지도를 움직여 다시 시도하세요");
        }
      }, 500);
    };
    const idle = map.addListener("idle", refresh);
    const type = map.addListener("maptypeid_changed", refresh);
    refresh();
    return () => { alive = false; clearTimeout(timer); idle.remove(); type.remove(); };
  }, [map, enabled]);

  if (!visible) return null;
  return <>
    <MapControl position={ControlPosition.LEFT_TOP}>
      <div className="mx-2 rounded bg-white/95 px-2 py-1 text-[11px] shadow-sm">
        <label className="flex items-center gap-2"><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />등산로 겹쳐 보기</label>
        {enabled && <>
          <p className="text-neutral-600" role="status">{status}</p>
          <p className="text-[9px] text-neutral-500"><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a> · 공공 등산로 자료</p>
        </>}
      </div>
    </MapControl>
    {enabled && segments.map((segment) => <Polyline key={segment.id}
      path={segment.points.map(([lat, lng]) => ({ lat, lng }))}
      strokeColor="#FDE047" strokeWeight={3} strokeOpacity={0.9} zIndex={1} clickable={false} />)}
  </>;
}
