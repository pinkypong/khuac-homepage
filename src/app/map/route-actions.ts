"use server";

import { revalidatePath } from "next/cache";
import { requireApprovedMember } from "@/lib/supabase/require-role";
import { sanitizeTrack } from "@/lib/gps/track";
import { fetchTrailsInBounds, fetchTrailsNear } from "@/lib/routes/overpass";
import { stitchSegments, splitSurveyGaps, type TrailSegment } from "@/lib/routes/trails";
import { placeHints, prepareRouteSnap, snapRouteToTrails, walkPreparedRoute, type HintablePoint, type RouteLeg, type SnapDiagnostics } from "@/lib/routes/snap";
import { SAME_PLACE_M, type ClubPoi } from "@/lib/routes/poi";
import { groupSegmentsByTile, mergeTileSegments, tilesForBounds, tilesFullyInside, TILE_DEG } from "@/lib/routes/tiles";
import type { TrailBounds } from "@/lib/routes/overpass";
import { isValidGps } from "@/lib/gps/validate";
import { refused, refusedByDatabase, type ActionResult } from "@/lib/actions/result";
import { haversineDistanceMeters } from "@/lib/gps/haversine";

/**
 * The mapped paths around an activity, for the member to pick their route from.
 *
 * Most outings have no GPX - nobody remembers to record one - and the map had
 * nothing to draw for them. These are real coordinates from OpenStreetMap, so
 * choosing from them gives a line that follows the ground rather than cutting
 * across it.
 */
export async function loadTrails(lat: number, lng: number): Promise<TrailSegment[]> {
  const { supabase } = await requireApprovedMember();
  return pickableTrailsNear(supabase, lat, lng);
}

/** Roughly 1.5km around a point, as a box our own tiles can answer. */
const PICK_SPAN_DEG = 0.014;

/**
 * Paths to choose from, from our own tables before Overpass.
 *
 * This asked Overpass directly, which is why the button answered "등산로를
 * 불러오지 못했습니다" - it is volunteer-run, it is often down, and it is given
 * eight seconds because a member is waiting on it. Meanwhile the same trails
 * were already sitting in trail_tiles and official_trails, prefetched for
 * every mountain the club visits. Overpass stays as the fallback for somewhere
 * nobody has looked at yet.
 */
async function pickableTrailsNear(
  supabase: Awaited<ReturnType<typeof requireApprovedMember>>["supabase"],
  lat: number,
  lng: number,
): Promise<TrailSegment[]> {
  const bounds: TrailBounds = {
    south: lat - PICK_SPAN_DEG, north: lat + PICK_SPAN_DEG,
    west: lng - PICK_SPAN_DEG, east: lng + PICK_SPAN_DEG,
  };
  const held = await trailsForBounds(supabase, bounds);
  if (held.length > 0) return held;
  return fetchTrailsNear(lat, lng);
}

/**
 * Saves the chosen paths as this activity's route.
 *
 * The stitching is redone here rather than trusting a track posted from the
 * browser: the client sends which segments, in what order, and the geometry is
 * rebuilt from a fresh copy so nothing arbitrary can be written into the field
 * the map draws from.
 */
export async function saveTrailRoute(
  hikeId: string,
  lat: number,
  lng: number,
  segmentIds: number[],
): Promise<ActionResult<{ pointCount: number }>> {
  const { supabase } = await requireApprovedMember();

  if (segmentIds.length === 0) return refused("구간을 하나 이상 선택해주세요.");

  const available = await pickableTrailsNear(supabase, lat, lng);
  const byId = new Map(available.map((segment) => [segment.id, segment]));
  const chosen = segmentIds
    .map((id) => byId.get(id))
    .filter((segment): segment is TrailSegment => segment !== undefined);

  if (chosen.length === 0) return refused("선택한 구간을 찾지 못했습니다. 다시 시도해주세요.");

  const track = sanitizeTrack(stitchSegments(chosen));
  if (!track) return refused("이어지는 경로를 만들지 못했습니다.");

  const { error } = await supabase
    .from("hikes").update({ track, track_source: "trail_pick" }).eq("id", hikeId);
  if (error) return refusedByDatabase("경로 저장", error);

  revalidatePath("/map");
  return { ok: true, value: { pointCount: track.length } };
}

/**
 * Pulls a suggested course onto the trails that actually connect its waypoints.
 *
 * The assistant names places; geocoding turns those into points; joining the
 * points with straight lines draws a route over ground nobody walks. This
 * fetches the mapped paths around the course and routes between the waypoints
 * along them, so the line follows switchbacks instead of cutting across them.
 *
 * Server-side because Overpass asks callers to identify themselves and behave,
 * and because the raw response is far larger than the legs it produces.
 */
