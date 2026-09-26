import { describe, it, expect } from "vitest";
import { similarLocationName } from "./location-names";

describe("similarLocationName", () => {
  it("catches a crag being made into a second folder beside its mountain", () => {
    // 숨은암장 belongs under 삼성산 as a climb, not beside it as a place.
    expect(similarLocationName("삼성산", ["관악산", "북한산"])).toBeNull();
    expect(similarLocationName("삼성산 숨은암장", ["삼성산"])).toBe("삼성산");
  });

  it("catches the reverse - typing the short form of a place already on file", () => {
    expect(similarLocationName("삼성산", ["삼성산 숨은암장"])).toBe("삼성산 숨은암장");
  });

  it("matches on an exact name regardless of spacing or case", () => {
    expect(similarLocationName("북한산", ["북한산"])).toBe("북한산");
    expect(similarLocationName(" 북한산 ", ["북한산"])).toBe("북한산");
  });

  it("does not flag unrelated names", () => {
    expect(similarLocationName("도봉산", ["관악산", "북한산", "삼성산 숨은암장"])).toBeNull();
  });

  it("does not flag two names that merely both end in 산", () => {
    expect(similarLocationName("관악산", ["북한산", "설악산", "지리산"])).toBeNull();
  });

  it("ignores a bare 산 rather than flagging it against every mountain name", () => {
    expect(similarLocationName("산", ["관악산"])).toBeNull();
  });

  it("returns null against an empty list", () => {
    expect(similarLocationName("삼성산", [])).toBeNull();
  });
});
