/**
 * Renders the elevation profile on its own, so it can be looked at.
 *
 *   node scripts/preview-profile.mts            # writes profile-preview.html
 *
 * The chart lives behind a login, which means it was designed without anyone
 * seeing it - colours picked from a palette file, spacing picked from a number.
 * This puts the real geometry, computed by the real functions, into the same
 * markup the component emits, styled by the stylesheet the preview server is
 * actually serving. What comes out is what a member sees, minus the app around
 * it, and it can be opened or screenshotted.
 *
 * Not a substitute for the real screen, in two ways worth knowing. The DOM is
 * transcribed from the component by hand, so it is only as faithful as that
 * transcription - it shows the chart, not that the chart sits correctly under
 * the map. And the stylesheet is whatever the preview server last built, so a
 * class added since the last `cf:preview` has no rule here and its element
 * renders with no size at all. Rebuild before trusting a small detail.
 */
import { readFileSync, writeFileSync } from "node:fs";
import {
  buildProfile, cellKey, gradientBands, sampleAlongTrack, sectionsOf, stackLabels, waypointsAlong,
  type Steepness,
} from "../src/lib/routes/elevation.ts";
import type { TrackPoint } from "../src/lib/gps/track.ts";

function env(name: string): string {
  const match = readFileSync(".env.local", "utf8").match(new RegExp(`^${name}=(.*)$`, "m"));
  const value = match?.[1]?.trim().replace(/^["']|["']$/g, "");
  if (!value) throw new Error(`${name} is not set in .env.local`);
  return value;
}
const url = env("NEXT_PUBLIC_SUPABASE_URL");
const key = env("SUPABASE_SERVICE_ROLE_KEY");
const headers = { apikey: key, authorization: `Bearer ${key}` };

/** Straight from the component. */
const GRADE: Record<Steepness, { line: string; label: string }> = {
  flat: { line: "#059669", label: "평탄" },
  gentle: { line: "#2563EB", label: "완만" },
  moderate: { line: "#EAB308", label: "보통" },
  steep: { line: "#EF4444", label: "가파름" },
  severe: { line: "#202320", label: "매우 가파름" },
};
const GROUND = "#A8A89C";
const WIDTH = 1000;
const VIEW_HEIGHT = 128;
const LABEL_ROW = 24;
const CHART_HEIGHT = 80;

const [hike] = await (await fetch(
  `${url}/rest/v1/hikes?select=title,track,route_waypoints&track=not.is.null&order=created_at.desc&limit=1`,
  { headers },
)).json() as { title: string; track: TrackPoint[]; route_waypoints: { name: string; lat: number; lng: number }[] }[];

const line = hike.track;
const waypoints = hike.route_waypoints ?? [];
const sampled = sampleAlongTrack(line);
const keys = [...new Set(sampled.map(({ point }) => cellKey(point[0], point[1])))];
const known = new Map<string, number>();
for (let i = 0; i < keys.length; i += 150) {
  const list = keys.slice(i, i + 150).map((k) => `"${k}"`).join(",");
  const rows = await (await fetch(
    `${url}/rest/v1/elevation_cells?select=cell_key,elevation&cell_key=in.(${encodeURIComponent(list)})`,
    { headers },
  )).json() as { cell_key: string; elevation: number }[];
  for (const row of rows) known.set(row.cell_key, row.elevation);
}
const missing = keys.filter((k) => !known.has(k));
if (missing.length) {
  const centres = missing.map((k) => k.split(":").map(Number)).map(([r, c]) => ({ lat: r * 0.0008, lng: c * 0.0008 }));
  const got = await (await fetch("https://api.open-meteo.com/v1/elevation"
    + `?latitude=${centres.map((c) => c.lat.toFixed(5)).join(",")}`
    + `&longitude=${centres.map((c) => c.lng.toFixed(5)).join(",")}`)).json() as { elevation: number[] };
  missing.forEach((k, i) => known.set(k, got.elevation[i]));
}

const heights = sampled.map(({ point }) => known.get(cellKey(point[0], point[1]))!);
const profile = buildProfile(line, sampled, heights)!;
const along = waypointsAlong(line, waypoints);
const names = waypoints.map((w) => w.name);
const sections = sectionsOf(profile, names, along);
const rows = stackLabels(along.map((a) => a / profile.distanceM));

const span = Math.max(profile.highM - profile.lowM, 50);
const base = profile.lowM - span * 0.06;
const top = profile.highM + span * 0.22;
const x = (a: number) => (a / profile.distanceM) * WIDTH;
const y = (e: number) => VIEW_HEIGHT - ((e - base) / (top - base)) * VIEW_HEIGHT;
const at = (p: { along: number; elevation: number }) => `${x(p.along).toFixed(1)} ${y(p.elevation).toFixed(1)}`;

const ground = [`M ${x(0).toFixed(1)} ${VIEW_HEIGHT}`,
  ...profile.points.map((p) => `L ${at(p)}`),
  `L ${x(profile.distanceM).toFixed(1)} ${VIEW_HEIGHT}`, "Z"].join(" ");

const bands = gradientBands(profile).map((band) => {
  const within = profile.points.filter((p) => p.along >= band.fromAlong - 1 && p.along <= band.toAlong + 1);
  return within.length < 2 ? null
    : { steepness: band.steepness, path: within.map((p, k) => `${k === 0 ? "M" : "L"} ${at(p)}`).join(" ") };
}).filter(Boolean) as { steepness: Steepness; path: string }[];

const seen = new Set(bands.map((b) => b.steepness));
const used = (["flat", "gentle", "moderate", "steep", "severe"] as Steepness[]).filter((s) => seen.has(s));
const km = (m: number) => (m / 1000).toFixed(m < 1000 ? 2 : 1);
const hardest = sections.filter((s) => !s.downhill).sort((a, b) => b.ascentM - a.ascentM)[0];
const tallest = Math.max(0, ...rows.filter((r): r is number => r !== null));

// Every stylesheet the page links, not the first. Next splits the CSS, and
// taking one of them got the half without any Tailwind utilities in it - which
// renders as unstyled text and reads exactly like the app being broken.
const sheets = [...new Set((await (await fetch("http://localhost:3100/login")).text())
  .match(/\/_next\/static\/css\/[^"]+\.css/g) ?? [])];
if (sheets.length === 0) throw new Error("3100이 떠 있어야 합니다 (npm run cf:preview)");

const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8">
${sheets.map((sheet) => `<link rel="stylesheet" href="http://localhost:3100${sheet}">`).join("")}
<style>body{margin:0;background:#f5f5f1;font-family:'Apple SD Gothic Neo','Malgun Gothic',sans-serif}
.pane{background:#fff;border:1px solid #deded8;margin-bottom:24px}
.w1{width:520px}.w2{width:360px}</style></head>
<body><div class="pane w1">
<section aria-label="코스 고도 단면" class="bg-club-surface">
  <div class="flex items-stretch border-t border-club-line bg-club-paper">
    <div style="display:flex;flex:1;align-items:center;justify-content:center;padding:8px 0;cursor:row-resize"><span style="display:block;height:6px;width:40px;border-radius:3px;background:#6b6b63"></span></div>
    <button style="display:flex;width:48px;flex-shrink:0;align-items:center;justify-content:center;border-left:1px solid #deded8;color:#3f423c"><svg viewBox="0 0 16 16" class="h-4 w-4"><path d="M3 6l5 5 5-5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
  </div>
  <div class="px-3 pb-2 pt-1.5">
    <div class="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-[11px] text-club-muted">
      <span class="font-medium text-club-ink">${km(profile.distanceM)}km</span>
      <span>상승 <strong class="font-medium text-club-ink">${Math.round(profile.ascentM)}m</strong> · 하강 <strong class="font-medium text-club-ink">${Math.round(profile.descentM)}m</strong></span>
      <span>최고 ${Math.round(profile.highM)}m</span>
      ${hardest && hardest.steepness !== "flat" ? `<span class="inline-flex items-center gap-1.5"><span class="inline-block h-[3px] w-3.5 shrink-0 rounded-full" style="background:${GRADE[hardest.steepness].line}"></span><span>가장 힘든 곳 <strong class="font-medium text-club-ink">${hardest.from} → ${hardest.to}</strong> ${km(hardest.distanceM)}km · 평균 ${Math.round(hardest.gradient * 100)}%</span></span>` : ""}
    </div>
    <svg viewBox="0 0 ${WIDTH} ${VIEW_HEIGHT}" preserveAspectRatio="none" class="mt-1 w-full" style="height:${CHART_HEIGHT}px">
      <path d="${ground}" fill="${GROUND}" fill-opacity="0.3"/>
      ${along.map((a, i) => `<line x1="${x(a)}" x2="${x(a)}" y1="0" y2="${VIEW_HEIGHT}" stroke="#202320" stroke-opacity="${rows[i] === null ? 0.07 : 0.16}" stroke-width="1" vector-effect="non-scaling-stroke"/>`).join("")}
      ${bands.map((b) => `<path d="${b.path}" fill="none" stroke="${GRADE[b.steepness].line}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>`).join("")}
    </svg>
    <div class="relative" style="height:${(tallest + 1) * LABEL_ROW}px">
      ${along.map((a, i) => {
        const row = rows[i];
        if (row === null) return "";
        const share = (a / profile.distanceM) * 100;
        const left = `${share}%`;
        const end = share < 6 ? "start" : share > 94 ? "end" : "middle";
        const place = end === "start" ? "left:0" : end === "end" ? "right:0" : `left:${left};transform:translateX(-50%)`;
        const align = end === "start" ? "text-left" : end === "end" ? "text-right" : "text-center";
        return `${row > 0 ? `<span class="absolute top-0 w-px bg-club-line" style="left:${left};height:${row * LABEL_ROW}px"></span>` : ""}
        <span class="absolute max-w-[8rem] truncate ${align} text-[11px] leading-tight text-club-muted" style="${place};top:${row * LABEL_ROW}px">${names[i]}<br><span class="text-club-faint">${km(a)}km</span></span>`;
      }).join("")}
    </div>
    ${used.length > 1 ? `<div class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 border-t border-club-line pt-1.5 text-[11px] text-club-muted">
      ${used.map((s) => `<span class="inline-flex items-center gap-1"><span class="inline-block h-0.5 w-3.5 rounded-full" style="background:${GRADE[s].line}"></span>${GRADE[s].label}</span>`).join("")}
    </div>` : ""}
  </div>
</section>
</div>PANE2</body></html>`;

const [head, section] = html.split('<div class="pane w1">');
const body = section.replace("</div>PANE2</body></html>", "");
writeFileSync("profile-preview.html",
  head + '<div class="pane w1">' + body + '</div><div class="pane w2">' + body + '</div>'
  + '<div class="pane w2"><section class="bg-club-surface"><div class="flex items-stretch border-t border-club-line bg-club-paper">'
  + '<div class="flex flex-1 items-center justify-center py-1.5"><span class="text-[11px] text-club-muted">'
  + km(profile.distanceM) + 'km · 상승 ' + Math.round(profile.ascentM) + 'm</span></div>'
  + '<button style="display:flex;width:48px;flex-shrink:0;align-items:center;justify-content:center;border-left:1px solid #deded8;color:#3f423c">'
  + '<svg viewBox="0 0 16 16" class="h-4 w-4"><path d="M3 10l5-5 5 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>'
  + '</button></div></section></div>'
  + "</body></html>");
console.log(`${hike.title}`);
console.log(`구간 ${bands.length}개 · 이름표 ${rows.filter((r) => r !== null).length}/${names.length}개 · ${tallest + 1}줄`);
console.log("profile-preview.html 에 썼습니다.");