export interface SnapResult {
  legs: RouteLeg[];
  /** Why a leg might be dashed, so the map can say rather than leave the
      member guessing between "no trail here" and "could not look". */
  trailsLoaded: boolean;
  /** The waypoints as actually walked, in order; one more than there are legs. */
  points: HintablePoint[];
}

/**
 * A waypoint as the browser could resolve it.
 *
 * Three cases, because a lookup can fail in two different ways. A point is a
 * name that resolved. Null is a name that resolved to nothing at all. A hint is
 * the third: a name like 석굴암입구 - a turning, which no gazetteer carries -
 * where the place it is the way in to does resolve. The turning is then
 * wherever the course passes closest to that place, which is geometry rather
 * than a guess.
 */
export type SentWaypoint =
  | { lat: number; lng: number }
  | { hint: { lat: number; lng: number } }
  | null;

const isPoint = (w: SentWaypoint): w is { lat: number; lng: number } =>
  w !== null && "lat" in w;
const isHint = (w: SentWaypoint): w is { hint: { lat: number; lng: number } } =>
  w !== null && "hint" in w;

export async function snapSuggestedRoute(waypoints: SentWaypoint[]): Promise<SnapResult> {
  const { supabase } = await requireApprovedMember();
  if (waypoints.length > 12) throw new Error("경로 좌표를 확인해주세요.");
  for (const waypoint of waypoints) {
    const point = isPoint(waypoint) ? waypoint : isHint(waypoint) ? waypoint.hint : null;
    if (point && !isValidGps(point.lat, point.lng)) throw new Error("경로 좌표를 확인해주세요.");
  }

  // Dense, each remembering which name it came from. Everything below routes
  // through these; hints are placed onto the finished line afterwards, because
  // routing through a temple 649m up a side branch is the detour this exists
  // to stop drawing.
  const placed: HintablePoint[] = waypoints.flatMap((point, index) =>
    isPoint(point) ? [{ index, lat: point.lat, lng: point.lng, derived: false }] : []);
  const hints = waypoints.flatMap((point, index) =>
    isHint(point) ? [{ index, ...point.hint }] : []);
  if (placed.length < 2) return { legs: [], trailsLoaded: true, points: placed };

  // A box around the whole course rather than a circle around its middle. The
  // circle was capped at a 3km radius, so a 6km course from 밤골 to 도선사 had
  // the middle of the mountain outside the query and came back entirely dashed
  // for want of data rather than for want of a path.
  const lats = placed.map((w) => w.lat);
  const lngs = placed.map((w) => w.lng);
  // Roughly 900m of margin, so a trailhead just outside the course still has
  // the path leading onto it.
  const margin = 0.008;

  const bounds: TrailBounds = {
    south: Math.min(...lats) - margin,
    west: Math.min(...lngs) - margin,
    north: Math.max(...lats) + margin,
    east: Math.max(...lngs) + margin,
  };

  let segments = await trailsForBounds(supabase, bounds);
  if (segments.length === 0) {
    // No geometry is available; do not invent straight connections.
    return {
      legs: placed.slice(1).map(() => ({ points: [], onTrail: false })),
      trailsLoaded: false,
      points: placed,
    };
  }
  // Logged because none of this is visible from the map: a dashed leg looks
  // the same whether a waypoint was 500m from the nearest path or the path
  // simply does not connect.
  const diagnostics: SnapDiagnostics = { snapDistances: [], legs: [] };
  const written = placed.map((_, index) => index);
  // Prepared once. Projecting the waypoints and building the path graph is
  // almost all of the cost - 273ms of the 정릉 course's snap, measured - and
  // none of it depends on the order they are visited in, so the second order
  // below is walked over this same graph rather than rebuilding it. Two full
  // snaps per request is most of a CPU budget this Worker has already exceeded
  // once in production.
  let prepared = prepareRouteSnap(placed, segments);
  if (!prepared) return { legs: [], trailsLoaded: true, points: placed };
  let legs = walkPreparedRoute(prepared, written, diagnostics);
  if (legs.some((leg) => !leg.onTrail)) {
    // A real approach may go around a ridge outside the initial box. Try a
    // larger area once, retaining usable geometry if the provider is down.
    const expanded = { south: bounds.south - 0.012, west: bounds.west - 0.012,
      north: bounds.north + 0.012, east: bounds.east + 0.012 };
    if (expanded.north - expanded.south <= 0.25 && expanded.east - expanded.west <= 0.25) {
      segments = mergeTileSegments([segments, await trailsForBounds(supabase, expanded)]);
      prepared = prepareRouteSnap(placed, segments) ?? prepared;
      legs = walkPreparedRoute(prepared, written, diagnostics);
    }
  }
  // The order the answer wrote is usually the order it is walked and sometimes
  // is not - 우이령길 listed the pass after a viewpoint a kilometre past it,
  // and the line ran south and back north for nothing. Sorting by distance
  // from the start fixes that one and breaks 정릉, where the 성곽 ridge curves
  // enough that a later gate is nearer in a straight line than an earlier one:
  // 7.74km became 9.01km.
  //
  // Neither order is right in general, so both are drawn and the shorter one
  // kept. They pass the same places; the shorter line is the one that doubles
  // back less, which is what "walked in order" means on the ground.
  const sorted = [...placed.keys()]
    .slice(1, -1)
    .sort((a, b) => straightMetres(placed[0], placed[a]) - straightMetres(placed[0], placed[b]));
  const order = [0, ...sorted, placed.length - 1];
  const reordered = order.some((index, i) => index !== i) && !isOutAndBack(placed)
    ? walkPreparedRoute(prepared, order)
    : null;

  // Fewer gaps first, then shorter. A gap is the worse fault - it is a piece
  // of the walk the map cannot show at all - and only between two orders that
  // show the same amount does length decide, where it means less doubling back.
  const score = (candidate: RouteLeg[]): [number, number] => [
    candidate.filter((leg) => !leg.onTrail).length,
    candidate.reduce((total, leg) => total + trackLengthMetres(leg.points), 0),
  ];
  const better = (a: [number, number], b: [number, number]) =>
    a[0] !== b[0] ? a[0] < b[0] : a[1] < b[1];
  const takeSorted = reordered !== null && better(score(reordered), score(legs));

  console.log("[route-actions] snap", JSON.stringify({
    ways: segments.length,
    snapM: diagnostics.snapDistances,
    legs: diagnostics.legs,
    reordered: takeSorted,
    hints: hints.map((hint) => hint.index),
  }));
  const drawn = takeSorted
    ? { legs: reordered!, points: order.map((index) => placed[index]) }
    : { legs, points: placed };
  return { ...placeHints(drawn, hints), trailsLoaded: true };
}

