const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const UPLOAD_KEY = new RegExp(`^photos/(${UUID})/(${UUID})(?:\\.[a-z0-9]{1,8})?$`);

export function buildStorageKey(filename: string, memberId: string): string {
  const extension = /\.[a-zA-Z0-9]{1,8}$/.exec(filename)?.[0].toLowerCase() ?? "";
  return `photos/${memberId}/${crypto.randomUUID()}${extension}`;
}

/** Reject other members' objects and path/query manipulation before any R2 call. */
export function uploadPhotoId(storageKey: string, memberId: string): string | null {
  const match = UPLOAD_KEY.exec(storageKey);
  return match?.[1] === memberId ? match[2] : null;
}
