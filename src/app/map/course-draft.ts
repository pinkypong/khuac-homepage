/**
 * A course being edited, held above the panel that edits it.
 *
 * It started inside hike-detail, as ordinary component state, and twice went
 * missing mid-edit. The panel is not a safe place to keep it: HikeDetail is
 * reached through `visibleLocations`, which is `locations` filtered by the
 * activity tab and the search box, and then `activeHike` is looked up inside
 * that. Anything that disturbs the derivation - a refresh landing, the filter
 * changing, the album briefly not matching - makes SidePanel take a different
 * branch, and an unmounted component takes its draft with it. Adding a waypoint
 * means going to the map and back, which is exactly when that happens.
 *
 * So the draft lives in map-shell, beside the map-picking flags it works with,
 * and the panel edits it through props. That also lets a tapped point be added
 * where the tap is handled, instead of being handed down and applied by an
 * effect that could only work while the editor happened to be mounted.
 */
export interface CourseDraft {
  hikeId: string;
  /** The member's own memo. */
  description: string;
  /** In order. Every one carries its position; a new one gets it from the map. */
  waypoints: { name: string; lat: number; lng: number }[];
  distanceText: string;
  durationText: string;
  difficulty: string;
  notes: string;
}

/** Only what a draft is built from, so this module does not depend on map-shell. */
export interface DraftSource {
  id: string;
  description: string | null;
  routeWaypoints: { name: string; lat: number; lng: number }[] | null;
  courseInfo: {
    distanceText?: string | null;
    durationText?: string | null;
    difficulty?: string | null;
    notes?: string | null;
  } | null;
}

export function draftFromHike(hike: DraftSource): CourseDraft {
  return {
    hikeId: hike.id,
    description: hike.description ?? "",
    waypoints: (hike.routeWaypoints ?? []).map((point) => ({
      name: point.name ?? "", lat: point.lat, lng: point.lng,
    })),
    distanceText: hike.courseInfo?.distanceText ?? "",
    durationText: hike.courseInfo?.durationText ?? "",
    difficulty: hike.courseInfo?.difficulty ?? "",
    notes: hike.courseInfo?.notes ?? "",
  };
}

/**
 * The draft with one more point on the end, started from the album if there was
 * no draft yet - reaching the map can close the editor, and a tap that arrives
 * to find it closed should still land somewhere.
 */
export function withWaypoint(
  draft: CourseDraft | null,
  hike: DraftSource,
  point: { lat: number; lng: number },
): CourseDraft {
  const base = draft?.hikeId === hike.id ? draft : draftFromHike(hike);
  return { ...base, waypoints: [...base.waypoints, { name: "", lat: point.lat, lng: point.lng }] };
}
