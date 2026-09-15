/**
 * Checks every leg of every course the assistant offered for one question.
 *
 *   node scripts/audit-courses.mts
 *
 * Reading a course off a screenshot catches the leg that is obviously wrong and
 * misses the one that is quietly two kilometres long where it should be one.
 * Two numbers per leg say it instead:
 *
 *   ratio - routed length over straight length. Mountain trails switchback, so
 *     1.3 to 1.8 is ordinary; past about 2 the router went somewhere else.
 *   off   - how far the line strays from the straight line between its ends.
 *     A route that passes its destination and doubles back shows here and not
 *     in the ratio, which is what 밤골 to 숨은벽능선 was doing.
 *
 * Both are heuristics for finding legs worth looking at by hand, not verdicts.
 */
import { readFileSync } from "node:fs";
import { snapRouteToTrails, dropOutlierWaypoints, placeHints, type RouteLeg, type SnapDiagnostics } from "../src/lib/routes/snap.ts";
import { mergeTileSegments, tilesForBounds } from "../src/lib/routes/tiles.ts";
import { splitSurveyGaps, type TrailSegment } from "../src/lib/routes/trails.ts";
import { haversineDistanceMeters } from "../src/lib/gps/haversine.ts";
import { findClubPoi, isUsableWaypoint, SAME_PLACE_M, type ClubPoi } from "../src/lib/routes/poi.ts";
import type { TrackPoint } from "../src/lib/gps/track.ts";




function env(name: string): string {
  const match = readFileSync(".env.local", "utf8").match(new RegExp(`^${name}=(.*)$`, "m"));
  const value = match?.[1]?.trim().replace(/^["']|["']$/g, "");
  if (!value) throw new Error(`${name} is not set in .env.local`);
  return value;
}

const supabaseUrl = env("NEXT_PUBLIC_SUPABASE_URL");
const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
const mapsKey = env("NEXT_PUBLIC_GOOGLE_MAPS_API_KEY");
const headers = { apikey: serviceKey, authorization: `Bearer ${serviceKey}` };

/** Courses the assistant has actually offered, as it offered them. */
const COURSES: { place: string; centre: { latitude: number; longitude: number }; names: string[] }[] = [
  ...[
    ["북한산성탐방지원센터", "대서문", "북한동역사관", "백운봉암문", "백운대", "위문", "하루재", "백운대탐방지원센터(도선사)"],
    ["밤골탐방지원센터", "해골바위", "숨은벽능선", "백운봉암문", "백운대", "위문", "하루재", "백운대탐방지원센터(도선사)"],
    ["정릉탐방지원센터", "영추사", "대성문", "보국문", "대동문", "동장대", "용암문", "도선사"],
    ["구기탐방지원센터", "구기계곡", "대남문", "대성문", "대동문", "용암문", "도선사"],
  ].map((names) => ({ place: "북한산", centre: { latitude: 37.64, longitude: 126.98 }, names })),
  ...[
    ["도봉산역", "도봉탐방지원센터", "광륜사", "천축사", "마당바위", "신선대"],
    ["도봉탐방지원센터", "도봉사", "보문능선", "천진사", "우이암"],
    ["도봉탐방지원센터", "광륜사", "다락능선", "망월사 갈림길", "포대정상", "신선대"],
    ["망월사역", "원도봉탐방지원센터", "덕제샘", "망월사", "포대정상", "신선대"],
  ].map((names) => ({ place: "도봉산", centre: { latitude: 37.695, longitude: 127.015 }, names })),
  ...[
    ["사당역", "관음사", "연주대"],
  ].map((names) => ({ place: "관악산", centre: { latitude: 37.445, longitude: 126.964 }, names })),
  // The course that produced a spur off the side of the line: the waypoints
  // came back in an order that walks past 우이령 and back to reach 오봉전망대.
  ...[
    ["교현탐방지원센터", "석굴암입구", "오봉전망대", "우이령", "우이탐방지원센터"],
  ].map((names) => ({ place: "북한산", centre: { latitude: 37.665, longitude: 127.005 }, names })),
];

const lookups = new Map<string, { name: string; lat: number; lng: number } | null>();

async function search(textQuery: string, asked: string, place: string, centre: { latitude: number; longitude: number }) {
  const response = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-Goog-Api-Key": mapsKey,
      referer: "https://khuac.com/",
      "X-Goog-FieldMask": "places.displayName,places.location,places.types",
    },
    body: JSON.stringify({
      textQuery, languageCode: "ko", regionCode: "KR", maxResultCount: 5,
      locationBias: { circle: { center: centre, radius: 20000 } },
    }),
  });
  const body = await response.json() as {
    places?: { displayName: { text: string }; location: { latitude: number; longitude: number }; types: string[] }[];
  };
  return (body.places ?? []).find((p) =>
    isUsableWaypoint(asked, p.displayName.text, p.types ?? [], place));
}