const straightMetres = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) =>
  haversineDistanceMeters(a, b);

/**
 * Whether the course returns to somewhere it has already been.
 *
 * Two waypoints at the same spot with others between them is an out-and-back,
 * and on 북한산 it is usually a gate: 백운봉암문 was renamed from 위문 in 2015,
 * so the summit course reads 백운봉암문, 백운대, 위문 - up to the gate, out to
 * the peak, back through the gate. Both names resolve to the same point.
 *
 * Which is exactly what the shorter-line rule below would delete. Sorting those
 * three by distance from the start puts the two gate names together and walks
 * the summit spur once instead of twice: 5.69km becomes 5.53, and the shorter
 * line wins while describing a walk nobody took. A course that comes back on
 * itself has its order carried by the answer, not by the geometry, so it is
 * left exactly as written.
 */
function isOutAndBack(waypoints: { lat: number; lng: number }[]): boolean {
  for (let i = 0; i < waypoints.length; i++) {
    for (let j = i + 2; j < waypoints.length; j++) {
      if (haversineDistanceMeters(waypoints[i], waypoints[j]) <= SAME_PLACE_M) return true;
    }
  }
  return false;
}

function trackLengthMetres(points: [number, number][]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += haversineDistanceMeters(
      { lat: points[i - 1][0], lng: points[i - 1][1] },
      { lat: points[i][0], lng: points[i][1] },
    );
  }
  return total;
}

/**
 * The club's trail geometry for a box, filling any gaps from Overpass.
 *
 * Cached tiles answer first. Overpass is asked only about ground nobody has
 * looked at yet, and if it refuses - which it does; the main instance returned
 * 504 twice in one day while this was written - whatever tiles we already hold
 * are used anyway. Stale trail data is still trail data: paths do not move.
 */
