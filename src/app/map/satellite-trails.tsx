"use client";

import { useEffect, useState } from "react";
import { ControlPosition, MapControl, Polyline, useMap } from "@vis.gl/react-google-maps";
import { loadSatelliteTrails } from "./route-actions";
import type { TrailSegment } from "@/lib/routes/trails";

/** Surveyed trail geometry stays readable when the imagery reaches its limit. */
export function SatelliteTrails() {
  const map = useMap();
  const [visible, setVisible] = useState(false);
  const [segments, setSegments] = useState<TrailSegment[]>([]);

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
      if (!satellite) { setSegments([]); return; }
      if ((map.getZoom() ?? 0) < 14) {
        setSegments([]); return;
      }
      timer = setTimeout(async () => {
        const bounds = map.getBounds()?.toJSON();
        if (!bounds) return;
        const key = Object.values(bounds).map((n) => n.toFixed(3)).join(":");
        const saved = cache.get(key);
        if (saved) { setSegments(saved); return; }
        try {
          const trails = await loadSatelliteTrails(bounds);
          if (!alive || sequence !== request) return;
          if (cache.size >= 12) cache.delete(cache.keys().next().value!);
          const paths = trails.filter((trail) => /^(path|footway|track|steps)$/.test(trail.kind));
          if (trails.length) cache.set(key, paths);
          setSegments(paths);
        } catch {
          // The next pan asks again, which is the retry the panel used to ask
          // the reader to perform.
        }
      }, 500);
    };
    const idle = map.addListener("idle", refresh);
    const type = map.addListener("maptypeid_changed", refresh);
    refresh();
    return () => { alive = false; clearTimeout(timer); idle.remove(); type.remove(); };
  }, [map]);

  if (!visible) return null;
  return <>
    {/* Only the credit OpenStreetMap's licence requires, on one line in the
        column where the trail layer's own credit sits, so the two never stack.

        This was a panel: a checkbox to turn the overlay off, a running status
        line, and the credit under it, stacked over the map in the top-left. It
        described work nobody had asked to watch - "등산로 불러오는 중…",
        "불러오지 못했습니다. 지도를 움직여 다시 시도하세요" - and the next
        pan fixes that without being told. The lines are either there or they
        are not, and the map shows which. */}
    <MapControl position={ControlPosition.LEFT_TOP}>
      <span className="m-2 whitespace-nowrap rounded bg-white/80 px-1.5 py-0.5 text-[9px] leading-tight text-neutral-500 shadow-sm">
        <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a> · 공공 등산로 자료
      </span>
    </MapControl>
    {segments.map((segment) => <Polyline key={segment.id}
      path={segment.points.map(([lat, lng]) => ({ lat, lng }))}
      strokeColor="#FDE047" strokeWeight={2} strokeOpacity={0.55} zIndex={1} clickable={false} />)}
  </>;
}
