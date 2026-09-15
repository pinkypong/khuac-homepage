"use client";

import { useMemo } from "react";
import { gradientBands, stackLabels, type Steepness } from "@/lib/routes/elevation";
import type { CourseElevation } from "./elevation-actions";

/**
 * The scale the national park signs its trails with, in its own order.
 *
 * Green, blue, yellow, red, black, the way park boards and ski runs both go, so
 * a member who has read one of those signs already knows what the chart means
 * without being taught. Graded on the size of the gradient rather than its
 * direction: a 30% descent is not easy for being downhill.
 */
const GRADE: Record<Steepness, { fill: string; text: string; label: string }> = {
  flat: { fill: "#0F766E", text: "text-[#0F766E]", label: "평탄" },
  gentle: { fill: "#2563EB", text: "text-[#2563EB]", label: "완만" },
  moderate: { fill: "#CA8A04", text: "text-[#CA8A04]", label: "보통" },
  steep: { fill: "#DC2626", text: "text-[#DC2626]", label: "가파름" },
  severe: { fill: "#1F2937", text: "text-[#1F2937]", label: "매우 가파름" },
};

const ORDER: Steepness[] = ["flat", "gentle", "moderate", "steep", "severe"];

const HEIGHT = 128;
const WIDTH = 1000;
/** Each row of names, in pixels. */
const LABEL_ROW = 24;

/**
 * The course seen side-on, the way the park draws it.
 *
 * A card saying "약 7.1km, 약 4시간" does not say whether that is a walk or a
 * ladder. This does, and it says where: the ground under the line is coloured
 * by how steep it is, and the names along the bottom are the ones the course is
 * described by, so "the long steep bit" has a name to plan around.
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

    const ridge = points
      .map((point, i) => `${i === 0 ? "M" : "L"} ${x(point.along).toFixed(1)} ${y(point.elevation).toFixed(1)}`)
      .join(" ");

    // One filled shape per stretch of a single difficulty. Each takes a metre
    // of its neighbours at the join so the bands meet rather than leaving a
    // hairline of background between them.
    const bands = gradientBands(profile)
      .map((band, i) => {
        const within = points.filter(
          (point) => point.along >= band.fromAlong - 1 && point.along <= band.toAlong + 1);
        if (within.length < 2) return null;
        return {
          key: `${i}-${band.steepness}`,
          steepness: band.steepness,
          path: [
            `M ${x(within[0].along).toFixed(1)} ${HEIGHT}`,
            ...within.map((point) => `L ${x(point.along).toFixed(1)} ${y(point.elevation).toFixed(1)}`),
            `L ${x(within[within.length - 1].along).toFixed(1)} ${HEIGHT}`,
            "Z",
          ].join(" "),
        };
      })
      .filter((band): band is { key: string; steepness: Steepness; path: string } => band !== null);

    return { ridge, bands, x, seen: new Set(bands.map((band) => band.steepness)) };
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
    <section aria-label="코스 고도 단면" className="border-t border-neutral-200 bg-white px-3 pb-2 pt-2">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-[11px] text-neutral-600">
        <span className="font-medium text-neutral-900">{km(profile.distanceM)}km</span>
        <span>
          상승 <strong className="font-medium text-neutral-800">{Math.round(profile.ascentM)}m</strong>
          {" · "}
          하강 <strong className="font-medium text-neutral-800">{Math.round(profile.descentM)}m</strong>
        </span>
        <span>최고 {Math.round(profile.highM)}m</span>
        {hardest && hardest.steepness !== "flat" && (
          <span className={GRADE[hardest.steepness].text}>
            가장 힘든 구간 {hardest.from} → {hardest.to} ({km(hardest.distanceM)}km,
            평균 {Math.round(hardest.gradient * 100)}%)
          </span>
        )}
      </div>

      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="none"
        className="mt-1 h-[104px] w-full"
        role="img"
        aria-label={`${km(profile.distanceM)}킬로미터, 누적 상승 ${Math.round(profile.ascentM)}미터`}
      >
        {geometry.bands.map((band) => (
          <path key={band.key} d={band.path} fill={GRADE[band.steepness].fill} fillOpacity={0.5} />
        ))}
        <path
          d={geometry.ridge}
          fill="none"
          stroke="#1F2937"
          strokeWidth={1.75}
          strokeOpacity={0.75}
          vectorEffect="non-scaling-stroke"
        />
        {waypointAlong.map((along, i) => (
          <line
            key={`tick-${i}`}
            x1={geometry.x(along)}
            x2={geometry.x(along)}
            y1={0}
            y2={HEIGHT}
            stroke="#111"
            strokeOpacity={rows[i] === null ? 0.08 : 0.24}
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>

      {/* The names are HTML rather than SVG text: the chart is stretched to the
          pane's width with preserveAspectRatio="none", which would stretch
          lettering with it. Each is centred on its own tick and dropped onto
          whichever row is clear there, with a hairline back up to the tick so a
          name on the second row is still attached to the point it belongs to. */}
      <div className="relative" style={{ height: (tallest + 1) * LABEL_ROW }}>
        {waypointAlong.map((along, i) => {
          const row = rows[i];
          if (row === null) return null;
          const left = `${Math.min(99, Math.max(1, (along / Math.max(profile.distanceM, 1)) * 100))}%`;
          return (
            <span key={`label-${i}`}>
              {row > 0 && (
                <span
                  aria-hidden="true"
                  className="absolute top-0 w-px bg-neutral-300"
                  style={{ left, height: row * LABEL_ROW }}
                />
              )}
              <span
                className="absolute max-w-[8rem] -translate-x-1/2 truncate text-center text-[10px] leading-tight text-neutral-600"
                style={{ left, top: row * LABEL_ROW }}
                title={names[i]}
              >
                {names[i]}
                <br />
                <span className="text-neutral-400">{km(along)}km</span>
              </span>
            </span>
          );
        })}
      </div>

      {used.length > 1 && (
        <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[10px] text-neutral-500">
          {used.map((step) => (
            <span key={step} className="inline-flex items-center gap-1">
              <span
                aria-hidden="true"
                className="inline-block h-2 w-3 rounded-[1px]"
                style={{ backgroundColor: GRADE[step].fill, opacity: 0.55 }}
              />
              {GRADE[step].label}
            </span>
          ))}
          <span className="text-neutral-400">· 250m 구간의 평균 경사</span>
        </div>
      )}
    </section>
  );
}
