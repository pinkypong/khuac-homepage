import { describe, expect, it } from "vitest";
import { findClubPoi, isPlausibleMatch, normalisePoiName, type ClubPoi } from "./poi";

const pois: ClubPoi[] = [
  {
    name: "해골바위",
    aliases: [],
    lat: 37.664,
    lng: 126.9672,
  },
  {
    name: "백운대탐방지원센터",
    aliases: ["도선사", "백운대 탐방지원센터"],
    lat: 37.6395,
    lng: 127.0112,
  },
];

describe("normalisePoiName", () => {
  it("ignores spacing, which answers use inconsistently", () => {
    expect(normalisePoiName("백운대 탐방지원센터")).toBe(normalisePoiName("백운대탐방지원센터"));
  });

  it("drops a bracketed aside, which is a second name not part of the first", () => {
    expect(normalisePoiName("백운대탐방지원센터(도선사)")).toBe("백운대탐방지원센터");
  });

  it("is case-insensitive for romanised names", () => {
    expect(normalisePoiName("Insubong")).toBe(normalisePoiName("insubong"));
  });
});

describe("findClubPoi", () => {
  it("finds a place the club has recorded", () => {
    expect(findClubPoi("해골바위", pois)?.lat).toBeCloseTo(37.664, 4);
  });

  it("finds it through an alias", () => {
    expect(findClubPoi("도선사", pois)?.lng).toBeCloseTo(127.0112, 4);
  });

  // How the assistant actually writes it.
  it("finds it through the bracketed form an answer uses", () => {
    expect(findClubPoi("백운대탐방지원센터(도선사)", pois)?.lng).toBeCloseTo(127.0112, 4);
  });

  // Guessing is the thing this table exists to stop, so a near-miss is a miss.
  it("refuses a name it does not hold rather than picking something close", () => {
    expect(findClubPoi("해골바위 능선", pois)).toBeNull();
    expect(findClubPoi("백운대", pois)).toBeNull();
    expect(findClubPoi("", pois)).toBeNull();
  });
});

describe("isPlausibleMatch", () => {
  it("rejects a different trailhead on the same mountain", () => {
    // What Places answered for a name it does not carry.
    expect(isPlausibleMatch("밤골탐방지원센터", "북한산성탐방지원센터", "북한산")).toBe(false);
  });

  it("accepts the same trailhead written differently", () => {
    expect(isPlausibleMatch("구기탐방지원센터", "구기 탐방지원센터", "북한산")).toBe(true);
    expect(isPlausibleMatch("정릉탐방지원센터", "북한산국립공원 정릉탐방지원센터", "북한산")).toBe(true);
    expect(isPlausibleMatch("백운대탐방지원센터(도선사)", "백운대 탐방지원센터", "북한산")).toBe(true);
  });

  it("accepts the mountain's name being added or dropped", () => {
    expect(isPlausibleMatch("대남문", "북한산 대남문", "북한산")).toBe(true);
    expect(isPlausibleMatch("도선사", "대한불교조계종 도선사", "북한산")).toBe(true);
  });

  it("accepts a name spelled one character differently", () => {
    // The same temple; answers write it both ways.
    expect(isPlausibleMatch("영추사", "영취사", "북한산")).toBe(true);
  });

  it("leaves a station named after the gate to the type rule", () => {
    // 북한산보국문역 really is named after 보국문, so the name alone cannot
    // tell them apart and should not pretend to. What rejects the station is
    // its place type, in suggested-route.tsx.
    expect(isPlausibleMatch("보국문", "북한산보국문역", "북한산")).toBe(true);
  });
});

describe("isPlausibleMatch, names that only share a leading run", () => {
  // A hermitage and a rock peak 375m apart, both on 북한산. They share their
  // first two characters and differ only in the third - 암 against 봉 - which
  // is exactly the shape a run-of-two-characters rule would wave through, and
  // did: Places was asked for 인수암 and this let it accept 인수봉 instead,
  // which is how the club's own map came to mean the peak whenever a member
  // typed the temple.
  it("rejects 인수암 and 인수봉, which share only a two-character prefix", () => {
    expect(isPlausibleMatch("인수암", "인수봉", "북한산")).toBe(false);
    expect(isPlausibleMatch("인수봉", "인수암", "북한산")).toBe(false);
  });

  // The general shape, not just this one pair: two three-character names, a
  // shared opening, a different ending. None of these are the same place.
  it("rejects other names that share a prefix and differ after it", () => {
    expect(isPlausibleMatch("원효봉", "원효사", "북한산")).toBe(false);
    expect(isPlausibleMatch("대남문", "대남산", "북한산")).toBe(false);
  });
});

describe("isPlausibleMatch, names that differ at the front", () => {
  it("rejects a name that dropped its qualifier", () => {
    // Opposite sides of 도봉산.
    expect(isPlausibleMatch("원도봉탐방지원센터", "도봉탐방지원센터", "도봉산")).toBe(false);
  });

  it("accepts a name shortened from the end", () => {
    // The junction really is at the temple.
    expect(isPlausibleMatch("망월사 갈림길", "대한불교조계종 망월사", "도봉산")).toBe(true);
  });

  it("still accepts the trailhead written more fully", () => {
    expect(isPlausibleMatch("백운대탐방지원센터(도선사)", "백운대 탐방지원센터", "북한산")).toBe(true);
    expect(isPlausibleMatch("정릉탐방지원센터", "북한산국립공원 정릉탐방지원센터", "북한산")).toBe(true);
  });
});