async function trailsForBounds(
  supabase: Awaited<ReturnType<typeof requireApprovedMember>>["supabase"],
  bounds: TrailBounds,
): Promise<TrailSegment[]> {
  const keys = tilesForBounds(bounds);
  const cached = new Map<string, TrailSegment[]>();
  const legacy = new Map<string, TrailSegment[]>();
  const legacyKeys = keys.map((key) => key.replace(/^v3:/, "v2:"));

  // Both sources at once. 산림청 and 국립공원공단 surveyed these routes and OSM
  // volunteers walked them, and neither is reliably the better record - the
  // forest service data has documented gaps of its own - so a path missing
  // from one is supplied by the other rather than argued with.
  const [osm, official] = await Promise.all([
    supabase.from("trail_tiles").select("tile_key, segments").in("tile_key", [...keys, ...legacyKeys]),
    // Official surveyed geometry did not suffer OSM's downsampling bug.
    supabase.from("official_trails").select("segments").in("tile_key", [...keys, ...keys.map((key) => key.replace(/^v3:/, "v2:"))]),
  ]);
  for (const row of (osm.data ?? []) as unknown as { tile_key: string; segments: TrailSegment[] }[]) {
    if (row.tile_key.startsWith("v3:")) cached.set(row.tile_key, row.segments ?? []);
    else legacy.set(row.tile_key.replace(/^v2:/, "v3:"), row.segments ?? []);
  }
  const officialSegments = splitSurveyGaps(mergeTileSegments(((official.data ?? []) as unknown as { segments: TrailSegment[] }[])
    .map((row) => row.segments ?? [])));

  const missing = keys.filter((key) => !cached.has(key));
  if (missing.length === 0) return mergeTileSegments([...cached.values(), officialSegments]);

  try {
    // Query complete tiles, including the edges, so later previews can use
    // the cache instead of repeatedly asking Overpass for clipped tiles.
    const aligned = {
      south: Math.floor(bounds.south / TILE_DEG) * TILE_DEG,
      west: Math.floor(bounds.west / TILE_DEG) * TILE_DEG,
      north: Math.ceil(bounds.north / TILE_DEG) * TILE_DEG,
      east: Math.ceil(bounds.east / TILE_DEG) * TILE_DEG,
    };
    const fetched = await fetchTrailsInBounds(aligned);
    const byTile = groupSegmentsByTile(fetched);
    // Only the tiles this box fully contained. An empty tile is a real answer
    // worth keeping - "no paths here" saves the next preview a fetch - but a
    // tile the box merely clipped would be cached with the ways that fell
    // inside and none of the ones continuing past the edge, which is a hole a
    // later course would read as fact.
    const complete = tilesFullyInside(aligned);
    const rows = keys
      .filter((key) => complete.has(key))
      .map((key) => ({
        tile_key: key,
        segments: byTile.get(key) ?? [],
        fetched_at: new Date().toISOString(),
      }));
    if (rows.length > 0) {
      const { error } = await supabase.from("trail_tiles").upsert(rows, { onConflict: "tile_key" });
      if (error) console.error("[route-actions] trail tile write failed", error.message);
    }
    return mergeTileSegments([[...fetched], ...cached.values(), officialSegments]);
  } catch {
    console.error("[route-actions] Overpass unavailable; drawing from what we hold");
    // Retain the previous geometry during an outage, without labelling it as
    // newly fetched or persisting it under the complete-geometry version.
    return mergeTileSegments([...cached.values(), ...legacy.values(), officialSegments]);
  }
}

/** Paths for a close satellite viewport; shares the route geometry cache. */
export async function loadSatelliteTrails(bounds: TrailBounds): Promise<TrailSegment[]> {
  const { supabase } = await requireApprovedMember();
  if (!isValidGps(bounds.south, bounds.west) || !isValidGps(bounds.north, bounds.east)
    || bounds.north <= bounds.south || bounds.east <= bounds.west
    || bounds.north - bounds.south > 0.08 || bounds.east - bounds.west > 0.08) return [];
  return trailsForBounds(supabase, bounds);
}

/**
 * The club's own points for a set of waypoint names.
 *
 * Consulted before any search: route answers name places the way climbers do,
 * and those names are local usage rather than map labels. Looking 해골바위 up
 * by name put it on the far side of 북한산; a row here is the club saying
 * where it actually is, and it keeps saying so.
 */
export async function loadClubPois(): Promise<ClubPoi[]> {
  const { supabase } = await requireApprovedMember();
  const { data } = await supabase.from("route_pois").select("name, aliases, lat, lng");
  return ((data ?? []) as unknown as ClubPoi[]).map((row) => ({
    name: row.name,
    aliases: row.aliases ?? [],
    lat: row.lat,
    lng: row.lng,
  }));
}

