import { isClimbingQuestion } from "@/lib/assistant/intent";
import type { ActivityType, ClimbingStyle, LocationType } from "@/types/database";

// Shared by the form, the panel rows and the detail header. Kept in its own
// module so hike-detail.tsx can use it without importing side-panel.tsx,
// which already imports hike-detail.tsx.
export const ACTIVITY_TYPES: ActivityType[] = [
  "hiking",
  "indoor_climbing",
  "outdoor_wall",
  "climbing",
];

export const ACTIVITY_LABEL: Record<ActivityType, string> = {
  // 워킹 rather than 산. Every one of these happens on a mountain, so "산"
  // named the thing they have in common instead of the thing that tells them
  // apart - which is whether the day is spent walking or on rock.
  hiking: "워킹",
  indoor_climbing: "실내암장",
  outdoor_wall: "외벽",
  // 암벽등반 rather than 등반. On a filter row beside 산, 실내암장 and 외벽 -
  // all of which are climbing in a climbing club - "등반" named the category
  // its neighbours belong to as well, and said nothing about what makes this
  // one different, which is that it is on real rock outdoors.
  climbing: "암벽등반",
};

// 외벽 and 암벽등반 are still easy to mix up, so the picker spells out which is
// which: an artificial outdoor wall (뚝섬 등) versus real rock.
export const ACTIVITY_HINT: Record<ActivityType, string> = {
  hiking: "등산로를 걷는 산행",
  indoor_climbing: "실내 클라이밍장",
  outdoor_wall: "실외 인공 암벽",
  climbing: "자연 암벽",
};

/**
 * A finer tag on a 암벽등반 hike, optional, not its own activity.
 *
 * This used to be locations.type - a crag was made its own place because it
 * needed *some* way to say "this is a wall of pitches" versus "this is a
 * short hard line". That place-level split is what got merged away (인수봉
 * back into 북한산, see needsOwnSpot's history), because course_library
 * already groups by mountain and a second place for the same feature just
 * gave a member two names to choose between. The distinction itself was
 * real, though, so it moved to where it always actually described something -
 * the climb, not the mountain hosting it. 북한산 can hold both kinds now, the
 * way it always could, just without a folder for each.
 */
export const CLIMBING_STYLES: ClimbingStyle[] = ["multi_pitch", "hard_free"];

export const CLIMBING_STYLE_LABEL: Record<ClimbingStyle, string> = {
  multi_pitch: "멀티피치",
  hard_free: "하드프리",
};

// One colour vocabulary shared by the map markers and the list badges, so a
// dot on the map and a badge in the panel mean the same thing. None of these
// is red: red belongs to the selected activity's own pin.
export const ACTIVITY_COLOR: Record<ActivityType, string> = {
  hiking: "#3F7D5C", // forest green
  indoor_climbing: "#3D6E86", // slate blue
  outdoor_wall: "#C4622D", // burnt orange
  climbing: "#7A4F79", // plum
};

export const MIXED_ACTIVITY_COLOR = "#7C8A72"; // neutral grey

/**
 * A folder marker only takes an activity colour when the folder speaks with
 * one voice. 북한산 holds both 산행 and 등반, and calling it green because the
 * hikes happen to outnumber the climbs would be a guess dressed as a fact, so
 * a mixed folder - like an empty one - goes grey and lets the list say the rest.
 */
export function folderMarkerColor(activityTypes: ActivityType[]): string {
  const distinct = new Set(activityTypes);
  if (distinct.size !== 1) return MIXED_ACTIVITY_COLOR;
  return ACTIVITY_COLOR[[...distinct][0]];
}

/**
 * Whether an activity of this kind sits somewhere other than the folder pin.
 *
 * 대청봉 and 울산바위 are different points inside 설악산, so a hike or a climb
 * earns its own marker. A gym session or a session on an artificial wall
 * happens at the venue itself - its marker would land exactly on the folder's,
 * so it never gets one.
 */
export const ACTIVITY_HAS_OWN_SPOT: Record<ActivityType, boolean> = {
  hiking: true,
  climbing: true,
  indoor_climbing: false,
  outdoor_wall: false,
};

/**
 * Whether a hike being filed under this location still needs its own pin.
 *
 * ACTIVITY_HAS_OWN_SPOT alone answers "does this kind of outing usually get
 * its own marker", and that is right for the 인수봉-inside-북한산 case the
 * comment above describes - a `mountain` folder is broad enough to hold many
 * distinct peaks and faces, so a hike or climb filed there needs a second pin
 * to say which one. It stopped being right the moment a climb could be filed
 * directly under 인수봉 itself, or under 삼성산 숨은암장: those locations do
 * not host several distinct peaks the way 북한산 does - each one *is* the
 * specific place, down to its own coordinates on the folder pin - and asking
 * for a second search there was asking a member to re-locate somewhere they
 * had already navigated to by opening that folder. That search box used
 * Google Places, same as the folder search one screen up, and neither of them
 * knew about the other - two searches, in two forms, hunting the same point.
 *
 * `mountain` is the only location type broad enough that a second pin still
 * disambiguates anything; every other type already names one specific place.
 */
