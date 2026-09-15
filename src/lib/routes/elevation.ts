/**
 * Turning a drawn line into the picture the national park draws.
 *
 * Height against distance, with the named points along the bottom and the
 * steep stretches marked, so a reader can see where the work is before
 * committing to it. A card saying "약 7.1km, 약 4시간" does not say whether that
 * is a walk or a ladder; this does.
 *
 * Kept free of any Supabase or network import so the arithmetic can be tested.
 * Where the heights come from is elevation-actions.ts's problem.
 */
import { haversineDistanceMeters } from "@/lib/gps/haversine";
import type { TrackPoint } from "@/lib/gps/track";

/**
 * The grid heights are asked for and stored on, in degrees.
 *
 * Copernicus DEM GLO-90 is ninety metres to a sample, and 0.0008° of latitude
 * is 89m at this latitude. Two points inside one cell are one question, so the
 * cell is the cache key as well as the sampling interval.
 *
 * The same figure is used for longitude, where it is about 70m this far north.
 * Finer than the model rather than coarser: erring the other way would average
 * two real samples into one and flatten the ridge between them.
 */
export const CELL_DEG = 0.0008;

/** Roughly the spacing along a line that puts one sample in each cell. */
export const SAMPLE_SPACING_M = 90;

export const cellKey = (lat: number, lng: number) =>
  `${Math.round(lat / CELL_DEG)}:${Math.round(lng / CELL_DEG)}`;

/** The point a cell's height is asked for: its centre, not a corner. */
export function cellCentre(key: string): { lat: number; lng: number } {
  const [row, col] = key.split(":").map(Number);
  return { lat: row * CELL_DEG, lng: col * CELL_DEG };
}

const metres = (a: TrackPoint, b: TrackPoint) =>
  haversineDistanceMeters({ lat: a[0], lng: a[1] }, { lat: b[0], lng: b[1] });

export interface ProfilePoint {
  /** Metres walked from the start of the line to here. */
  along: number;
  /** Metres above sea level. */
  elevation: number;
}

/**
 * One point every `spacing` metres along the line, carrying how far in it is.
 *
 * The line itself is never thinned. Resampling the geometry to the model's
 * resolution was tried and is wrong: cutting a switchbacking path down to one
 * point every 90m cuts its corners off, so the length falls and the "surface"
 * distance comes out shorter than the flat one - which says something about the
 * thinning and nothing about the hill.
 */
export function sampleAlongTrack(points: TrackPoint[], spacing = SAMPLE_SPACING_M) {
  if (points.length === 0) return [];
  const out: { point: TrackPoint; along: number }[] = [{ point: points[0], along: 0 }];
  let along = 0;
  let carried = 0;
  for (let i = 1; i < points.length; i++) {
    const run = metres(points[i - 1], points[i]);
    along += run;
    carried += run;
    if (carried >= spacing) {
      out.push({ point: points[i], along });
      carried = 0;
    }
  }
  const last = points[points.length - 1];
  if (out[out.length - 1].point !== last) out.push({ point: last, along });
  return out;
}

/** Where along the line each waypoint stands, so the profile can be labelled. */
export function waypointsAlong(
  points: TrackPoint[],
  waypoints: { lat: number; lng: number }[],
): number[] {
  if (points.length === 0) return waypoints.map(() => 0);
  const along: number[] = [0];
  for (let i = 1; i < points.length; i++) along.push(along[i - 1] + metres(points[i - 1], points[i]));
  return waypoints.map((waypoint) => {
    let best = 0;
    let closest = Infinity;
    for (let i = 0; i < points.length; i++) {
      const away = metres(points[i], [waypoint.lat, waypoint.lng]);
      if (away < closest) {
        closest = away;
        best = i;
      }
    }
    return along[best];
  });
}

export interface CourseProfile {
  points: ProfilePoint[];
  /** Flat length of the line, which is what the map measures. */
  distanceM: number;
  /** Length with the climbing counted in - what is actually walked. */
  surfaceM: number;
  ascentM: number;
  descentM: number;
  lowM: number;
  highM: number;
}

/**
 * The profile of a line whose heights are known.
 *
 * Heights arrive one per sample; every point between two samples takes its
 * height by interpolating between them, which is what keeps the surface length
 * honest without pretending the model is finer than it is.
 */
export function buildProfile(
  points: TrackPoint[],
  samples: { along: number }[],
  heights: number[],
): CourseProfile | null {
  if (points.length < 2 || samples.length < 2 || heights.length !== samples.length) return null;

  const profile: ProfilePoint[] = samples.map((sample, i) => ({
    along: sample.along,
    elevation: heights[i],
  }));

  const heightAt = (along: number) => {
    let i = 1;
    while (i < profile.length - 1 && profile[i].along < along) i++;
    const span = profile[i].along - profile[i - 1].along;
    const t = span > 0 ? Math.min(1, Math.max(0, (along - profile[i - 1].along) / span)) : 0;
    return profile[i - 1].elevation + t * (profile[i].elevation - profile[i - 1].elevation);
  };

  let distanceM = 0;
  let surfaceM = 0;
  let ascentM = 0;
  let descentM = 0;
  let height = heightAt(0);
  for (let i = 1; i < points.length; i++) {
    const run = metres(points[i - 1], points[i]);
    distanceM += run;
    const next = heightAt(distanceM);
    const rise = next - height;
    surfaceM += Math.hypot(run, rise);
    if (rise > 0) ascentM += rise; else descentM -= rise;
    height = next;
  }

  return {
    points: profile,
    distanceM,
    surfaceM,
    ascentM,
    descentM,
    lowM: Math.min(...heights),
    highM: Math.max(...heights),
  };
}