/**
 * Records where a named place actually is.
 *
 * Any approved member, not just an admin: the person who walked the route is
 * the one who knows, and making them file a request is how the table stays
 * empty. Saving the same name again moves the existing point rather than
 * creating a rival row, so a name never becomes ambiguous.
 */
export async function saveClubPoi(input: {
  name: string;
  lat: number;
  lng: number;
  aliases?: string[];
  kind?: string | null;
  note?: string | null;
}): Promise<ActionResult> {
  const { supabase, memberId } = await requireApprovedMember();

  const name = input.name.trim();
  if (!name) return refused("이름을 입력해주세요.");
  if (!isValidGps(input.lat, input.lng)) return refused("지도에서 위치를 지정해주세요.");

  const existing = await supabase
    .from("route_pois")
    .select("id")
    .ilike("name", name)
    .maybeSingle();

  const row = {
    name,
    aliases: (input.aliases ?? []).map((a) => a.trim()).filter(Boolean),
    lat: input.lat,
    lng: input.lng,
    kind: input.kind ?? null,
    note: input.note ?? null,
    updated_at: new Date().toISOString(),
  };

  const id = (existing.data as { id: string } | null)?.id;
  const { error } = id
    ? await supabase.from("route_pois").update(row).eq("id", id)
    : await supabase.from("route_pois").insert({ ...row, created_by: memberId });
  if (error) return refusedByDatabase("지명 저장", error);

  revalidatePath("/map");
  return { ok: true };
}

/**
 * Redraws an album's line along its own waypoints.
 *
 * Saving the course used to change only the names and the numbers, because the
 * drawn line lives in `track` and nothing recomputed it - so adding a waypoint
 * put a marker on the map and left the line ending where it always had.
 *
 * Deliberately a button rather than something that happens on save. There is no
 * column saying where a track came from - page.tsx reports "gpx" for any track
 * at all - so a rebuild cannot tell a member's recorded walk from a line this
 * same routine drew earlier, and redrawing on every save would eventually erase
 * somebody's GPX. The caller warns before calling when a track already exists.
 *
 * The geometry is built here from our own tiles, never posted from the browser,
 * for the same reason saveTrailRoute rebuilds its own: this is the field the
 * map draws from.
 */
export async function rebuildCourseTrack(
  hikeId: string,
): Promise<ActionResult<{ pointCount: number; drawnLegs: number; totalLegs: number }>> {
  const { supabase } = await requireApprovedMember();

  const { data, error } = await supabase
    .from("hikes").select("route_waypoints").eq("id", hikeId).maybeSingle();
  if (error) return refusedByDatabase("경유지 읽기", error);
  const points = ((data as { route_waypoints: { name: string; lat: number; lng: number }[] | null } | null)
    ?.route_waypoints ?? []).filter((point) => isValidGps(point.lat, point.lng));
  if (points.length < 2) {
    return refused("경로를 그리려면 경유지가 두 곳 이상 있어야 합니다.");
  }

  // A margin around the points, so a path that bows out between two waypoints
  // is still in the box the snapper gets to work with.
  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  const bounds: TrailBounds = {
    south: Math.min(...lats) - PICK_SPAN_DEG, north: Math.max(...lats) + PICK_SPAN_DEG,
    west: Math.min(...lngs) - PICK_SPAN_DEG, east: Math.max(...lngs) + PICK_SPAN_DEG,
  };
  const segments = await trailsForBounds(supabase, bounds);
  if (segments.length === 0) {
    return refused("이 구역의 등산로 자료가 아직 없어 경로를 그릴 수 없습니다.");
  }

  const legs = snapRouteToTrails(points, segments);
  // Only the legs that found real ground are drawn. A leg the snapper could not
  // follow is left out rather than joined with a straight line, which would be
  // a path nobody walked drawn as though somebody had.
  const onTrail = legs.filter((leg) => leg.onTrail);
  const track = sanitizeTrack(onTrail.flatMap((leg) => leg.points));
  if (!track || track.length < 2) {
    return refused("경유지 사이를 잇는 등산로를 찾지 못했습니다.");
  }

  const { error: saveError, count } = await supabase
    .from("hikes").update({ track, track_source: "course" }, { count: "exact" }).eq("id", hikeId);
  if (saveError) return refusedByDatabase("경로 저장", saveError);
  if (count === 0) return refused("이 앨범을 수정할 권한이 없습니다.");

  revalidatePath("/map");
  return {
    ok: true,
    value: { pointCount: track.length, drawnLegs: onTrail.length, totalLegs: legs.length },
  };
}
