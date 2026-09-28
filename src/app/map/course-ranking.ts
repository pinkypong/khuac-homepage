import type { ActivityType, LocationType } from "@/types/database";
import { rankOf } from "@/lib/assistant/origin";
import { activityForCourse } from "./activity";

type Course = {
  name: string;
  waypoints: string[];
  origin: string | null;
};

/** Rank existing library entries without pretending to know travel time or route safety. */
export function rankAlbumCourses<T extends Course>(
  courses: T[],
  { locationName, locationType, activityType, query }: {
    locationName: string; locationType: LocationType; activityType: ActivityType; query: string;
  },
): T[] {
  const term = query.trim().toLocaleLowerCase();
  const place = locationName.trim().toLocaleLowerCase();
  const scored = courses
    .map((course, index) => {
      const name = course.name.toLocaleLowerCase();
      const points = course.waypoints.map((point) => point.toLocaleLowerCase());
      if (term && !name.includes(term) && !points.some((point) => point.includes(term))) return null;

      const text = `${name} ${points.join(" ")}`;
      const placeMatch = place && (name.includes(place) || points.some((point) => point.includes(place)));
      const approach = /어프로치|들머리|접근로/.test(text);
      const fits = activityForCourse(course.name, ...course.waypoints) === activityType;
      // Search wording is intentional: if someone types a walking route while
      // "climbing" is selected, that named route should still be first.
      const queryMatch = term ? (name === term ? 2 : name.includes(term) ? 1 : 0) : 0;
      return {
        course, index, queryMatch,
        placeMatch: Number(Boolean(placeMatch)),
        fits: Number(fits),
        approach: Number(activityType === "climbing" && approach),
        // A station-named approach is often easier to use from Seoul, but
        // station mentions alone cannot tell us actual door-to-trail time.
        station: Number(activityType === "climbing" && approach && points.some((point) => /역(?:\s|$)/.test(point))),
        source: rankOf(course.origin),
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

  scored.sort((a, b) =>
    b.queryMatch - a.queryMatch
    // A named crag is more precise than a mountain folder: prioritize routes
    // that actually lead to it. On a broad mountain, prioritize the activity.
    || (locationType === "mountain" ? b.fits - a.fits : b.placeMatch - a.placeMatch)
    || (locationType === "mountain" ? b.placeMatch - a.placeMatch : b.fits - a.fits)
    || b.approach - a.approach
    || b.source - a.source
    || b.station - a.station
    || a.index - b.index);
  return scored.map(({ course }) => course);
}
