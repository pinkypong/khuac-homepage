// Points at our own /api/images route (Cloudflare Images binding transform),
// not a Cloudflare zone-level "/cdn-cgi/image/..." URL - that feature needs
// a paid zone plan, the binding doesn't.
function resizedUrl(storageKey: string, params: URLSearchParams) {
  const query = params.toString();
  return `/api/images/${storageKey}${query ? `?${query}` : ""}`;
}

export function getThumbnailUrl(storageKey: string): string {
  return resizedUrl(storageKey, new URLSearchParams({ w: "400", q: "75" }));
}

export function getPreviewUrl(storageKey: string): string {
  return resizedUrl(storageKey, new URLSearchParams({ w: "1600", q: "85" }));
}
