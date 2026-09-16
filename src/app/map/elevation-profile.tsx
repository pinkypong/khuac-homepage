"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { gradientBands, stackLabels, type Steepness } from "@/lib/routes/elevation";
import type { CourseElevation } from "./elevation-actions";

/**
 * The scale the national park signs its trails with, in its own order.
 *
 * Green, blue, yellow, red, black, the way park boards and ski runs both go, so
 * a member who has read one of those signs already knows what the chart means
 * without being taught. At full strength, because these are worn as a signal
 * rather than as decoration and a muted red is not a warning.
 *
 * Graded on the size of the gradient rather than its direction: a 30% descent
 * is not easy for being downhill.
 */
const GRADE: Record<Steepness, { line: string; text: string; label: string }> = {
  flat: { line: "#059669", text: "text-[#059669]", label: "평탄" },
  gentle: { line: "#2563EB", text: "text-[#2563EB]", label: "완만" },
  moderate: { line: "#EAB308", text: "text-[#A16207]", label: "보통" },
  steep: { line: "#EF4444", text: "text-[#DC2626]", label: "가파름" },
  severe: { line: "#202320", text: "text-[#202320]", label: "매우 가파름" },
};

const ORDER: Steepness[] = ["flat", "gentle", "moderate", "steep", "severe"];

/** The silhouette under the line: the hill, not the difficulty. Warm stone,
    because the club's greys are warm and a slate hill sat blue on paper. */
const GROUND = "#A8A89C";

const WIDTH = 1000;
/** Drawn at this height and scaled to whatever the member has dragged it to. */
const VIEW_HEIGHT = 128;
/** Each row of names, in pixels. */
const LABEL_ROW = 24;

const DEFAULT_HEIGHT = 80;
const MIN_HEIGHT = 44;
const MAX_HEIGHT = 240;
/** Below this the legend is more crowding than help. */
const LEGEND_FROM = 64;
const STORED_HEIGHT = "khuac:profile-height";

/**
 * The course seen side-on, the way the park draws it.
 *
 * A card saying "약 7.1km, 약 4시간" does not say whether that is a walk or a
 * ladder. This does, and it says where: the line is coloured by how steep the
 * ground under it is, and the names along the bottom are the ones the course is
 * described by, so "the long steep bit" has a name to plan around.
 *
 * The colour is on the line rather than on the area beneath it. Filling the
 * whole silhouette put the loudest thing on the screen underneath the map and
 * left nothing quiet for the eye to rest on, and it fails as the chart gets
 * smaller - a block of red at forty pixels tall is a smear, while a line stays
 * a line. The silhouette is still drawn, in one neutral, because the shape of
 * the hill is the context that makes the colours mean anything.
 *
 * Drawn from a 90m elevation model, which is coarse enough that the curve is
 * the shape of the hill rather than a survey of it. Nothing here is offered to
 * the metre.
 */
