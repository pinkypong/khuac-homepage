/** Which waypoints of a course can be placed, and which the rules refuse. */
import { readFileSync } from "node:fs";
import { findClubPoi, isPlausibleMatch, isUsableWaypoint, NOT_A_WAYPOINT, type ClubPoi } from "../src/lib/routes/poi.ts";

function env(name: string): string {
  const match = readFileSync(".env.local", "utf8").match(new RegExp(`^${name}=(.*)$`, "m"));
  const value = match?.[1]?.trim().replace(/^["']|["']$/g, "");
  if (!value) throw new Error(`${name} is not set in .env.local`);
  return value;
}
const url = env("NEXT_PUBLIC_SUPABASE_URL");
const service = env("SUPABASE_SERVICE_ROLE_KEY");
const mapsKey = env("NEXT_PUBLIC_GOOGLE_MAPS_API_KEY");
const headers = { apikey: service, authorization: `Bearer ${service}` };

const [place, ...names] = process.argv.slice(2);
const pois = await (async () => {
  const r = await fetch(`${url}/rest/v1/route_pois?select=name,aliases,lat,lng`, { headers });
  return r.ok ? await r.json() as ClubPoi[] : [];
})();

for (const name of names) {
  const known = findClubPoi(name, pois);
  if (known) { console.log(`${name}: 동아리 등록 ✓`); continue; }

  for (const query of [`${place} ${name}`, name]) {
    const r = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: { "content-type": "application/json", "X-Goog-Api-Key": mapsKey, referer: "https://khuac.com/",
        "X-Goog-FieldMask": "places.displayName,places.location,places.types" },
      body: JSON.stringify({ textQuery: query, languageCode: "ko", regionCode: "KR", maxResultCount: 5,
        locationBias: { circle: { center: { latitude: 37.64, longitude: 126.98 }, radius: 20000 } } }),
    });
    const body = await r.json() as { places?: { displayName: { text: string }; types: string[] }[] };
    const found = (body.places ?? []).find((p) => isUsableWaypoint(name, p.displayName.text, p.types ?? [], place));
    if (found) { console.log(`${name}: ${found.displayName.text} ✓`); break; }
    if (query === name) {
      const why = (body.places ?? []).slice(0, 3).map((p) => {
        const transit = (p.types ?? []).some((t) => NOT_A_WAYPOINT.has(t));
        const plausible = isPlausibleMatch(name, p.displayName.text, place);
        return `${p.displayName.text}[${transit ? "교통" : ""}${plausible ? "" : "이름불일치"}]`;
      }).join(", ");
      console.log(`${name}: ✗ 거부 — ${why || "결과 없음"}`);
    }
  }
}
