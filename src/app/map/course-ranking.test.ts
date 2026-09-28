import { describe, expect, it } from "vitest";
import { rankAlbumCourses } from "./course-ranking";

const course = (name: string, waypoints: string[], origin: string) => ({ name, waypoints, origin });

describe("album course ranking", () => {
  it("offers approaches to the named climbing destination ahead of trusted summit walks", () => {
    const summit = course("백운대 정상 탐방", ["백운탐방지원센터", "백운대"], "gpx");
    const walk = course("북한산 둘레길", ["인수봉 전망대"], "knps");
    const approach = course("인수봉 고독길 어프로치", ["북한산우이역", "하루재", "인수봉 고독길 들머리"], "club");
    const sorted = rankAlbumCourses([summit, walk, approach], {
      locationName: "인수봉", locationType: "multi_pitch", activityType: "climbing", query: "",
    });
    expect(sorted).toEqual([approach, walk, summit]);
  });

  it("keeps trusted routes above unverified alternatives for the same goal", () => {
    const club = course("인수봉 어프로치", ["우이역", "인수봉 들머리"], "club");
    const search = course("인수봉 어프로치", ["도선사", "인수봉 들머리"], "search");
    expect(rankAlbumCourses([search, club], {
      locationName: "인수봉", locationType: "multi_pitch", activityType: "climbing", query: "",
    })[0]).toBe(club);
  });

  it("respects explicit search and keeps broad mountain walks available", () => {
    const summit = course("백운대 정상 탐방", ["백운대"], "knps");
    const approach = course("인수봉 고독길 어프로치", ["하루재", "인수봉 들머리"], "club");
    const options = { locationName: "북한산", locationType: "mountain" as const, activityType: "climbing" as const };
    expect(rankAlbumCourses([summit, approach], { ...options, query: "" })).toEqual([approach, summit]);
    expect(rankAlbumCourses([summit, approach], { ...options, query: "백운대" })).toEqual([summit]);
  });
});
