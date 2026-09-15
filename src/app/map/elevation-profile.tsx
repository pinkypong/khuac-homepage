"use client";

import { useMemo } from "react";
import type { CourseElevation } from "./elevation-actions";

/** The drawn course's own violet, so the picture and the line read as one thing. */
const LINE = "#6B21A8";
/** Where the work is. Warm against the violet, and used nowhere else on the map. */
const STEEP = "#B45309";

const HEIGHT = 128;
/** Room under the curve for the tick labels, inside the same viewBox. */
const LABELS = 26;
const WIDTH = 1000;

/** The most names that fit along the bottom before they start touching. */
const MAX_LABELS = 6;

function thinLabels(count: number): Set<number> {
  if (count <= MAX_LABELS) return new Set(Array.from({ length: count }, (_, i) => i));
  const step = (count - 1) / (MAX_LABELS - 1);
  const kept = new Set<number>();
  for (let i = 0; i < MAX_LABELS; i++) kept.add(Math.round(i * step));
  kept.add(0);
  kept.add(count - 1);
  return kept;
}

/**
 * The course seen side-on: height against distance, the way the park draws it.
 *
 * A card saying "약 7.1km, 약 4시간" does not say whether that is a walk or a
 * ladder. This does, and it says where: the stretches that climb hardest are
 * drawn in a colour the rest of the map does not use, and the names underneath
 * are the same ones the course is described by, so "the long steep bit" has a
 * name a member can plan around.
 *
 * Drawn from a 90m elevation model, which is coarse enough that the curve is
 * the shape of the hill rather than a survey of it. Nothing here is offered to
 * the metre.
 */
export function ElevationProfile({ data }: { data: CourseElevation }) {
  const { profile, sections, waypointAlong, names } = data;

  const geometry = useMemo(() => {
    const { points, distanceM, lowM, highM } = profile;
    if (points.length < 2 || distanceM <= 0) return null;
    // A little headroom above and below so the curve never touches the frame,
    // and a floor of 50m of range so a flat course is not drawn as a mountain.
    const span = Math.max(highM - lowM, 50);
    const base = lowM - span * 0.08;
    const top = highM + span * 0.12;

    const x = (along: number) => (along / distanceM) * WIDTH;
    const y = (elevation: number) => HEIGHT - ((elevation - base) / (top - base)) * HEIGHT;

    const area = [
      `M ${x(points[0].along).toFixed(1)} ${HEIGHT}`,
      ...points.map((point) => `L ${x(point.along).toFixed(1)} ${y(point.elevation).toFixed(1)}`),
      `L ${x(points[points.length - 1].along).toFixed(1)} ${HEIGHT}`,
      "Z",
    ].join(" ");
    const ridge = points
      .map((point, i) => `${i === 0 ? "M" : "L"} ${x(point.along).toFixed(1)} ${y(point.elevation).toFixed(1)}`)
      .join(" ");

    // One band per steep stretch, so the hard parts are visible as area rather
    // than as a word in a list underneath.
    const hard = sections
      .filter((section) => section.steepness === "steep" && !section.downhill)
      .map((section) => {
        const within = points.filter(
          (point) => point.along >= section.fromAlong && point.along <= section.toAlong);
        if (within.length < 2) return null;
        return {
          key: `${section.from}-${section.to}`,
          path: [
            `M ${x(within[0].along).toFixed(1)} ${HEIGHT}`,
            ...within.map((point) => `L ${x(point.along).toFixed(1)} ${y(point.elevation).toFixed(1)}`),
            `L ${x(within[within.length - 1].along).toFixed(1)} ${HEIGHT}`,
            "Z",
          ].join(" "),
        };
      })
      .filter((band): band is { key: string; path: string } => band !== null);

    return { area, ridge, hard, x, y, base, top };
  }, [profile, sections]);

  if (!geometry) return null;

  const shown = thinLabels(names.length);
  const km = (metres: number) => (metres / 1000).toFixed(metres < 1000 ? 2 : 1);
  const hardest = sections
    .filter((section) => !section.downhill)
    .sort((a, b) => b.ascentM - a.ascentM)[0];

  return (
    <section
      aria-label="코스 고도 단면"
      className="border-t border-neutral-200 bg-white px-3 pb-2 pt-2"
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-[11px] text-neutral-600">
        <span className="font-medium text-neutral-900">{km(profile.distanceM)}km</span>
        <span>
          상승 <strong className="font-medium text-neutral-800">{Math.round(profile.ascentM)}m</strong>
          {" · "}
          하강 <strong className="font-medium text-neutral-800">{Math.round(profile.descentM)}m</strong>
        </span>
        <span>최고 {Math.round(profile.highM)}m</span>
        {hardest && hardest.steepness !== "flat" && (
          <span className="text-[#B45309]">
            가장 힘든 구간 {hardest.from} → {hardest.to} ({km(hardest.distanceM)}km,
            평균 {Math.round(hardest.gradient * 100)}%)
          </span>
        )}
      </div>

      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT + LABELS}`}
        preserveAspectRatio="none"
        className="mt-1 h-[104px] w-full"
        role="img"
        aria-label={`${km(profile.distanceM)}킬로미터, 누적 상승 ${Math.round(profile.ascentM)}미터`}
      >
        <path d={geometry.area} fill={LINE} fillOpacity={0.14} />
        {geometry.hard.map((band) => (
          <path key={band.key} d={band.path} fill={STEEP} fillOpacity={0.3} />
        ))}
        <path d={geometry.ridge} fill="none" stroke={LINE} strokeWidth={2.5} vectorEffect="non-scaling-stroke" />

        {waypointAlong.map((along, i) => {
          const at = geometry.x(along);
          return (
            <line
              key={`tick-${i}`}
              x1={at}
              x2={at}
              y1={0}
              y2={HEIGHT}
              stroke="#111"
              strokeOpacity={shown.has(i) ? 0.22 : 0.08}
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          );
        })}
      </svg>

      {/* The names are HTML rather than SVG text: the chart is stretched to the
          pane's width with preserveAspectRatio="none", which would stretch
          lettering with it. Positioned on the same scale so each still stands
          under its own tick. */}
      <div className="relative h-8">
        {waypointAlong.map((along, i) =>
          shown.has(i) ? (
            <span
              key={`label-${i}`}
              className="absolute top-0 max-w-[7.5rem] -translate-x-1/2 truncate text-[10px] leading-tight text-neutral-600"
              style={{
                left: `${Math.min(97, Math.max(3, (along / profile.distanceM) * 100))}%`,
                textAlign: "center",
              }}
              title={names[i]}
            >
              {names[i]}
              <br />
              <span className="text-neutral-400">{km(along)}km</span>
            </span>
          ) : null,
        )}
      </div>
    </section>
  );
}
