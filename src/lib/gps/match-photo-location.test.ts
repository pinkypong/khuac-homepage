import { describe, expect, it } from "vitest";
import { matchPhotoLocation } from "./match-photo-location";

const bukhansan = { id: "loc-bukhansan", lat: 37.6585, lng: 126.9772 };
const jirisan = { id: "loc-jirisan", lat: 35.3372, lng: 127.7306 };
const candidateLocations = [bukhansan, jirisan];

describe("matchPhotoLocation", () => {
  it("GPS present, within 500m of a registered location -> auto_matched", () => {
    const result = matchPhotoLocation({
      exifGps: { lat: 37.6587, lng: 126.9774 }, // a few meters from bukhansan
      hikeId: null,
      hikeLocation: null,
      candidateLocations,
    });
    expect(result).toEqual({ status: "auto_matched", matchedLocationId: bukhansan.id });
  });

  it("GPS present, nothing registered nearby -> manual_pending", () => {
    const result = matchPhotoLocation({
      exifGps: { lat: 36.5, lng: 127.0 }, // far from both candidates
      hikeId: null,
      hikeLocation: null,
      candidateLocations,
    });
    expect(result).toEqual({ status: "manual_pending", matchedLocationId: null });
  });

  it("no GPS, selected hike already has a location -> manual_matched", () => {
    const result = matchPhotoLocation({
      exifGps: null,
      hikeId: "hike-1",
      hikeLocation: jirisan,
      candidateLocations,
    });
    expect(result).toEqual({ status: "manual_matched", matchedLocationId: jirisan.id });
  });

  it("no GPS, selected hike has no location -> manual_pending", () => {
    const result = matchPhotoLocation({
      exifGps: null,
      hikeId: "hike-1",
      hikeLocation: null,
      candidateLocations,
    });
    expect(result).toEqual({ status: "manual_pending", matchedLocationId: null });
  });

  it("no GPS, no hike selected at all -> no_gps", () => {
    const result = matchPhotoLocation({
      exifGps: null,
      hikeId: null,
      hikeLocation: null,
      candidateLocations,
    });
    expect(result).toEqual({ status: "no_gps", matchedLocationId: null });
  });

  it("GPS exactly at the 500m boundary still matches (<=)", () => {
    // ~500m due north of bukhansan (1 degree lat ~= 111.2km).
    const offsetLat = bukhansan.lat + 500 / 111_200;
    const result = matchPhotoLocation({
      exifGps: { lat: offsetLat, lng: bukhansan.lng },
      hikeId: null,
      hikeLocation: null,
      candidateLocations,
    });
    expect(result.status).toBe("auto_matched");
  });
});
