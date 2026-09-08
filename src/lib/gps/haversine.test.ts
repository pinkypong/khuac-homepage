import { describe, expect, it } from "vitest";
import { findNearestLocation, haversineDistanceMeters } from "./haversine";

describe("haversineDistanceMeters", () => {
  it("returns 0 for the same point", () => {
    expect(haversineDistanceMeters({ lat: 37.6585, lng: 126.9772 }, { lat: 37.6585, lng: 126.9772 })).toBe(0);
  });

  it("matches a known distance (Bukhansan Baegundae to Jirisan Cheonwangbong, ~280km)", () => {
    const bukhansan = { lat: 37.6585, lng: 126.9772 };
    const jirisan = { lat: 35.3372, lng: 127.7306 };
    const distanceKm = haversineDistanceMeters(bukhansan, jirisan) / 1000;
    expect(distanceKm).toBeGreaterThan(260);
    expect(distanceKm).toBeLessThan(300);
  });

  it("is symmetric", () => {
    const a = { lat: 37.5, lng: 127.0 };
    const b = { lat: 38.1, lng: 128.5 };
    expect(haversineDistanceMeters(a, b)).toBeCloseTo(haversineDistanceMeters(b, a), 6);
  });

  it("~111.2km for one degree of latitude at the equator", () => {
    const distance = haversineDistanceMeters({ lat: 0, lng: 0 }, { lat: 1, lng: 0 });
    expect(distance).toBeGreaterThan(110_500);
    expect(distance).toBeLessThan(111_500);
  });
});

describe("findNearestLocation", () => {
  const locations = [
    { id: "bukhansan", lat: 37.6585, lng: 126.9772 },
    { id: "jirisan", lat: 35.3372, lng: 127.7306 },
    { id: "seoraksan", lat: 38.1197, lng: 128.4656 },
  ];

  it("picks the closest candidate", () => {
    const result = findNearestLocation({ lat: 37.66, lng: 126.98 }, locations);
    expect(result?.location.id).toBe("bukhansan");
    expect(result?.distanceMeters).toBeLessThan(500);
  });

  it("returns null for an empty candidate list", () => {
    expect(findNearestLocation({ lat: 37.66, lng: 126.98 }, [])).toBeNull();
  });
});
