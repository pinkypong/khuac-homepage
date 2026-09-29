"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { TrackPoint } from "@/lib/gps/track";
import { haversineDistanceMeters } from "@/lib/gps/haversine";
import { bandPathsFor } from "@/lib/routes/band-paths";
import { flattenTrack, formatDistance } from "@/lib/gps/track";
import type { CourseProfile } from "@/lib/routes/elevation";
import { TIER_LABEL, TIER_LINE, TIER_ORDER } from "@/lib/routes/grade-style";
import {
  HAZARD_LABEL,
  hazardsNearRoute,
  isDanger,
  mergeHazards,
  type Hazard,
  type HazardKind,
  type HazardRow,
} from "@/lib/routes/hazards";
import { MARKER_GLYPH, medianElevation, routeEnds, summitOf, type MarkerKind } from "@/lib/routes/route-markers";
import { loadCourseElevation } from "./elevation-actions";

const PLAIN_LINE = "#D23B2E";
const DANGER_PIN = "#DC2626";
const AID_PIN = "#7C3AED";
const START_PIN = "#16A34A";
const END_PIN = "#171717";
const SUMMIT_PIN = "#B45309";

/** How high above the ground each pin floats, with a pole down to the ground. */
const POLE_M = { landmark: 45, danger: 30, aid: 18 } as const;

interface Pin {
  lat: number;
  lng: number;
  kind: MarkerKind;
  background: string;
  scale: number;
  altitude: number;
  /** Required pins are always drawn; the rest give way when they collide. */
  required: boolean;
  zIndex: number;
}

