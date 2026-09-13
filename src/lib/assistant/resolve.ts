/**
 * Matches a place name mentioned in a question against KHUAC's own records.
 *
 * The club's roster of locations and hikes is small - dozens of rows, not
 * thousands - so a plain substring scan in memory is simpler and just as fast
 * as anything database-side, and it is easy to reason about: a hike named
 * "인수봉" matches a question that mentions 인수봉 anywhere in it.
 */

export interface PlaceCandidateLocation {
  id: string;
  name: string;
  lat: number;
  lng: number;
  region: string | null;
}

export interface PlaceCandidateHike {
  id: string;
  title: string;
  locationId: string;
  lat: number | null;
  lng: number | null;
}

export interface ResolvedPlace {
  location: PlaceCandidateLocation;
  /** The specific spot within the location, if the question named one - 인수봉
      inside 북한산 rather than 북한산 itself. */
  hike: PlaceCandidateHike | null;
  lat: number;
  lng: number;
}

/**
 * The longer name wins when more than one matches - "북한산" is a substring of
 * nothing here, but a shorter location name being contained in a longer hike
 * title (or vice versa) is exactly the ambiguity this resolves by specificity:
 * a question naming 인수봉 should resolve to that spot, not just to whichever
 * mountain happens to share a shorter prefix.
 */
export function findMatchingPlace(
  query: string,
  locations: PlaceCandidateLocation[],
  hikes: PlaceCandidateHike[],
): ResolvedPlace | null {
  const hikeMatches = hikes
    .filter((hike) => hike.title.length > 0 && query.includes(hike.title))
    .sort((a, b) => b.title.length - a.title.length);

  if (hikeMatches.length > 0) {
    const hike = hikeMatches[0];
    const location = locations.find((l) => l.id === hike.locationId);
    // A hike with no coordinates of its own (nobody has pinned a spot yet)
    // falls back to its folder's point - the same rule the map itself uses.
    const lat = hike.lat ?? location?.lat;
    const lng = hike.lng ?? location?.lng;
    if (location && lat != null && lng != null) {
      return { location, hike, lat, lng };
    }
  }

  const locationMatches = locations
    .filter((l) => l.name.length > 0 && query.includes(l.name))
    .sort((a, b) => b.name.length - a.name.length);

  if (locationMatches.length > 0) {
    const location = locationMatches[0];
    return { location, hike: null, lat: location.lat, lng: location.lng };
  }

  return null;
}
