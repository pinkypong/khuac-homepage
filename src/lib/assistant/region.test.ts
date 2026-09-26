import { describe, expect, it } from "vitest";
import { groupByMountain, pickMountainGroup, placesOf, regionWords, type Placed } from "./region";

/** Regions exactly as the two sources write them, copied from course_library. */
const 지리산_공단 = "경상남도 함양군";
const 지리산_산림청 = "전라북도 남원시, 전라남도 구례군, 경상남도 하동군ㆍ산청군ㆍ함양군";
const 지리산_사량도 = "경상남도 통영시 사량면";
const 가야산_합천 = "경상남도 합천군ㆍ거창군, 경상북도 성주군";
const 가야산_서산 = "충청남도 서산시 운산면·예산군 덕산면";
const 가야산_광양 = "전남 광양시 옥곡면";
const 무등산_산림청 = "광주광역시 동구, 전라남도 담양군 남면ㆍ화순군 이서면";
const 무등산_공단 = "전남광주통합특별시 북구";
const 태화산_경기 = "경기도 광주시 도척면";
const 태화산_영월 = "강원도 영월군 영월읍, 충청북도 단양군 영춘면";

const row = (mountain: string, region: string | null): Placed => ({ mountain, region });
const places = (group: { places: Set<string> }) => [...group.places].sort();

describe("placesOf", () => {
  it("qualifies a district by its province", () => {
    expect(placesOf("경상남도 합천군")).toEqual(["경남/합천군"]);
  });

  it("reads every district a mountain spans", () => {
    expect(placesOf(지리산_산림청).sort()).toEqual([
      "경남/산청군",
      "경남/하동군",
      "경남/함양군",
      "전남광주/구례군",
      "전북/남원시",
    ]);
  });

  it("spells one province the same however the source wrote it", () => {
    // 산림청 writes 전남, OSM writes the merged name, both mean one province.
    expect(placesOf("전남 광양시 옥곡면")).toEqual(["전남광주/광양시"]);
    expect(placesOf("전라남도 광양시")).toEqual(["전남광주/광양시"]);
  });

  it("folds a borough into its city, because a mountain crosses borough lines", () => {
    // 무등산 stands in 동구 and 북구; comparing boroughs would split it in two.
    expect(placesOf(무등산_공단)).toEqual(["전남광주/광주"]);
    expect(placesOf(무등산_산림청).sort()).toEqual([
      "전남광주/광주",
      "전남광주/담양군",
      "전남광주/화순군",
    ]);
  });

  it("keeps 경기도 광주시 apart from the 광주 in 전남광주", () => {
    // 107km apart, with a 태화산 near each.
    expect(placesOf(태화산_경기)).toEqual(["경기/광주시"]);
    expect(placesOf(태화산_경기)).not.toContain("전남광주/광주");
  });

  it("has nothing to say about a row with no region", () => {
    expect(placesOf(null)).toEqual([]);
    expect(placesOf("")).toEqual([]);
  });
});