const clubPois: ClubPoi[] = await (async () => {
  const response = await fetch(`${supabaseUrl}/rest/v1/route_pois?select=name,aliases,lat,lng`, { headers });
  return response.ok ? await response.json() as ClubPoi[] : [];
})();
console.log(`동아리 지명 ${clubPois.length}개`);

async function resolve(name: string, place: string, centre: { latitude: number; longitude: number }) {
  const cached = lookups.get(`${place}:${name}`);
  if (cached !== undefined) return cached;
  // The club's own gazetteer first, exactly as the browser does.
  const known = findClubPoi(name, clubPois);
  if (known) {
    const point = { name: `${known.name} (동아리 등록)`, lat: known.lat, lng: known.lng };
    lookups.set(`${place}:${name}`, point);
    return point;
  }
  let best = await search(`${place} ${name}`, name, place, centre);
  if (!best) best = await search(name, name, place, centre);
  const point = best
    ? { name: best.displayName.text, lat: best.location.latitude, lng: best.location.longitude }
    : null;
  lookups.set(`${place}:${name}`, point);
  return point;
}

async function rows(table: string, keys: string[]): Promise<TrailSegment[][]> {
  const list = keys.map((key) => `"${key}"`).join(",");
  const response = await fetch(
    `${supabaseUrl}/rest/v1/${table}?select=segments&tile_key=in.(${encodeURIComponent(list)})`,
    { headers },
  );
  if (!response.ok) throw new Error(`${table}: ${response.status}`);
  return ((await response.json()) as { segments: TrailSegment[] }[]).map((row) => row.segments ?? []);
}

const metres = (a: TrackPoint, b: TrackPoint) =>
  haversineDistanceMeters({ lat: a[0], lng: a[1] }, { lat: b[0], lng: b[1] });

