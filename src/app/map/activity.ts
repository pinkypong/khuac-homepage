import type { ActivityType } from "@/types/database";

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
  hiking: "산",
  indoor_climbing: "실내암장",
  outdoor_wall: "외벽",
  climbing: "등반",
};

// 외벽 and 등반 are easy to mix up, so the picker spells out which is which:
// an artificial outdoor wall (뚝섬 등) versus real rock.
export const ACTIVITY_HINT: Record<ActivityType, string> = {
  hiking: "등산",
  indoor_climbing: "실내 클라이밍장",
  outdoor_wall: "실외 인공 암벽",
  climbing: "자연 암벽",
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
