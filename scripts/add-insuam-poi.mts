/**
 * Registers 인수암 in the club's own gazetteer (route_pois).
 *
 *   node scripts/add-insuam-poi.mts [--dry-run]
 *
 * 인수암 is a small hermitage at the foot of 인수봉 on 북한산 - not the peak
 * itself. It already appears as a waypoint, spelled out separately from
 * "인수봉 고독길 들머리", in four course_library rows describing approach
 * routes to 인수봉 climbing (우이동 도선사 어프로치, 북한산우이역 연계 코스,
 * 육모정·영봉 경유 코스, 북한산성 우회 어프로치 코스). Every one of those
 * previews pays for a Google Places lookup of "북한산 인수암" to place that
 * waypoint; a row here answers it for free from now on and pins the
 * coordinate down regardless of how Places ranks its results later.
 *
 * Coordinates: Google Places (`places:searchText`, "북한산 인수암") returned
 * exactly one result, typed buddhist_temple, at 37.6610489, 126.9847903 -
 * about 375m from 인수봉's own coordinates (37.6604978, 126.9801221), on the
 * 우이동/도선사-facing side. That matches the descriptions found by search:
 * namu.wiki's 인수봉 article places 인수암 "인수봉 하단부" (at the base of
 * Insubong), and a trip report lists it on the 백운대-하루재-도선사 stretch,
 * i.e. downhill of the peak toward 도선사 - consistent with the Places point
 * sitting between 인수봉 and 하루재.
 */
import { readFileSync } from "node:fs";

function env(name: string): string {
  const match = readFileSync(".env.local", "utf8").match(new RegExp(`^${name}=(.*)$`, "m"));
  const value = match?.[1]?.trim().replace(/^["']|["']$/g, "");
  if (!value) throw new Error(`${name} is not set in .env.local`);
  return value;
}

const url = env("NEXT_PUBLIC_SUPABASE_URL");
const service = env("SUPABASE_SERVICE_ROLE_KEY");
const headers = {
  apikey: service,
  authorization: `Bearer ${service}`,
  "content-type": "application/json",
};

const dryRun = process.argv.includes("--dry-run");

const row = {
  name: "인수암",
  aliases: [] as string[],
  lat: 37.6610489,
  lng: 126.9847903,
  kind: "landmark",
  note:
    "인수봉(봉우리)과 구분되는 별개 암자. Google Places 'buddhist_temple' 결과 좌표. " +
    "poi.ts 매칭 버그(인수암 질의가 인수봉으로 오인식되던 문제) 수정과 함께 등록 - 2026-09-20.",
};

const existing = await fetch(
  `${url}/rest/v1/route_pois?name=ilike.${encodeURIComponent(row.name)}&select=id,name,lat,lng`,
  { headers },
).then((r) => r.json()) as { id: string; name: string; lat: number; lng: number }[];

if (existing.length > 0) {
  console.log("이미 등록되어 있습니다:", JSON.stringify(existing, null, 2));
  process.exit(0);
}

console.log(dryRun ? "[dry-run] 아래 행을 등록합니다:" : "등록합니다:", JSON.stringify(row, null, 2));
if (dryRun) process.exit(0);

const res = await fetch(`${url}/rest/v1/route_pois`, {
  method: "POST",
  headers: { ...headers, prefer: "return=representation" },
  body: JSON.stringify(row),
});

if (!res.ok) {
  console.error("등록 실패:", res.status, await res.text());
  process.exit(1);
}

console.log("등록 완료:", JSON.stringify(await res.json(), null, 2));
