// Videos are rejected on purpose: a single 4K minute outweighs hundreds of
// photos in storage, exifr can't read them, and the Images binding can't make
// a thumbnail from one - so they'd upload fine and then render broken.
export const ALLOWED_PHOTO_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
] as const;

// Windows file dialogs filter poorly on MIME types alone, so the file input
// advertises extensions too.
export const PHOTO_ACCEPT_ATTR = [
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".heic",
  ".heif",
  ...ALLOWED_PHOTO_TYPES,
].join(",");

const EXTENSION_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
};

// Cloudflare Images input is limited to 20 MB. Accepting larger originals
// succeeds at upload but fails when a tester opens a thumbnail or preview.
export const MAX_PHOTO_BYTES = 20_000_000;

export function isAllowedPhotoType(contentType: string): boolean {
  return (ALLOWED_PHOTO_TYPES as readonly string[]).includes(contentType.toLowerCase());
}

/**
 * Browsers sometimes hand over a File with an empty `type` (common for HEIC,
 * and for any extension Windows hasn't registered), so fall back to the
 * filename before deciding a file is unsupported.
 */
export function resolvePhotoType(fileName: string, fileType: string): string | null {
  if (fileType && isAllowedPhotoType(fileType)) return fileType.toLowerCase();
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  return EXTENSION_TYPES[ext] ?? null;
}

export const PHOTO_LIMITS_HINT =
  "JPG · PNG · WebP · HEIC 이미지만 올릴 수 있습니다 (동영상 불가, 최대 20MB)";