describe("groupByMountain", () => {
  it("joins one mountain written down differently by two sources", () => {
    // The park names the single district its survey centres on; 산림청 names
    // every district the mountain spans. They share 함양군.
    const groups = groupByMountain([row("지리산", 지리산_공단), row("지리산", 지리산_산림청)]);
    expect(groups).toHaveLength(1);
    expect(groups[0].rows).toHaveLength(2);
  });

  it("keeps the 지리산 on 사량도 separate from the national park", () => {
    const groups = groupByMountain([
      row("지리산", 지리산_공단),
      row("지리산", 지리산_산림청),
      row("지리산", 지리산_사량도),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups.map((group) => group.rows.length).sort()).toEqual([1, 2]);
  });

  it("separates the three 가야산", () => {
    const groups = groupByMountain([
      row("가야산", 가야산_합천),
      row("가야산", 가야산_서산),
      row("가야산", 가야산_광양),
    ]);
    expect(groups).toHaveLength(3);
  });

  it("joins 무등산 across the 2026-07-01 merger and across boroughs", () => {
    const groups = groupByMountain([row("무등산", 무등산_산림청), row("무등산", 무등산_공단)]);
    expect(groups).toHaveLength(1);
    expect(places(groups[0])).toContain("전남광주/광주");
  });

  it("separates the two 태화산 by province", () => {
    expect(groupByMountain([row("태화산", 태화산_경기), row("태화산", 태화산_영월)])).toHaveLength(2);
  });

  it("gives a region-less row the only mountain of its name", () => {
    const groups = groupByMountain([row("설악산", "강원특별자치도 인제군"), row("설악산", null)]);
    expect(groups).toHaveLength(1);
    expect(groups[0].rows).toHaveLength(2);
  });

  it("leaves region-less rows out when the name is shared", () => {
    // 가야산's park courses are in 합천, and joining them to whichever group
    // came back first put them in 서산.
    const groups = groupByMountain([
      row("가야산", 가야산_서산),
      row("가야산", 가야산_합천),
      row("가야산", null),
      row("가야산", null),
    ]);
    expect(groups).toHaveLength(3);
    const unknown = groups.find((group) => group.places.size === 0);
    expect(unknown?.rows).toHaveLength(2);
  });

  it("keeps region-less rows of one mountain together", () => {
    // One group each split 지리산 into fifty-three mountains.
    const groups = groupByMountain([
      row("지리산", 지리산_산림청),
      row("지리산", 지리산_사량도),
      ...Array.from({ length: 51 }, () => row("지리산", null)),
    ]);
    expect(groups).toHaveLength(3);
    expect(groups.find((group) => group.places.size === 0)?.rows).toHaveLength(51);
  });

  it("does not mix two mountains that share no district", () => {
    const groups = groupByMountain([
      row("백운산", "충북 제천시 백운면"),
      row("백운산", "강원도 정선군 신동읍, 평창군 미탄면"),
      row("백운산", "경기도 포천시 이동면, 강원도 화천군 사내면"),
      row("백운산", "전라남도 광양시 봉강면ㆍ옥룡면, 구례군 간전면"),
    ]);
    expect(groups).toHaveLength(4);
  });
});

describe("regionWords", () => {
  it("offers the bare name a member would type", () => {
    expect(regionWords("경상남도 거제시 신현읍")).toContain("거제");
  });

  it("offers both spellings of a province", () => {
    expect(regionWords("전라남도 광양시")).toContain("전남");
  });
});

describe("pickMountainGroup", () => {
  const row = (region: string | null) => ({ mountain: "삼성산", region });

  it("does not hand a lone candidate to a folder in another district", () => {
    // The actual row in course_library, and the club's folder.
    const groups = groupByMountain([row("경상북도 경산시 남산면")]);
    expect(pickMountainGroup(groups, "서울특별시 관악구, 경기도 안양시")).toBeNull();
  });

  it("picks the group that shares a district once both are on file", () => {
    const groups = groupByMountain([row("경상북도 경산시 남산면"), row("서울특별시 관악구, 경기도 안양시")]);
    expect(pickMountainGroup(groups, "경기도 안양시")?.places.has("경기/안양시")).toBe(true);
  });

  it("still takes a lone candidate when the folder names no district", () => {
    // 북한산's folder says only "서울" - nothing to compare, so the shortcut stands.
    const groups = groupByMountain([{ mountain: "북한산", region: "경기도 고양시 덕양구" }]);
    expect(pickMountainGroup(groups, "서울")).toBe(groups[0]);
  });

  it("still takes a lone candidate whose rows name no district", () => {
    const groups = groupByMountain([row(null)]);
    expect(pickMountainGroup(groups, "경기도 안양시")).toBe(groups[0]);
  });

  it("returns null when nothing is on file", () => {
    expect(pickMountainGroup([], "경기도 안양시")).toBeNull();
  });
});

describe("pickMountainGroup with a folder that names no province", () => {
  it("matches 한라산's folder, written without 제주, to its courses", () => {
    // Measured on the real rows: a strict comparison dropped all eleven.
    const groups = groupByMountain([
      { mountain: "한라산", region: "제주특별자치도 제주시" },
      { mountain: "한라산", region: "제주특별자치도 서귀포시" },
    ]);
    expect(pickMountainGroup(groups, "서귀포시 한라산")).not.toBeNull();
  });

  it("still keeps a province the folder did name", () => {
    const groups = groupByMountain([
      { mountain: "태화산", region: "경기도 광주시" },
      { mountain: "태화산", region: "충청북도 단양군" },
    ]);
    expect(pickMountainGroup(groups, "전라남도 광주시")).toBeNull();
  });
});
