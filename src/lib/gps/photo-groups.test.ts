import {describe,it,expect} from "vitest";
import {groupPhotosByPosition} from "./photo-groups";
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
});
