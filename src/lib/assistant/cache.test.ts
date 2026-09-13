import { describe, expect, it } from "vitest";
import { ageLabel, cacheKey, isFresh } from "./cache";

describe("cacheKey", () => {
  it("shares one entry across spacing, case and trailing punctuation", () => {
    const key = cacheKey("관악산 등산 코스");
    expect(cacheKey("  관악산   등산 코스  ")).toBe(key);
    expect(cacheKey("관악산 등산 코스?")).toBe(key);
    expect(cacheKey("관악산 등산 코스~")).toBe(key);
  });

  it("keeps questions with different meanings apart", () => {
    expect(cacheKey("관악산 코스")).not.toBe(cacheKey("관악산 겨울 코스"));
    expect(cacheKey("북한산 코스")).not.toBe(cacheKey("관악산 코스"));
  });
});

describe("isFresh", () => {
  const now = new Date("2026-09-13T00:00:00Z");
  const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000).toISOString();

  it("reuses an answer inside the window and not outside it", () => {
    expect(isFresh(daysAgo(0), now)).toBe(true);
    expect(isFresh(daysAgo(13), now)).toBe(true);
    expect(isFresh(daysAgo(15), now)).toBe(false);
  });

  it("refuses a timestamp it cannot read rather than serving it forever", () => {
    expect(isFresh("not a date", now)).toBe(false);
  });
});

describe("ageLabel", () => {
  const now = new Date("2026-09-13T12:00:00Z");
  it("reads in the unit a member would use", () => {
    expect(ageLabel("2026-09-13T11:59:30Z", now)).toBe("방금");
    expect(ageLabel("2026-09-13T11:30:00Z", now)).toBe("30분 전");
    expect(ageLabel("2026-09-13T09:00:00Z", now)).toBe("3시간 전");
    expect(ageLabel("2026-09-10T12:00:00Z", now)).toBe("3일 전");
  });
});