/**
 * How hard a stretch is, on the scale the national park signs its trails with.
 *
 * Five steps rather than four, because the top of the old scale had 22% and a
 * granite staircase in the same word. The park's own charts go green, blue,
 * yellow, red, black for the same reason ski runs do.
 */
export type Steepness = "flat" | "gentle" | "moderate" | "steep" | "severe";

export interface CourseSection {
  /** The two named points this runs between. */
  from: string;
  to: string;
  /** Where it begins and ends along the line. Carried rather than left to the
      caller to look up: a pair too short to measure is skipped, so the sections
      are not index-aligned with the waypoints they came from, and reading the
      positions back by index drew the steep bands over the wrong stretch. */
  fromAlong: number;
  toAlong: number;
  distanceM: number;
  /** Height at the end less height at the start; negative is a descent. */
  riseM: number;
  ascentM: number;
  /** Average gradient, as a fraction. Negative downhill. */
  gradient: number;
  /** The steepest 200m inside it, or null when it is shorter than that. */
  worstGradient: number | null;
  steepness: Steepness;
  downhill: boolean;
}

/**
 * How hard a stretch is, from its average gradient.
 *
 * Not from the steepest sample in it. The model is 90m to a sample, so a single
 * step of it is as likely to be the model's own noise as a cliff, and grading
 * that way called the descent off 백운대 "steep uphill" on the strength of one
 * 18% rise inside a 300m drop.
 *
 * Uphill and downhill get the same thresholds and are kept apart by the caller,
 * because they are not the same work: 24% down off 백운대 is hard on the knees
 * and easy on the lungs, and one word for both tells a reader nothing about
 * which way round to walk the course.
 */
export function steepnessOf(gradient: number): Steepness {
  const up = Math.abs(gradient);
  if (up < 0.05) return "flat";
  if (up < 0.12) return "gentle";
  if (up < 0.22) return "moderate";
  if (up < 0.35) return "steep";
  return "severe";
}

/** The steepest run of at least `window` metres, or null if there is none. */
export function steepestRun(within: ProfilePoint[], window = 200): number | null {
  let worst: number | null = null;
  for (let i = 0; i < within.length; i++) {
    for (let j = i + 1; j < within.length; j++) {
      const run = within[j].along - within[i].along;
      if (run < window) continue;
      const slope = Math.abs(within[j].elevation - within[i].elevation) / run;
      worst = worst === null ? slope : Math.max(worst, slope);
      break;
    }
  }
  return worst;
}

/** The stretch between each pair of named points, and what it asks of a walker. */
export function sectionsOf(
  profile: CourseProfile,
  names: string[],
  waypointAlong: number[],
): CourseSection[] {
  const out: CourseSection[] = [];
  for (let i = 1; i < waypointAlong.length; i++) {
    const from = waypointAlong[i - 1];
    const to = waypointAlong[i];
    const within = profile.points.filter((point) => point.along >= from && point.along <= to);
    if (within.length < 2 || to <= from) continue;

    const riseM = within[within.length - 1].elevation - within[0].elevation;
    let ascentM = 0;
    for (let k = 1; k < within.length; k++) {
      const step = within[k].elevation - within[k - 1].elevation;
      if (step > 0) ascentM += step;
    }
    const gradient = riseM / (to - from);
    out.push({
      from: names[i - 1] ?? "",
      to: names[i] ?? "",
      fromAlong: from,
      toAlong: to,
      distanceM: to - from,
      riseM,
      ascentM,
      gradient,
      worstGradient: steepestRun(within),
      steepness: steepnessOf(gradient),
      downhill: riseM < 0,
    });
  }
  return out;
}

/**
 * How long a stretch the colour of the chart is decided over.
 *
 * The heights are a 90m model, so a shorter window colours its own noise: two
 * samples 90m apart can differ by a few metres of model error alone, which is
 * several per cent of gradient out of nothing. 250m is three samples, long
 * enough that a band means the ground and short enough to find the one pitch
 * inside a two-kilometre climb.
 */
export const BAND_WINDOW_M = 250;

/**
 * The shortest stretch worth giving a colour of its own.
 *
 * Fifteen bands on a six-kilometre course is a chart that changes colour every
 * few millimetres, and a reader cannot hold that many pieces at once - it reads
 * as texture rather than as information. A band has to be long enough to be a
 * part of the walk somebody would describe: "the first kilometre is flat", not
 * "there is a level step at 2.85".
 *
 * Shorter ones are not dropped. They are folded into whichever neighbour they
 * are nearer in gradient, and the grade of that neighbour is worked out again
 * over the whole of it, so the colour still comes from the ground.
 */