export function needsOwnSpot(activityType: ActivityType, locationType: LocationType): boolean {
  return ACTIVITY_HAS_OWN_SPOT[activityType] && locationType === "mountain";
}

/**
 * The activity a new hike under this location most likely is.
 *
 * A default, not a rule - a mountain can carry a climb (북한산 holds 인수봉)
 * and the picker is never locked to it. But 멀티피치 and 하드프리 are crag
 * subtypes with no reading other than climbing, and picking 워킹 first for a
 * hike filed under one of those was the actual bug report: the form always
 * opened on 워킹 regardless of where it was, so every climb had to be
 * reselected by hand.
 */
export const DEFAULT_ACTIVITY_FOR_LOCATION: Record<LocationType, ActivityType> = {
  mountain: "hiking",
  climbing_gym: "indoor_climbing",
  crag: "outdoor_wall",
  multi_pitch: "climbing",
  hard_free: "climbing",
};

/** A gym, however the sentence gets around to saying so. */
const INDOOR = /실내|클라이밍\s*장|암장|볼더링\s*장|더클라임|짐/;
/** Bolted concrete rather than rock: 뚝섬, 인공암벽장, a wall at a park. */
const OUTDOOR_WALL = /인공\s*암벽|외벽|암벽\s*장/;

/**
 * What kind of outing a course is, read from how it is described.
 *
 * An album made from a suggested course was filed as 산 whatever the course
 * was, and 인수봉 고독길 어프로치 - a walk in to the foot of a rock route -
 * landed in the hiking folder beside the trails to 백운대. The mountain in the
 * question is not the answer: this club goes to 북한산 to climb as often as to
 * walk, and 어프로치, 등반 and 암벽 are the words that say which.
 *
 * Indoors is checked first because 실내 암벽 would otherwise be read as rock,
 * and an artificial wall before real rock for the same reason. What is left
 * that mentions climbing at all is 암벽등반; what mentions none of it is 산.
 */
export function activityForCourse(...text: (string | null | undefined)[]): ActivityType {
  const said = text.filter(Boolean).join(" ");
  if (!said.trim()) return "hiking";
  if (INDOOR.test(said)) return "indoor_climbing";
  if (OUTDOOR_WALL.test(said)) return "outdoor_wall";
  return isClimbingQuestion(said) ? "climbing" : "hiking";
}

/**
 * The places to show under one activity, with only that activity's outings.
 *
 * The filter used to narrow the places and not what is inside them: a place
 * passed if any one of its outings matched, and then every outing it had was
 * drawn. 북한산 holds a walk and a climb, so 워킹 and 암벽등반 both listed both -
 * which is no filter at all, and put 인수봉 고독길 어프로치 in the walking tab.
 *
 * A place with nothing left after narrowing drops out. Not under "all", where
 * a place with no outings yet is still a folder worth seeing.
 */
export function withActivity<
  H extends { activityType: ActivityType },
  L extends { hikes: H[] },
>(locations: L[], activity: ActivityType | "all"): L[] {
  if (activity === "all") return locations;
  return locations
    .map((location) => ({
      ...location,
      hikes: location.hikes.filter((hike) => hike.activityType === activity),
    }))
    .filter((location) => location.hikes.length > 0);
}

/**
 * A mountain's own hikes, sorted into their activity - 워킹, 암벽등반 and the
 * rest each their own group, in ACTIVITY_TYPES order.
 *
 * This is the reason a mountain is now one location and not several: 삼성산
 * folding 워킹 and 등반 into the same folder was the point, not a side effect
 * to route around - the whole reason activityType exists is so climbing can
 * be gathered and read at a glance regardless of which mountain it happened
 * on, and the site-wide 활동 필터 already does exactly that across every
 * mountain at once. What it did not do is the same thing one level down:
 * inside a single mountain's own screen, every hike sat in one flat list with
 * only a small coloured tag telling 워킹 apart from 등반, so opening 삼성산
 * with both on file showed one undifferentiated pile rather than two things
 * a member came to compare.
 *
 * Groups with nothing in them are left out rather than returned empty, so a
 * mountain that only ever hosts one kind of outing - or a screen already
 * narrowed by the site-wide filter to one activity - naturally comes back as
 * a single group, and the caller can read "one group" as "skip the heading".
 */
export function groupHikesByActivity<H extends { activityType: ActivityType }>(
  hikes: H[],
): { type: ActivityType; hikes: H[] }[] {
  const byType = new Map<ActivityType, H[]>();
  for (const hike of hikes) {
    const group = byType.get(hike.activityType);
    if (group) group.push(hike);
    else byType.set(hike.activityType, [hike]);
  }
  return ACTIVITY_TYPES
    .filter((type) => byType.has(type))
    .map((type) => ({ type, hikes: byType.get(type)! }));
}
