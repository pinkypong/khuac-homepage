import { describe, expect, it } from "vitest";
import { findClubPoi, normalisePoiName, type ClubPoi } from "./poi";

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