export const MIN_BAND_M = 500;

export interface GradientBand {
  fromAlong: number;
  toAlong: number;
  /** Signed, so a caller can still tell a climb from a descent. */
  gradient: number;
  /** Graded on the size of it: a 30% descent is not easy because it is downhill. */
  steepness: Steepness;
}

/**
 * The course cut into stretches of one difficulty each.
 *
 * Between the named points is the wrong unit for colour - 대서문 to 백운봉암문
 * is 2.6km and averages 21%, which says nothing about where inside it the
 * staircase is - and a per-sample colour is the model's noise in stripes. This
 * takes the gradient across a window, grades that, and merges neighbours that
 * came out the same, so a band is as long as the ground stays the same shape.
 */
export function gradientBands(
  profile: CourseProfile,
  window = BAND_WINDOW_M,
  minBand = MIN_BAND_M,
): GradientBand[] {
  const { points } = profile;
  if (points.length < 2) return [];

  const raw: GradientBand[] = [];
  let start = 0;
  for (let i = 1; i < points.length; i++) {
    const run = points[i].along - points[start].along;
    const last = i === points.length - 1;
    if (run < window && !last) continue;
    const gradient = run > 0 ? (points[i].elevation - points[start].elevation) / run : 0;
    raw.push({
      fromAlong: points[start].along,
      toAlong: points[i].along,
      gradient,
      steepness: steepnessOf(gradient),
    });
    start = i;
  }

  // One long climb should be one band, not a row of stripes, and a brief step
  // inside it should not break it into three. Grades that match are merged,
  // then the shortest band still under the minimum is folded into a neighbour,
  // and the two are alternated: folding can leave two neighbours at the same
  // grade, and those are one piece of walking however they came to be.
  let out = mergeByGrade(raw);
  while (out.length > 1) {
    let at = -1;
    for (let i = 0; i < out.length; i++) {
      if (out[i].toAlong - out[i].fromAlong >= minBand) continue;
      if (at === -1 || out[i].toAlong - out[i].fromAlong < out[at].toAlong - out[at].fromAlong) at = i;
    }
    if (at === -1) break;

    const before = out[at - 1];
    const after = out[at + 1];
    const gap = (other: GradientBand | undefined) =>
      other === undefined ? Infinity : Math.abs(other.gradient - out[at].gradient);
    // Into whichever neighbour the ground is more like. A short level step
    // between two climbs belongs to the gentler of them, not to whichever
    // happens to come first.
    if (gap(before) <= gap(after)) absorb(before, out[at]);
    else absorb(after!, out[at]);
    out.splice(at, 1);
    out = mergeByGrade(out);
  }
  return out;
}

/** Neighbouring stretches of the same grade, going the same way, as one. */
function mergeByGrade(bands: GradientBand[]): GradientBand[] {
  const out: GradientBand[] = [];
  for (const band of bands) {
    const previous = out[out.length - 1];
    if (previous && previous.steepness === band.steepness
      && Math.sign(previous.gradient) === Math.sign(band.gradient)) {
      absorb(previous, band);
      continue;
    }
    out.push({ ...band });
  }
  return out;
}

/** Grows `keep` to cover `extra`, re-grading it over the whole span. */
function absorb(keep: GradientBand, extra: GradientBand): void {
  const rise = keep.gradient * (keep.toAlong - keep.fromAlong)
    + extra.gradient * (extra.toAlong - extra.fromAlong);
  keep.fromAlong = Math.min(keep.fromAlong, extra.fromAlong);
  keep.toAlong = Math.max(keep.toAlong, extra.toAlong);
  const span = keep.toAlong - keep.fromAlong;
  keep.gradient = span > 0 ? rise / span : keep.gradient;
  keep.steepness = steepnessOf(keep.gradient);
}

/**
 * Which row each label goes on so that none sits on top of its neighbour.
 *
 * 백운대 and 백운봉암문 are 340m apart on a 5.8km course - a twentieth of the
 * width - and side by side on one line they overlapped and were cut off, which
 * left two names on the chart that could not be read.
 *
 * Positions are fractions of the width, and a label is assumed to take `width`
 * of it; a name needs that much clear space either side of its centre. Walking
 * left to right, each label takes the highest row that is free at its position.
 * Anything that would need a row past `rows` is dropped rather than stacked out
 * of sight - on a chart this size that means the names were too crowded to be
 * read anyway.
 */
export function stackLabels(
  positions: number[],
  width = 0.13,
  rows = 3,
): (number | null)[] {
  const lastEnd = new Array<number>(rows).fill(-Infinity);
  const order = positions.map((at, index) => ({ at, index })).sort((a, b) => a.at - b.at);
  const out = new Array<number | null>(positions.length).fill(null);
  for (const { at, index } of order) {
    const from = at - width / 2;
    const row = lastEnd.findIndex((end) => end <= from);
    if (row === -1) continue;
    lastEnd[row] = at + width / 2;
    out[index] = row;
  }
  return out;
}
