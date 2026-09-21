import type { RouteSuggestion } from "@/lib/assistant/routes";
import type { KnownCourse } from "./route-album-actions";

/**
 * A library course in the shape the map already knows how to draw.
 *
 * The assistant's answers and the library's rows describe the same thing in two
 * vocabularies, and everything downstream - resolving the names to points,
 * snapping the line to real trails, the confirm bar, creating the album - is
 * written against the assistant's. So a course borrows that shape rather than
 * growing a second path through all of it, which is how the two would drift.
 *
 * Its own id travels as courseId, so an album made this way is filed as a walk
 * of that row rather than as an unlinked copy of it.
 */
export function courseToSuggestion(course: KnownCourse): RouteSuggestion {
  return {
    name: course.name,
    waypoints: course.waypoints,
    distanceText: course.distanceText,
    durationText: course.durationText,
    difficulty: course.difficulty,
    description: null,
    notes: null,
    sourceUrls: [],
    courseId: course.id,
  };
}
