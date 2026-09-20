import { describe, it, expect } from "vitest";
import { draftFromHike, withWaypoint, type DraftSource } from "./course-draft";

const hike: DraftSource = {
  id: "h1",
  description: "물은 하루재에서",
  routeWaypoints: [
    { name: "백운탐방지원센터", lat: 37.6582, lng: 126.9913 },
    { name: "하루재", lat: 37.6623, lng: 126.987 },
  ],
  courseInfo: { distanceText: "약 2.1km", durationText: "1시간", difficulty: null, notes: null },
};

describe("course draft", () => {
  it("reads the album's own values, with nulls as empty boxes", () => {
    const draft = draftFromHike(hike);
    expect(draft.hikeId).toBe("h1");
    expect(draft.waypoints.map((p) => p.name)).toEqual(["백운탐방지원센터", "하루재"]);
    expect(draft.distanceText).toBe("약 2.1km");
    expect(draft.difficulty).toBe("");
    expect(draft.notes).toBe("");
  });

  it("appends a tapped point to an edit already under way", () => {
    const editing = { ...draftFromHike(hike), notes: "낙석 주의" };
    const next = withWaypoint(editing, hike, { lat: 37.66, lng: 126.98 });
    expect(next.waypoints).toHaveLength(3);
    expect(next.waypoints[2]).toEqual({ name: "", lat: 37.66, lng: 126.98 });
    // What was typed before going to the map survives the trip.
    expect(next.notes).toBe("낙석 주의");
  });

  it("starts a draft when the tap arrives and none is open", () => {
    // Reaching the map can unmount the panel holding the edit; the tap that
    // comes back must still land rather than disappear.
    const next = withWaypoint(null, hike, { lat: 37.66, lng: 126.98 });
    expect(next.hikeId).toBe("h1");
    expect(next.waypoints).toHaveLength(3);
    expect(next.waypoints[2].name).toBe("");
  });

  it("does not add another album's point to this one's draft", () => {
    const other = { ...draftFromHike(hike), hikeId: "h2" };
    const next = withWaypoint(other, hike, { lat: 37.66, lng: 126.98 });
    expect(next.hikeId).toBe("h1");
    // Rebuilt from the album rather than inheriting h2's edits.
    expect(next.waypoints).toHaveLength(3);
  });

  it("gives a point with no waypoints somewhere to go", () => {
    const bare: DraftSource = { id: "h3", description: null, routeWaypoints: null, courseInfo: null };
    const next = withWaypoint(null, bare, { lat: 37.66, lng: 126.98 });
    expect(next.waypoints).toEqual([{ name: "", lat: 37.66, lng: 126.98 }]);
  });
});
