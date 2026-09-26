import { describe, expect, it } from "vitest";
import { activityForCourse, groupHikesByActivity, needsOwnSpot, withActivity } from "./activity";
import type { ActivityType } from "@/types/database";

describe("activityForCourse", () => {
  it("files an approach as rock climbing, not as a walk", () => {
    // The case that went wrong: a walk in to the foot of a rock route landed
    // in the hiking folder beside the trails to 백운대.
    expect(activityForCourse("인수봉 고독길 어프로치 루트 알려줘")).toBe("climbing");
    expect(activityForCourse(null, "우이동 도선사 최단 어프로치 코스")).toBe("climbing");
  });

  it("reads the climb out of any part of what was said", () => {
    // The word that settles it turns up somewhere different each time.
    expect(activityForCourse("북한산 코스 추천", "선인봉 남측 코스")).toBe("hiking");
    expect(activityForCourse("북한산 코스 추천", null, null, "암벽 구간이 있습니다")).toBe("climbing");
    expect(activityForCourse(null, "인수봉 릿지 코스")).toBe("climbing");
  });

  it("keeps the mountain from deciding on its own", () => {
    // 북한산 is walked and climbed; the mountain is not the answer.
    expect(activityForCourse("북한산 쉬운 코스 추천해줘", "우이령길 코스")).toBe("hiking");
    expect(activityForCourse("북한산 인수봉 등반 루트", "인수봉 코스")).toBe("climbing");
  });

  it("tells a gym and a built wall apart from real rock", () => {
    expect(activityForCourse("실내 암벽 어디가 좋아")).toBe("indoor_climbing");
    expect(activityForCourse("더클라임 강남점 가자")).toBe("indoor_climbing");
    expect(activityForCourse("뚝섬 인공암벽 등반")).toBe("outdoor_wall");
  });

  it("leaves an ordinary walk alone", () => {
    expect(activityForCourse("북한산 쉬운 코스 추천해줘")).toBe("hiking");
    expect(activityForCourse("도봉산 다락능선", "도봉탐방지원센터 → 신선대")).toBe("hiking");
    expect(activityForCourse()).toBe("hiking");
    expect(activityForCourse("", null, undefined)).toBe("hiking");
  });
});

describe("withActivity", () => {
  const place = (name: string, ...kinds: ActivityType[]) => ({
    name, hikes: kinds.map((activityType, i) => ({ activityType, id: `${name}-${i}` })),
  });

  it("keeps only that activity's outings inside a place", () => {
    // 북한산 holds a walk and a climb. Filtering to one used to list both,
    // which put 인수봉 고독길 어프로치 in the walking tab.
    const [bukhan] = withActivity([place("북한산", "hiking", "climbing")], "climbing");
    expect(bukhan.hikes.map((h) => h.activityType)).toEqual(["climbing"]);
  });

  it("drops a place with nothing of that activity", () => {
    const out = withActivity([place("북한산", "hiking"), place("도봉산", "climbing")], "climbing");
    expect(out.map((p) => p.name)).toEqual(["도봉산"]);
  });

  it("leaves everything alone under all, including a place with no outings", () => {
    const places = [place("북한산", "hiking", "climbing"), place("관악산")];
    const out = withActivity(places, "all");
    expect(out).toEqual(places);
    expect(out[1].hikes).toHaveLength(0);
  });

  it("tells the two indoor kinds apart from rock", () => {
    const places = [place("더클라임", "indoor_climbing"), place("뚝섬", "outdoor_wall"), place("인수봉", "climbing")];
    expect(withActivity(places, "indoor_climbing").map((p) => p.name)).toEqual(["더클라임"]);
    expect(withActivity(places, "outdoor_wall").map((p) => p.name)).toEqual(["뚝섬"]);
    expect(withActivity(places, "climbing").map((p) => p.name)).toEqual(["인수봉"]);
  });
});

describe("needsOwnSpot", () => {
  it("still asks for a spot when climbing or hiking under a mountain", () => {
    // 인수봉's climbs are filed under 북한산 now, exactly like 대청봉's hikes
    // are filed under 설악산 - both need their own pin to say which peak.
    expect(needsOwnSpot("climbing", "mountain")).toBe(true);
    expect(needsOwnSpot("hiking", "mountain")).toBe(true);
  });

  it("never asks at a gym or an artificial wall, mountain reasoning or not", () => {
    expect(needsOwnSpot("indoor_climbing", "climbing_gym")).toBe(false);
    expect(needsOwnSpot("outdoor_wall", "crag")).toBe(false);
  });

  it("does not ask at a venue even for an activity that would ask on a mountain", () => {
    // Nobody files a 산행 at a climbing gym, but the rule should not depend
    // on that - the venue itself is the answer to "where", not a second pin.
    expect(needsOwnSpot("climbing", "climbing_gym")).toBe(false);
    expect(needsOwnSpot("hiking", "crag")).toBe(false);
  });
});

describe("groupHikesByActivity", () => {
  const hike = (activityType: ActivityType, name: string) => ({ activityType, name });

  it("keeps 워킹 and 등반 apart under one mountain", () => {
    // 삼성산's whole reason for holding both: opening it should show two
    // things to compare, not one pile with a tag on each row.
    const hikes = [hike("hiking", "정기산행"), hike("climbing", "숨은암장 등반"), hike("hiking", "가족산행")];
    const groups = groupHikesByActivity(hikes);
    expect(groups.map((g) => g.type)).toEqual(["hiking", "climbing"]);
    expect(groups[0].hikes.map((h) => h.name)).toEqual(["정기산행", "가족산행"]);
    expect(groups[1].hikes.map((h) => h.name)).toEqual(["숨은암장 등반"]);
  });

  it("orders groups by ACTIVITY_TYPES regardless of input order", () => {
    const hikes = [hike("climbing", "a"), hike("hiking", "b")];
    expect(groupHikesByActivity(hikes).map((g) => g.type)).toEqual(["hiking", "climbing"]);
  });

  it("comes back as one group when only one activity is on file", () => {
    // The caller reads this as "skip the section heading" - a mountain with
    // only 워킹 so far, or a screen already narrowed by the site filter.
    const groups = groupHikesByActivity([hike("hiking", "a"), hike("hiking", "b")]);
    expect(groups).toHaveLength(1);
    expect(groups[0].hikes).toHaveLength(2);
  });

  it("returns nothing for an empty list, not an empty group", () => {
    expect(groupHikesByActivity([])).toEqual([]);
  });
});
