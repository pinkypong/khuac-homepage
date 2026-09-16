/**
 * What a suggested course knew about itself, apart from where it goes.
 *
 * Where it goes is already held properly: route_waypoints has the named points
 * with coordinates, and track has the line. What was left over - how long it
 * takes, how hard it is, what to watch for - was being written into the album's
 * description as prose, together with a second copy of the waypoints, which
 * left nothing readable and no room for the member's own notes.
 */
export interface CourseInfo {
  /** As the answer wrote it: "약 6.6km". Only shown where nothing was measured;
      a drawn line is the better number and the profile under the map has it. */
  distanceText?: string | null;
  durationText?: string | null;
  difficulty?: string | null;
  /** The caveats - 비법정탐방로, 예약 필요, 낙석 - which are the part of a
      course answer a member most needs and the part geometry cannot supply. */
  notes?: string | null;
  sources?: { url: string; label: string }[];
}

const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

/** Reads a stored value back, keeping only the shape this knows. */
export function asCourseInfo(value: unknown): CourseInfo | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const info: CourseInfo = {
    distanceText: text(row.distanceText),
    durationText: text(row.durationText),
    difficulty: text(row.difficulty),
    notes: text(row.notes),
    sources: Array.isArray(row.sources)
      ? row.sources.flatMap((source) => {
        const entry = source as Record<string, unknown>;
        const url = text(entry?.url);
        return url ? [{ url, label: text(entry?.label) ?? url }] : [];
      })
      : [],
  };
  return hasAnything(info) ? info : null;
}

export function hasAnything(info: CourseInfo): boolean {
  return Boolean(info.distanceText || info.durationText || info.difficulty
    || info.notes || info.sources?.length);
}

/**
 * The same fields read back out of an album written before they were fields.
 *
 * Those albums hold one string: the waypoints as a sentence, then whatever
 * lines the answer gave for distance and notes. The waypoint line is dropped
 * rather than parsed - route_waypoints already holds those points, with
 * coordinates, and the sentence is the copy worth losing.
 */
export function courseInfoFromDescription(description: string | null | undefined): {
  info: CourseInfo | null;
  /** Whatever was not the course: the member's own words, if any were there. */
  rest: string | null;
} {
  if (!description) return { info: null, rest: null };
  const lines = description.split("\n").map((line) => line.trim()).filter(Boolean);
  const kept: string[] = [];
  const info: CourseInfo = {};

  for (const line of lines) {
    if (/^AI 추천 코스\s*:/.test(line)) continue;
    if (!info.distanceText && /^약?\s*[\d.]+\s*km/i.test(line)) {
      info.distanceText = line;
      continue;
    }
    if (!info.durationText && /\d\s*시간|\d\s*분/.test(line) && line.length <= 60) {
      info.durationText = line;
      continue;
    }
    kept.push(line);
  }
  // Anything left is prose the answer wrote about the course rather than
  // anything a member typed - these albums were made before the box existed -
  // so it becomes the notes rather than the description.
  if (kept.length > 0) info.notes = kept.join("\n");
  return { info: hasAnything(info) ? info : null, rest: null };
}
