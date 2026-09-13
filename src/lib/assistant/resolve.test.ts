import { describe, expect, it } from "vitest";
import { findMatchingPlace, type PlaceCandidateHike, type PlaceCandidateLocation } from "./resolve";

const bukhansan: PlaceCandidateLocation = {
  id: "loc-1",
  name: "북한산",
  lat: 37.6584,
  lng: 126.9772,
  region: "서울",
};
const gwanaksan: PlaceCandidateLocation = {
  id: "loc-2",
  name: "관악산",
  lat: 37.4423,
  lng: 126.9648,
  region: "서울",
};

const insubong: PlaceCandidateHike = {
  id: "hike-1",
  title: "인수봉",
  locationId: "loc-1",
  lat: 37.6653,
  lng: 126.9793,
};
const noSpotHike: PlaceCandidateHike = {
  id: "hike-2",
  title: "백운대",
  locationId: "loc-1",
  lat: null,
  lng: null,
};

describe("findMatchingPlace", () => {
  it("matches a specific spot over its parent mountain", () => {
    const result = findMatchingPlace("인수봉 위치", [bukhansan, gwanaksan], [insubong]);
    expect(result?.hike?.title).toBe("인수봉");
    expect(result?.location.name).toBe("북한산");
    expect(result).toMatchObject({ lat: 37.6653, lng: 126.9793 });
  });

  it("falls back to the folder's own point when the hike has no spot pinned", () => {
    const result = findMatchingPlace("백운대 날씨", [bukhansan], [noSpotHike]);
    expect(result?.hike?.title).toBe("백운대");
    expect(result).toMatchObject({ lat: bukhansan.lat, lng: bukhansan.lng });
  });

  it("matches the mountain itself when no specific spot is named", () => {
    const result = findMatchingPlace("북한산 어디야", [bukhansan, gwanaksan], [insubong]);
    expect(result?.hike).toBeNull();
    expect(result?.location.name).toBe("북한산");
  });

  it("returns null for a place the club has no record of", () => {
    const result = findMatchingPlace("에베레스트 날씨", [bukhansan, gwanaksan], [insubong]);
    expect(result).toBeNull();
  });

  it("prefers the longer, more specific name when both would match", () => {
    // A location named "관악" would be a substring of a hike named "관악 남릉",
    // and the more specific one should win.
    const nam: PlaceCandidateHike = {
      id: "hike-3",
      title: "관악산 남릉",
      locationId: "loc-2",
      lat: 37.45,
      lng: 126.96,
    };
    const result = findMatchingPlace("관악산 남릉 코스 위치", [gwanaksan], [nam]);
    expect(result?.hike?.title).toBe("관악산 남릉");
  });
});
