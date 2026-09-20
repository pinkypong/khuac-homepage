import {describe,it,expect} from "vitest";
import {groupPhotosByPosition, metresPerPixel, PHOTO_PIN_PIXELS} from "./photo-groups";

/** A point `metres` north of 37N, which is where this club's photos are taken. */
const north = (id: string, metres: number) => ({ id, exifLat: 37 + metres / 111_320, exifLng: 127 });

describe("photo map groups",()=>{
 it("retains all six photos across three positions",()=>{
  const photos=Array.from({length:6},(_,i)=>({id:String(i),exifLat:37+Math.floor(i/2),exifLng:127}));
  const groups=groupPhotosByPosition(photos);
  expect(groups.map(g=>g.photos.length)).toEqual([2,2,2]);
  expect(groups.flatMap(g=>g.photos.map(p=>p.id))).toEqual(photos.map(p=>p.id));
 });
 it("keeps nearby coordinates separate and rejects missing GPS",()=>{
  const groups=groupPhotosByPosition([{id:"a",exifLat:37,exifLng:127},{id:"b",exifLat:37.000001,exifLng:127},{id:"c",exifLat:null,exifLng:127}]);
  expect(groups).toHaveLength(2);
 });

 it("folds photos within the radius and leaves the rest alone",()=>{
  const groups=groupPhotosByPosition([north("a",0),north("b",30),north("c",500)],60);
  expect(groups.map(g=>g.photos.map(p=>p.id))).toEqual([["a","b"],["c"]]);
 });

 it("keeps every photo, whatever the radius",()=>{
  const photos=Array.from({length:40},(_,i)=>north(String(i),i*18));
  for (const radius of [0,30,60,650]) {
   const kept=groupPhotosByPosition(photos,radius).flatMap(g=>g.photos.map(p=>p.id));
   expect(kept.sort()).toEqual(photos.map(p=>p.id).sort());
  }
 });

 it("does not chain a trail into one pin",()=>{
  // 40 photos 18m apart span 700m. Measured to the nearest neighbour they would
  // link end to end and fold into a single pin at a 60m radius; measured to each
  // group's first photo, a group cannot be wider than the radius.
  const groups=groupPhotosByPosition(Array.from({length:40},(_,i)=>north(String(i),i*18)),60);
  expect(groups.length).toBeGreaterThan(8);
 });

 it("puts the pin in the middle of what it covers",()=>{
  const [group]=groupPhotosByPosition([north("a",0),north("b",100)],200);
  expect(group.photos).toHaveLength(2);
  expect(group.position.lat).toBeCloseTo(north("a",50).exifLat,9);
 });

 it("keeps its key when the radius changes, so an open stack stays open",()=>{
  const photos=[north("a",0),north("b",30),north("c",45)];
  expect(groupPhotosByPosition(photos,40)[0].key).toBe("a");
  expect(groupPhotosByPosition(photos,100)[0].key).toBe("a");
 });

 it("folds a 3.5km course on a phone but not a 550m crag on a desktop",()=>{
  // The two albums that made a fixed radius unworkable. 숨은벽 is framed at
  // about zoom 13 on a phone, the 인수봉 climb at about 17.5 on a desktop.
  const phone=PHOTO_PIN_PIXELS*metresPerPixel(37.66,13.2);
  const desktop=PHOTO_PIN_PIXELS*metresPerPixel(37.66,17.5);
  expect(phone).toBeGreaterThan(500);
  expect(desktop).toBeLessThan(60);

  // 80m apart: one pin on the phone's view, two on the desktop's.
  const pair=[north("a",0),north("b",80)];
  expect(groupPhotosByPosition(pair,phone)).toHaveLength(1);
  expect(groupPhotosByPosition(pair,desktop)).toHaveLength(2);
 });
});
