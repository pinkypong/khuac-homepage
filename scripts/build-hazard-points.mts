/**
 * Builds src/lib/routes/hazard-points.json from two 국립공원공단 CSVs that
 * data.go.kr serves without a login (EUC-KR):
 *   - 국립공원 위험지역 공간데이터 (15003441)  -> danger points
 *   - 탐방로상 시설-난간 (15136187)             -> rope / railing points
 *
 * Usage: node scripts/build-hazard-points.mts <danger.csv> <railing.csv>
 */
import { readFileSync, writeFileSync } from "node:fs";

function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const head = rows[0].map((h) => h.trim());
  return rows.slice(1).filter((r) => r.length >= head.length)
    .map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? "").trim()])));
}

const read = (path: string) => parseCsv(new TextDecoder("euc-kr").decode(readFileSync(path)));
const [dangerPath, railPath] = process.argv.slice(2);
if (!dangerPath || !railPath) throw new Error("usage: build-hazard-points.mts <danger.csv> <railing.csv>");

const inKorea = (lat: number, lng: number) => lat > 33 && lat < 39 && lng > 124 && lng < 132;
const round = (n: number) => Math.round(n * 1e5) / 1e5;

// [lat, lng, kind, label]. kinds: isolation | washout | flood | rope | rail
const KIND: Record<string, string> = { 고립: "isolation", 유실: "washout", 침수: "flood" };
const out: [number, number, string, string][] = [];

for (const r of read(dangerPath)) {
  const m = r["GIS위치"].match(/POINT\(([\d.]+) ([\d.]+)\)/);
  const kind = KIND[r["위험유형"]];
  if (!m || !kind || !inKorea(+m[2], +m[1])) continue;
  out.push([round(+m[2]), round(+m[1]), kind, r["명칭"]]);
}

for (const r of read(railPath)) {
  if (!r["X좌표"] || !r["Y좌표"]) continue;
  // X and Y are swapped from row to row; the value ranges tell them apart.
  const a = +r["X좌표"];
  const b = +r["Y좌표"];
  const [lat, lng] = a > b ? [b, a] : [a, b];
  if (!inKorea(lat, lng)) continue;
  const name = r["시설물명칭"].replace(/\s+/g, " ");
  const kind = /로프|와이어/.test(name + r["기타비고"]) ? "rope" : "rail";
  out.push([round(lat), round(lng), kind, name]);
}

writeFileSync("src/lib/routes/hazard-points.json", JSON.stringify(out));
const count: Record<string, number> = {};
for (const p of out) count[p[2]] = (count[p[2]] ?? 0) + 1;
console.log(out.length, count);