export function ElevationProfile({ data }: { data: CourseElevation }) {
  const { profile, sections, waypointAlong, names } = data;
  const [height, setHeight] = useState(DEFAULT_HEIGHT);
  // State rather than only a ref: a ref does not re-render, so the effect that
  // listens for the drag would never run and the handle would not move.
  const [dragging, setDragging] = useState(false);
  const grabbed = useRef<{ from: number; at: number }>({ from: 0, at: DEFAULT_HEIGHT });

  // Remembered per browser, because the right size depends on the screen it is
  // being read on and nobody wants to set it twice.
  useEffect(() => {
    try {
      const saved = Number(window.localStorage.getItem(STORED_HEIGHT));
      if (Number.isFinite(saved) && saved >= MIN_HEIGHT && saved <= MAX_HEIGHT) setHeight(saved);
    } catch {
      // Private browsing refuses storage; the default is a fine answer.
    }
  }, []);

  const resize = useCallback((next: number) => {
    const clamped = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Math.round(next)));
    setHeight(clamped);
    try {
      window.localStorage.setItem(STORED_HEIGHT, String(clamped));
    } catch {
      // As above.
    }
  }, []);

  useEffect(() => {
    if (!dragging) return;
    // Dragging down gives the height to the map above, which takes whatever is
    // left; dragging up gives it back to the chart.
    const move = (event: PointerEvent) => {
      event.preventDefault();
      resize(grabbed.current.at - (event.clientY - grabbed.current.from));
    };
    const stop = () => setDragging(false);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
  }, [dragging, resize]);

  const geometry = useMemo(() => {
    const { points, distanceM, lowM, highM } = profile;
    if (points.length < 2 || distanceM <= 0) return null;
    // A little headroom above and below so the curve never touches the frame,
    // and a floor of 50m of range so a flat course is not drawn as a mountain.
    const span = Math.max(highM - lowM, 50);
    const base = lowM - span * 0.06;
    const top = highM + span * 0.22;

    const x = (along: number) => (along / distanceM) * WIDTH;
    const y = (elevation: number) => VIEW_HEIGHT - ((elevation - base) / (top - base)) * VIEW_HEIGHT;
    const at = (point: { along: number; elevation: number }) =>
      `${x(point.along).toFixed(1)} ${y(point.elevation).toFixed(1)}`;

    const ground = [
      `M ${x(0).toFixed(1)} ${VIEW_HEIGHT}`,
      ...points.map((point) => `L ${at(point)}`),
      `L ${x(distanceM).toFixed(1)} ${VIEW_HEIGHT}`,
      "Z",
    ].join(" ");

    // One stroke per stretch of a single difficulty. Neighbouring stretches
    // share the point between them, so the line is continuous across a change
    // of colour rather than broken at every one.
    const bands = gradientBands(profile)
      .map((band, i) => {
        const within = points.filter(
          (point) => point.along >= band.fromAlong - 1 && point.along <= band.toAlong + 1);
        if (within.length < 2) return null;
        return {
          key: `${i}-${band.steepness}`,
          steepness: band.steepness,
          path: within.map((point, k) => `${k === 0 ? "M" : "L"} ${at(point)}`).join(" "),
        };
      })
      .filter((band): band is { key: string; steepness: Steepness; path: string } => band !== null);

    return { ground, bands, x, seen: new Set(bands.map((band) => band.steepness)) };
  }, [profile]);

  // Which row each name sits on. 백운대 and 백운봉암문 are 340m apart on a
  // 5.8km course, and side by side on one line they overlapped and were cut
  // off, which left two names on the chart that could not be read.
  const rows = useMemo(
    () => stackLabels(waypointAlong.map((along) => along / Math.max(profile.distanceM, 1))),
    [waypointAlong, profile.distanceM],
  );

  if (!geometry) return null;

  const km = (metres: number) => (metres / 1000).toFixed(metres < 1000 ? 2 : 1);
  const hardest = sections
    .filter((section) => !section.downhill)
    .sort((a, b) => b.ascentM - a.ascentM)[0];
  const used = ORDER.filter((step) => geometry.seen.has(step));
  const tallest = Math.max(0, ...rows.filter((row): row is number => row !== null));

  return (
    <section aria-label="코스 고도 단면" className="bg-white">
      {/* The same grab strip as the divider between the map and the album, in
          the other direction. Dragging it down hands the height to the map,
          which takes whatever this leaves. */}
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label="고도 그래프 높이 조절"
        tabIndex={0}
        onPointerDown={(event) => {
          grabbed.current = { from: event.clientY, at: height };
          setDragging(true);
        }}
        onKeyDown={(event) => {
          if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
          event.preventDefault();
          resize(height + (event.key === "ArrowUp" ? 16 : -16));
        }}
        className={"h-1.5 w-full touch-none cursor-row-resize border-t border-club-line transition-colors "
          + (dragging ? "bg-club-faint" : "bg-club-sunken hover:bg-club-line")}
      />

      <div className="px-3 pb-2 pt-1.5">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-[11px] text-club-muted">
          <span className="font-medium text-club-ink">{km(profile.distanceM)}km</span>
          <span>
            상승 <strong className="font-medium text-club-ink">{Math.round(profile.ascentM)}m</strong>
            {" · "}
            하강 <strong className="font-medium text-club-ink">{Math.round(profile.descentM)}m</strong>
          </span>
          <span>최고 {Math.round(profile.highM)}m</span>
          {/* The colour belongs on the line. A red sentence here was the loudest
              thing on the panel and said what the red stretch already says, so
              only a short rule of it is kept, to tie the two together. */}
          {hardest && hardest.steepness !== "flat" && (
            <span className="inline-flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="inline-block h-[3px] w-3.5 shrink-0 rounded-full"
                style={{ backgroundColor: GRADE[hardest.steepness].line }}
              />
              <span>
                가장 힘든 곳{" "}
                <strong className="font-medium text-club-ink">{hardest.from} → {hardest.to}</strong>
                {" "}{km(hardest.distanceM)}km · 평균 {Math.round(hardest.gradient * 100)}%
              </span>
            </span>
          )}
        </div>

        <svg
          viewBox={`0 0 ${WIDTH} ${VIEW_HEIGHT}`}
          preserveAspectRatio="none"
          style={{ height }}
          className="mt-1 w-full"
          role="img"
          aria-label={`${km(profile.distanceM)}킬로미터, 누적 상승 ${Math.round(profile.ascentM)}미터`}
        >
          <path d={geometry.ground} fill={GROUND} fillOpacity={0.3} />
          {waypointAlong.map((along, i) => (
            <line
              key={`tick-${i}`}
              x1={geometry.x(along)}
              x2={geometry.x(along)}
              y1={0}
              y2={VIEW_HEIGHT}
              stroke="#202320"
              strokeOpacity={rows[i] === null ? 0.07 : 0.16}
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {geometry.bands.map((band) => (
            <path
              key={band.key}
              d={band.path}
              fill="none"
              stroke={GRADE[band.steepness].line}
              strokeWidth={3}
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </svg>

        {/* The names are HTML rather than SVG text: the chart is stretched to
            the pane's width with preserveAspectRatio="none", which would
            stretch lettering with it. Each is centred on its own tick and
            dropped onto whichever row is clear there, with a hairline back up
            to the tick so a name on the second row is still attached to the
            point it belongs to. */}
        <div className="relative" style={{ height: (tallest + 1) * LABEL_ROW }}>
          {waypointAlong.map((along, i) => {
            const row = rows[i];
            if (row === null) return null;
            const share = (along / Math.max(profile.distanceM, 1)) * 100;
          const left = `${share}%`;
          // A name centred on a point at the very edge hangs half outside the
          // box and is clipped - 백운탐방지원센터 read as 탐방지원센터. The two
          // ends turn inward instead, which is also where a reader looks for
          // where a course starts and where it comes out.
          const end = share < 6 ? "start" : share > 94 ? "end" : "middle";
          const place = end === "start" ? { left: 0 }
            : end === "end" ? { right: 0 }
              : { left, transform: "translateX(-50%)" };
            return (
              <span key={`label-${i}`}>
                {row > 0 && (
                  <span
                    aria-hidden="true"
                    className="absolute top-0 w-px bg-club-line"
                    style={{ left, height: row * LABEL_ROW }}
                  />
                )}
                <span
                  className={
                    "absolute max-w-[8rem] truncate text-[11px] leading-tight text-club-muted "
                    + (end === "start" ? "text-left" : end === "end" ? "text-right" : "text-center")
                  }
                  style={{ ...place, top: row * LABEL_ROW }}
                  title={names[i]}
                >
                  {names[i]}
                  <br />
                  <span className="text-club-faint">{km(along)}km</span>
                </span>
              </span>
            );
          })}
        </div>

        {used.length > 1 && height >= LEGEND_FROM && (
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 border-t border-club-line pt-1.5 text-[11px] text-club-muted">
            {used.map((step) => (
              <span key={step} className="inline-flex items-center gap-1">
                <span
                  aria-hidden="true"
                  className="inline-block h-0.5 w-3.5 rounded-full"
                  style={{ backgroundColor: GRADE[step].line }}
                />
                {GRADE[step].label}
              </span>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
