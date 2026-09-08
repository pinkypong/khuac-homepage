import exifr from "exifr";
import { isValidGps } from "./validate";

export interface ParsedExif {
  lat: number | null;
  lng: number | null;
  takenAt: Date | null;
  width: number | null;
  height: number | null;
}

const EMPTY_EXIF: ParsedExif = { lat: null, lng: null, takenAt: null, width: null, height: null };

/**
 * Never throws: a corrupted file or an unsupported format degrades to
 * EMPTY_EXIF (which downstream just means location_match_status ends up
 * 'no_gps' or 'manual_pending') rather than failing the whole upload.
 */
export async function parseExif(bytes: ArrayBuffer | Uint8Array): Promise<ParsedExif> {
  try {
    const output = await exifr.parse(bytes, { gps: true, exif: true, tiff: true });
    if (!output) return EMPTY_EXIF;

    const rawLat = typeof output.latitude === "number" ? output.latitude : null;
    const rawLng = typeof output.longitude === "number" ? output.longitude : null;
    const gpsValid = isValidGps(rawLat, rawLng);

    return {
      lat: gpsValid ? rawLat : null,
      lng: gpsValid ? rawLng : null,
      takenAt: output.DateTimeOriginal instanceof Date ? output.DateTimeOriginal : null,
      width: output.ExifImageWidth ?? output.ImageWidth ?? null,
      height: output.ExifImageHeight ?? output.ImageHeight ?? null,
    };
  } catch {
    return EMPTY_EXIF;
  }
}