/** A separate, on-demand view of the same coordinates used by the 2D map. */
export function Route3D({
  track,
  title,
  source,
  colourByDifficulty,
  onClose,
}: {
  track: TrackPoint[];
  title: string;
  source: "gpx" | "other";
  /** Whether this viewer may have the line coloured by difficulty. The heights
      come from a member-only action, so anyone else keeps the plain line. */
  colourByDifficulty: boolean;
  onClose: () => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [error, setError] = useState(false);
  // Photorealistic tiles are the slowest thing on this screen, and 3D is the
  // one button whose payoff a member has to wait for. On a phone connection
  // silence reads as a dead button; gmp-steadychange is the API saying the
  // scene has finished drawing.
  const [ready, setReady] = useState(false);

  /**
   * The track this view was opened with, read once.
   *
   * `router.refresh()` - which making an album, uploading a photo and renaming
   * a place all call - hands the shell a fresh `locations`, and so a fresh
   * array for the same album. Keying the build on that array's identity tore
   * the Map3DElement down and built it again for a route that had not changed:
   * a flash, the camera back to its start, and another billed 3D map load.
   *
   * Which route is showing is map-shell's business, and it remounts this
   * component (via `key`) when that changes - so one read is the whole story.
   */
  const opened = useRef(track);
  const points = opened.current;

  // The line is drawn at once in one colour; the heights follow, and the
  // colours arrive when they do. A failed lookup leaves the plain line, which
  // is a complete picture, so it is not an error state.
  const [profile, setProfile] = useState<CourseProfile | null>(null);
  useEffect(() => {
    if (!colourByDifficulty) return;
    let cancelled = false;
    loadCourseElevation(flattenTrack(points))
      .then((found) => {
        if (!cancelled) setProfile(found);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [colourByDifficulty, points]);
  const bands = useMemo(() => bandPathsFor(points, profile), [points, profile]);
  // Park-service records of danger spots and fixed ropes / railings that lie on
  // this route. Public data and a local file, so it is shown to every viewer,
  // and read only once the 3D view is opened so it never weighs on the 2D map.
  const [hazards, setHazards] = useState<Hazard[]>([]);
  useEffect(() => {
    let cancelled = false;
    import("@/lib/routes/hazard-points.json")
      .then((module) => {
        if (!cancelled) setHazards(hazardsNearRoute(points, module.default as unknown as HazardRow[]));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [points]);
  const spots = useMemo(() => mergeHazards(hazards), [hazards]);
  const summit = useMemo(() => summitOf(points, profile), [points, profile]);
  const pins = useMemo<Pin[]>(() => {
    const out: Pin[] = [];
    const landmark = (kind: MarkerKind, at: readonly [number, number], background: string, zIndex: number) =>
      out.push({ lat: at[0], lng: at[1], kind, background, scale: 1.1, altitude: POLE_M.landmark, required: true, zIndex });
    const ends = routeEnds(points);
    if (ends) {
      landmark("start", ends.start, START_PIN, 3);
      if (ends.end) landmark("end", ends.end, END_PIN, 3);
    }
    if (summit) landmark("summit", [summit.lat, summit.lng], SUMMIT_PIN, 4);
    for (const spot of spots) {
      const danger = isDanger(spot.kind);
      out.push({
        lat: spot.lat,
        lng: spot.lng,
        kind: spot.kind,
        background: danger ? DANGER_PIN : AID_PIN,
        scale: danger ? 1 : 0.8,
        altitude: danger ? POLE_M.danger : POLE_M.aid,
        required: danger,
        zIndex: danger ? 2 : 1,
      });
    }
    return out;
  }, [points, summit, spots]);
  const [built, setBuilt] = useState(false);
  const scene = useRef<{ map: google.maps.maps3d.Map3DElement; Polyline3D: typeof google.maps.maps3d.Polyline3DElement } | null>(null);

  const camera = useMemo(() => {
    const lats = points.map((point) => point[0]);
    const lngs = points.map((point) => point[1]);
    const south = Math.min(...lats);
    const north = Math.max(...lats);
    const west = Math.min(...lngs);
    const east = Math.max(...lngs);
    const diagonal = haversineDistanceMeters(
      { lat: south, lng: west },
      { lat: north, lng: east },
    );
    return {
      center: { lat: (south + north) / 2, lng: (west + east) / 2, altitude: 0 },
      // The camera target is at sea level without a separate elevation query.
      // Keep the initial camera well above a mountain even for a short approach;
      // visitors can zoom closer once the terrain has loaded.
      range: Math.max(2500, diagonal * 1.8),
    };
  }, [points]);

  useEffect(() => {
    let disposed = false;
    const host = container.current;
    if (!host) return;

    async function open() {
      try {
        // APIProvider has already loaded Google Maps for the existing 2D map.
        // Loading maps3d here happens only after the visitor presses 3D 보기.
        const { Map3DElement, Polyline3DElement } =
          await google.maps.importLibrary("maps3d");
        if (disposed || !host) return;

        const map = new Map3DElement({
          center: camera.center,
          range: camera.range,
          tilt: 55,
          heading: 0,
          mode: "HYBRID",
          // On a phone this view owns the whole screen, so the cooperative
          // half of AUTO - two fingers before the map will move - is a tax on
          // the only gesture there is to make here. Nothing sits behind it to
          // scroll to: the way out is the 등산로 button.
          gestureHandling: "GREEDY",
        });
        map.addEventListener("gmp-error", () => {
          if (!disposed) setError(true);
        });
        map.addEventListener("gmp-steadychange", (event: Event) => {
          const steady = (event as google.maps.maps3d.SteadyChangeEvent).isSteady;
          if (!disposed && steady) setReady(true);
        });
        map.style.width = "100%";
        map.style.height = "100%";

        host.append(map);
        scene.current = { map, Polyline3D: Polyline3DElement };
        setBuilt(true);
      } catch (cause) {
        console.error("[route-3d] map load failed", cause);
        if (!disposed) setError(true);
      }
    }

    void open();
    return () => {
      disposed = true;
      scene.current = null;
      setBuilt(false);
      host.replaceChildren();
    };
  }, [camera]);

  // Drawn apart from the map so a profile that arrives late recolours the line
  // in place rather than rebuilding the scene - which is a billed load, a flash
  // and the camera back at its start.
  useEffect(() => {
    const current = scene.current;
    if (!built || !current) return;
    const { map, Polyline3D } = current;
    // Ground-relative coordinates let the renderer supply terrain height.
    // The existing track stores lat/lng, so no approximate elevation needs
    // to be written back to the database or interpreted as GPS altitude.
    const lines = (bands ?? [{ tier: null, path: points }]).map((band) => new Polyline3D({
      path: band.path.map(([lat, lng]) => ({ lat, lng })),
      strokeColor: band.tier ? TIER_LINE[band.tier] : PLAIN_LINE,
      strokeWidth: 7,
      outerColor: "#ffffff",
      outerWidth: 0.35,
      altitudeMode: "CLAMP_TO_GROUND",
      // A ridge between the camera and the line would otherwise cut it out.
      drawsOccludedSegments: true,
    }));
    map.append(...lines);
    return () => {
      for (const line of lines) line.remove();
    };
  }, [built, bands, points]);

  // The camera aims at a point at sea level until the heights arrive, which on a
  // mountain is underground. When they do, only the altitude of that point
  // moves - flown to, not rebuilt: rebuilding the element is a billed load.
  const flownTo = useRef<google.maps.maps3d.Map3DElement | null>(null);
  useEffect(() => {
    const current = scene.current;
    const altitude = medianElevation(profile);
    if (!built || !current || altitude === null) return;
    const { map } = current;
    if (flownTo.current === map) return;
    flownTo.current = map;
    const centre = map.center;
    map.flyCameraTo({
      durationMillis: 1500,
      endCamera: {
        center: { lat: centre?.lat ?? camera.center.lat, lng: centre?.lng ?? camera.center.lng, altitude },
        altitudeMode: "ABSOLUTE",
        heading: map.heading ?? 0,
        tilt: map.tilt ?? 55,
        range: map.range ?? camera.range,
      },
    });
  }, [built, profile, camera]);

  // Markers are drawn apart from the line for the same reason the line is drawn
  // apart from the map: the records can arrive after the scene is up.
  useEffect(() => {
    const current = scene.current;
    if (!built || !current || pins.length === 0) return;
    let disposed = false;
    const added: HTMLElement[] = [];
    void (async () => {
      try {
        const { Marker3DElement } = await google.maps.importLibrary("maps3d") as google.maps.MapsLibrary & typeof google.maps.maps3d;
        const { PinElement } = await google.maps.importLibrary("marker") as google.maps.MarkerLibrary;
        if (disposed || scene.current !== current) return;
        for (const pin of pins) {
          // No text on the map: the glyph says what it is and the legend says
          // it once. Floating above the ground on a pole (extruded needs a
          // ground-relative or absolute altitude) is what makes the pin read
          // as standing in the terrain and not stuck to the screen.
          const marker = new Marker3DElement({
            position: { lat: pin.lat, lng: pin.lng, altitude: pin.altitude },
            altitudeMode: "RELATIVE_TO_GROUND",
            extruded: true,
            drawsWhenOccluded: true,
            sizePreserved: true,
            collisionBehavior: pin.required ? "REQUIRED" : "OPTIONAL_AND_HIDES_LOWER_PRIORITY",
            zIndex: pin.zIndex,
          });
          marker.append(new PinElement({
            background: pin.background,
            borderColor: "#ffffff",
            glyphText: MARKER_GLYPH[pin.kind],
            scale: pin.scale,
          }));
          current.map.append(marker);
          added.push(marker);
        }
      } catch (cause) {
        console.error("[route-3d] markers failed", cause);
      }
    })();
    return () => {
      disposed = true;
      for (const marker of added) marker.remove();
    };
  }, [built, pins]);

  const hazardKinds = (Object.keys(HAZARD_LABEL) as HazardKind[])
    .map((kind) => ({ kind, count: spots.filter((spot) => spot.kind === kind).length }))
    .filter((entry) => entry.count > 0);
  const used = bands ? TIER_ORDER.filter((tier) => bands.some((band) => band.tier === tier)) : [];

  return (
    <section className="absolute inset-0 z-20 bg-neutral-100" aria-label={`${title} 3D 경로`}>
      <div ref={container} className="h-full w-full" />
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start justify-between gap-2 p-3">
        <div className="pointer-events-auto max-w-[75%] rounded bg-white/95 px-2 py-2 text-xs text-neutral-900 shadow">
          <div className="mb-2 flex overflow-hidden rounded border border-neutral-300">
            <button type="button" onClick={onClose}
              className="px-3 py-1.5 font-medium text-neutral-700 hover:bg-neutral-50">
              등산로
            </button>
            <span className="border-l border-neutral-300 bg-neutral-900 px-3 py-1.5 font-medium text-white" aria-current="page">3D</span>
          </div>
          <strong className="block truncate">{title}</strong>
          <span>{source === "gpx" ? "GPX 기록" : "지도 경로 · 현장 확인 필요"}</span>
          {/* The surface length, not the flat one: a trail climbs, and the
              distance walked is the hypotenuse of each step, not its shadow on
              the map. */}
          {profile && (
            <span className="block text-neutral-700">
              {formatDistance(profile.surfaceM)} (경사 포함) · 상승 {Math.round(profile.ascentM).toLocaleString("ko-KR")}m
            </span>
          )}
          {(used.length > 0 || pins.length > 0) && (
            <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 border-t border-neutral-200 pt-1.5 text-[11px] text-neutral-700">
              {used.map((tier) => (
                <span key={tier} className="inline-flex items-center gap-1">
                  <span aria-hidden="true" className="inline-block h-1 w-3.5 rounded-full" style={{ backgroundColor: TIER_LINE[tier] }} />
                  {TIER_LABEL[tier]}
                </span>
              ))}
              {pins.some((pin) => pin.kind === "start") && <span>{MARKER_GLYPH.start} 출발</span>}
              {pins.some((pin) => pin.kind === "end") && <span>{MARKER_GLYPH.end} 도착</span>}
              {summit && <span>{MARKER_GLYPH.summit} 최고점 {Math.round(summit.elevation).toLocaleString("ko-KR")}m</span>}
              {hazardKinds.map(({ kind, count }) => (
                <span key={kind}>{MARKER_GLYPH[kind]} {HAZARD_LABEL[kind]} {count}</span>
              ))}
            </div>
          )}
        </div>
      </div>
      {/* Below the controls rather than over them: the way out of a slow load
          is the 등산로 button, so nothing may cover it while this shows. */}
      {!ready && !error && (
        <p aria-live="polite" className="pointer-events-none absolute inset-x-0 bottom-6 z-10 px-6 text-center text-xs text-neutral-700">
          입체 지형을 불러오고 있습니다…
        </p>
      )}
      {error && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-neutral-100 px-6 text-center text-sm text-neutral-800">
          3D 지도를 불러오지 못했습니다. 등산로를 눌러 경로를 확인하세요.
        </div>
      )}
    </section>
  );
}
