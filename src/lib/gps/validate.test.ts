import { describe, expect, it } from "vitest";
import { isValidGps } from "./validate";

describe("isValidGps", () => {
  it("accepts a real coordinate", () => {
    expect(isValidGps(37.6585, 126.9772)).toBe(true);
  });

  it("rejects null island (0,0)", () => {
    expect(isValidGps(0, 0)).toBe(false);
  });

  it("rejects missing values", () => {
    expect(isValidGps(null, 126.9772)).toBe(false);
    expect(isValidGps(37.6585, undefined)).toBe(false);
    expect(isValidGps(null, null)).toBe(false);
  });

  it("rejects out-of-range values", () => {
    expect(isValidGps(91, 0.1)).toBe(false);
    expect(isValidGps(-91, 0.1)).toBe(false);
    expect(isValidGps(0.1, 181)).toBe(false);
    expect(isValidGps(0.1, -181)).toBe(false);
  });

  it("rejects NaN/Infinity", () => {
    expect(isValidGps(NaN, 0.1)).toBe(false);
    expect(isValidGps(0.1, Infinity)).toBe(false);
  });
});
