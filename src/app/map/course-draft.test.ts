import { describe, it, expect } from "vitest";
import { draftFromHike, withWaypoint, type DraftSource } from "./course-draft";

const hike: DraftSource = {
  id: "h1",
  updatedAt: "2026-09-20T11:58:15.791452+00:00",
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
    expect(draft.baseUpdatedAt).toBe(hike.updatedAt);
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
    const bare: DraftSource = { id: "h3", updatedAt: "2026-09-20T00:00:00+00:00", description: null, routeWaypoints: null, courseInfo: null };
    const next = withWaypoint(null, bare, { lat: 37.66, lng: 126.98 });
    expect(next.waypoints).toEqual([{ name: "", lat: 37.66, lng: 126.98 }]);
  });
});

describe("concurrent edits", () => {
  it("carries the version the edit started from", () => {
    // What lets the save refuse a row another member has moved since. Without
    // it, two people editing one album means the second save silently erases
    // the first, and neither is told.
    const draft = draftFromHike(hike);
    expect(draft.baseUpdatedAt).toBe(hike.updatedAt);
  });

  it("keeps that version while the edit is worked on", () => {
    // Including the trip to the map to place a point, which is the longest a
    // draft stays open and so the likeliest moment for someone else to save.
    const draft = draftFromHike(hike);
    const afterTyping = { ...draft, notes: "낙석 주의", difficulty: "5.9" };
    const afterTap = withWaypoint(afterTyping, hike, { lat: 37.66, lng: 126.98 });
    expect(afterTap.baseUpdatedAt).toBe(hike.updatedAt);
  });

  it("takes the album's current version when a tap starts a fresh draft", () => {
    // A draft rebuilt from the album is an edit of what the album says now, so
    // it is checked against that - not against a version nobody read.
    const reloaded = { ...hike, updatedAt: "2026-09-20T12:00:00+00:00" };
    expect(withWaypoint(null, reloaded, { lat: 37.66, lng: 126.98 }).baseUpdatedAt)
      .toBe("2026-09-20T12:00:00+00:00");
  });
});