function legLength(points: TrackPoint[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += metres(points[i - 1], points[i]);
  return total;
}

/** Furthest any point on the line strays from the straight line between its ends. */
function strayMetres(path: TrackPoint[]): number {
  if (path.length < 3) return 0;
  const a = path[0];
  const b = path[path.length - 1];
  const scale = Math.cos(a[0] * Math.PI / 180);
  const dx = (b[1] - a[1]) * scale;
  const dy = b[0] - a[0];
  const squared = dx * dx + dy * dy;
  let worst = 0;
  for (const point of path) {
    const t = squared === 0 ? 0 : Math.max(0, Math.min(1,
      (((point[1] - a[1]) * scale) * dx + (point[0] - a[0]) * dy) / squared));
    const foot: TrackPoint = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
    worst = Math.max(worst, metres(point, foot));
  }
  return worst;
}

/** "석굴암입구" and its kin: a turning, named after the place it leads to. */
const ENTRANCE = /^(.+?)(입구|들머리|초입|갈림길|삼거리)$/;

for (const [index, { place, centre, names }] of COURSES.entries()) {
  const resolved: { name: string; lat: number; lng: number; asked: string }[] = [];
  const hints: { asked: string; lat: number; lng: number }[] = [];
  const missing: string[] = [];
  for (const name of names) {
    // A turning is not routed through - the place it leads to can be a
    // kilometre up a branch, and routing through that walks the branch twice.
    // It is put on the finished line instead, where the line passes the place.
    const base = name.replace(/\s+/g, "").match(ENTRANCE)?.[1];
    if (base && base.length >= 2) {
      const at = await resolve(base, place, centre);
      if (at) {
        hints.push({ asked: name, lat: at.lat, lng: at.lng });
        continue;
      }
    }
    const point = await resolve(name, place, centre);
    if (point) resolved.push({ ...point, asked: name });
    else missing.push(name);
  }

  // The same two steps the browser takes after resolving.
  const collapsed = resolved.filter((point, i) =>
    i === 0 || haversineDistanceMeters(resolved[i - 1], point) > SAME_PLACE_M);
  const kept = dropOutlierWaypoints(collapsed);

  console.log(`\n=== 코스 ${index + 1}: ${names[0]} → ${names[names.length - 1]}`);
  if (missing.length) console.log(`  찾지 못함: ${missing.join(", ")}`);
  const merged = collapsed.length !== resolved.length
    ? resolved.filter((p) => !collapsed.includes(p)).map((p) => p.asked)
    : [];
  if (merged.length) console.log(`  앞 경유지와 같은 곳: ${merged.join(", ")}`);
  const dropped = kept.length !== collapsed.length
    ? collapsed.filter((p) => !kept.includes(p)).map((p) => p.asked)
    : [];
  if (dropped.length) console.log(`  너무 멀어 제외: ${dropped.join(", ")}`);
  for (const point of kept) {
    if (point.name.replace(/\s/g, "") !== point.asked.replace(/\s/g, "")) {
      console.log(`  '${point.asked}' → '${point.name}'`);
    }
  }

  const lats = kept.map((p) => p.lat);
  const lngs = kept.map((p) => p.lng);
  const bounds = {
    south: Math.min(...lats) - 0.02, west: Math.min(...lngs) - 0.02,
    north: Math.max(...lats) + 0.02, east: Math.max(...lngs) + 0.02,
  };
  const [osm, official] = await Promise.all([
    rows("trail_tiles", tilesForBounds(bounds)),
    rows("official_trails", tilesForBounds(bounds)),
  ]);
  const segments = mergeTileSegments([
    mergeTileSegments(osm),
    splitSurveyGaps(mergeTileSegments(official)),
  ]);

  // Both orders, shorter kept - the same rule the map applies, so the audit
  // measures what a member actually sees.
  // Both orders, fewer gaps and then shorter kept - the same rule the map
  // applies, so the audit measures what a member actually sees. Whichever wins
  // brings its own waypoint order and its own diagnostics, so the per-leg lines
  // below name the places that leg really runs between.
  const score = (candidate: RouteLeg[]): [number, number] => [
    candidate.filter((leg) => !leg.onTrail).length,
    candidate.reduce((n, leg) => n + legLength(leg.points), 0),
  ];
  const draw = (points: typeof kept) => {
    const diagnostics: SnapDiagnostics = { snapDistances: [], legs: [] };
    return { points, legs: snapRouteToTrails(points, segments, diagnostics), diagnostics };
  };
  // The same guard the map applies: a course that returns to a place it has
  // already been has its order carried by the answer, not by the geometry.
  const outAndBack = kept.some((point, i) =>
    kept.slice(i + 2).some((other) => haversineDistanceMeters(point, other) <= SAME_PLACE_M));
  let drawn = draw(kept);
  if (kept.length >= 4 && !outAndBack) {
    const order = [...kept.keys()].slice(1, -1)
      .sort((a, b) => haversineDistanceMeters(kept[0], kept[a]) - haversineDistanceMeters(kept[0], kept[b]));
    const other = draw([kept[0], ...order.map((i) => kept[i]), kept[kept.length - 1]]);
    const [gapsA, lenA] = score(other.legs);
    const [gapsB, lenB] = score(drawn.legs);
    if (gapsA !== gapsB ? gapsA < gapsB : lenA < lenB) {
      drawn = other;
      console.log(`  순서 바로잡음: ${other.points.map((p) => p.asked).join(" → ")}`);
    }
  }
  // The turnings, placed on the line the rest of the course drew.
  const hinted = placeHints(
    {
      legs: drawn.legs,
      points: drawn.points.map((point, at) => ({ index: at, lat: point.lat, lng: point.lng, derived: false })),
    },
    hints.map((hint, at) => ({ index: drawn.points.length + at, lat: hint.lat, lng: hint.lng })),
  );
  const names2 = [...drawn.points.map((point) => point.asked), ...hints.map((hint) => hint.asked)];
  const walked = hinted.points.map((point) => ({ asked: names2[point.index] ?? "?", derived: point.derived }));
  const legs = hinted.legs;
  const { diagnostics } = drawn;
  const guessed = walked.filter((point) => point.derived).map((point) => point.asked);
  if (guessed.length) console.log(`  선 위에 놓은 입구: ${guessed.join(", ")}`);
  let total = 0;
  legs.forEach((leg, i) => {
    const detail = hints.length > 0 ? undefined : diagnostics.legs[i];
    const label = `  ${walked[i].asked} → ${walked[i + 1].asked}`;
    if (!leg.onTrail) {
      console.log(`${label}: 경로 없음 (직선 ${((detail?.straightM ?? 0) / 1000).toFixed(2)}km)`);
      return;
    }
    // Measured off the drawn line when a turning was inserted: the diagnostics
    // count the legs the router produced, and inserting one splits a leg.
    const routed = detail?.routedM ?? legLength(leg.points);
    const straight = detail?.straightM ?? metres(leg.points[0], leg.points[leg.points.length - 1]);
    total += routed;
    const ratio = routed / Math.max(straight, 1);
    const stray = strayMetres(leg.points);
    const flag = ratio > 2 || stray > 400 ? "  ← 확인 필요" : "";
    console.log(`${label}: ${(routed / 1000).toFixed(2)}km · 배율 ${ratio.toFixed(2)} · 이탈 ${Math.round(stray)}m${flag}`);
  });
  console.log(`  합계 ${(total / 1000).toFixed(2)}km`);
}
