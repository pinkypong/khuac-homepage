import { describe, expect, it } from "vitest";
import { asCourseInfo, courseInfoFromDescription, hasAnything } from "./course-info";

describe("asCourseInfo", () => {
  it("keeps the fields it knows and drops the rest", () => {
    const info = asCourseInfo({
      distanceText: "약 6.6km", durationText: "약 4시간", difficulty: "중급",
      notes: "비법정탐방로", sources: [{ url: "https://a.kr", label: "a.kr" }],
      somethingElse: "무시",
    });
    expect(info).toMatchObject({
      distanceText: "약 6.6km", durationText: "약 4시간", difficulty: "중급", notes: "비법정탐방로",
    });
    expect(info?.sources).toEqual([{ url: "https://a.kr", label: "a.kr" }]);
    expect(info).not.toHaveProperty("somethingElse");
  });

  it("gives a source with no label its own address to stand on", () => {
    expect(asCourseInfo({ sources: [{ url: "https://a.kr" }] })?.sources)
      .toEqual([{ url: "https://a.kr", label: "https://a.kr" }]);
  });

  it("is null for anything that says nothing", () => {
    expect(asCourseInfo(null)).toBeNull();
    expect(asCourseInfo("약 6km")).toBeNull();
    expect(asCourseInfo([])).toBeNull();
    expect(asCourseInfo({})).toBeNull();
    expect(asCourseInfo({ distanceText: "   " })).toBeNull();
  });
});

describe("courseInfoFromDescription", () => {
  it("pulls the fields out of the one string an old album kept", () => {
    const { info } = courseInfoFromDescription(
      "AI 추천 코스: 밤골탐방지원센터 → 숨은벽능선 → 백운대\n약 6.6km\n약 4시간 30분\n숨은벽 능선은 비법정탐방로입니다");
    expect(info?.distanceText).toBe("약 6.6km");
    expect(info?.durationText).toBe("약 4시간 30분");
    expect(info?.notes).toBe("숨은벽 능선은 비법정탐방로입니다");
  });

  it("drops the waypoint sentence rather than parsing it", () => {
    // route_waypoints holds the same points with coordinates; the sentence is
    // the copy worth losing.
    const { info } = courseInfoFromDescription("AI 추천 코스: 가 → 나 → 다\n약 3km");
    expect(JSON.stringify(info)).not.toContain("→");
    expect(info?.notes).toBeUndefined();
  });

  it("has nothing to say about an empty or unrelated description", () => {
    expect(courseInfoFromDescription(null).info).toBeNull();
    expect(courseInfoFromDescription("").info).toBeNull();
    expect(courseInfoFromDescription("AI 추천 코스: 가 → 나").info).toBeNull();
  });

  it("keeps prose that is neither a distance nor a duration", () => {
    const { info } = courseInfoFromDescription("AI 추천 코스: 가 → 나\n낙석 주의\n예약 필요");
    expect(info?.notes).toBe("낙석 주의\n예약 필요");
  });
});

describe("hasAnything", () => {
  it("is false only when every field is empty", () => {
    expect(hasAnything({})).toBe(false);
    expect(hasAnything({ sources: [] })).toBe(false);
    expect(hasAnything({ difficulty: "중급" })).toBe(true);
  });
});
