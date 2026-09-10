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
