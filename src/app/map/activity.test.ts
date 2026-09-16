import { describe, expect, it } from "vitest";
import { activityForCourse } from "./activity";

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
