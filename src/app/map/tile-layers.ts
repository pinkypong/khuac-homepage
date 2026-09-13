/**
 * Third-party base maps, registered with Google's own map-type registry.
 *
 * Google's terrain layer is built for roads; it draws contours but not the
 * trails a hike actually follows. Thunderforest's Outdoors style renders
 * paths, and VWorld is the Korean government's own map, so between them a
 * member can see the route they walked rather than the hillside it crossed.
 *
 * A layer only appears in the switcher when it is configured, so a missing
 * key hides the mode rather than offering a button that paints the screen
 * blank.
 */

export type TileLayerId = "outdoors" | "vworld";

export interface TileLayer {
  id: TileLayerId;
  label: string;
  /** Shown while this layer is active. Removing it breaks both providers'
      terms, so it travels with the layer rather than being a separate
      decision someone can forget to make. */
  attribution: string;
  maxZoom: number;
  tileUrl: (point: { x: number; y: number }, zoom: number) => string;
}

// Thunderforest keys cannot be restricted by referrer or domain - their own
// docs offer no such setting - so the key never reaches the browser. Tiles go
// through our Worker, which holds the key and adds it server-side. The flag
// exists because the browser cannot check for a secret it is not allowed to
// see: it says "the proxy is configured", not "here is the key".
const outdoorsEnabled = process.env.NEXT_PUBLIC_TILE_OUTDOORS === "1";
const vworldKey = process.env.NEXT_PUBLIC_VWORLD_API_KEY;

const LAYERS: (TileLayer & { enabled: boolean })[] = [
  {
    id: "outdoors",
    label: "등산로",
    // Verbatim from Thunderforest's terms, which state that removing the
    // attribution is not permitted.
    attribution: "Maps © Thunderforest, Data © OpenStreetMap contributors",
    maxZoom: 22,
    enabled: outdoorsEnabled,
    tileUrl: ({ x, y }, zoom) => `/api/tiles/outdoors/${zoom}/${x}/${y}.png`,
  },
  {
    id: "vworld",
    label: "국토지리",
    // VWorld is 공공저작물 제1유형, where attribution is a licence condition
    // rather than a courtesy.
    attribution: "출처: 국토교통부 브이월드",
    maxZoom: 19,
    enabled: !!vworldKey,
    // VWorld's WMTS path is {z}/{row}/{col} - row before column, the reverse
    // of the usual XYZ order. Swapping these does not fail; it quietly serves
    // tiles for the wrong part of the country, so it is worth spelling out.
    //
    // The key rides in the URL, which is safe here in a way it is not for
    // Thunderforest: VWorld binds a key to the domains registered when it was
    // issued and rejects requests from anywhere else.
    tileUrl: ({ x, y }, zoom) =>
      `https://api.vworld.kr/req/wmts/1.0.0/${vworldKey}/Base/${zoom}/${y}/${x}.png`,
  },
];

/** Only the layers this deployment is actually configured for. */
export function availableTileLayers(): TileLayer[] {
  return LAYERS.filter((layer) => layer.enabled).map((layer) => ({
    id: layer.id,
    label: layer.label,
    attribution: layer.attribution,
    maxZoom: layer.maxZoom,
    tileUrl: layer.tileUrl,
  }));
}
