import { isValidGps } from "./validate";

/** Preserve exact coordinates: nearby but distinct photo locations stay separate. */
export function groupPhotosByPosition<T extends {id:string;exifLat:number|null;exifLng:number|null}>(photos:T[]) {
  const groups = new Map<string,{key:string;position:{lat:number;lng:number};photos:T[]}>();
  for (const photo of photos) {
    if (!isValidGps(photo.exifLat,photo.exifLng)) continue;
    const lat=photo.exifLat as number, lng=photo.exifLng as number;
    const key=`${lat},${lng}`;
    const group=groups.get(key);
    if(group) group.photos.push(photo);
    else groups.set(key,{key,position:{lat,lng},photos:[photo]});
  }
  return [...groups.values()];
}
