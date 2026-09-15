/**
 * Does a real drawn line survive flatten → send → unflatten → sanitize?
 *
 *   node scripts/check-track-roundtrip.mts
 *
 * The album saved its waypoints and no line. The 500 is gone, so the arguments
 * arrived; the question is whether they arrived intact, and the server drops a
 * track it cannot read without saying so.
 */
import { flattenTrack, sanitizeTrack, unflattenTrack } from "../src/lib/gps/track.ts";
import type { TrackPoint } from "../src/lib/gps/track.ts";

/** A line with a shared junction object, the way the router builds one. */
const junction: TrackPoint = [37.65871, 126.95129];
const line: TrackPoint[] = [
  junction,
  ...Array.from({ length: 450 }, (_, i) => [37.6587 + i * 2e-5, 126.9513 + i * 5e-5] as TrackPoint),
  junction,
];

const flat = flattenTrack(line);
console.log(`원본 ${line.length}점 → 평평하게 ${flat.length}개 숫자 (짝수: ${flat.length % 2 === 0})`);

const back = unflattenTrack(flat);
console.log(`되돌림: ${back === null ? "null (실패)" : back.length + "점"}`);

const clean = sanitizeTrack(back);
console.log(`sanitizeTrack: ${clean === null ? "null (버려짐)" : clean.length + "점 저장 가능"}`);

// The path Flight actually takes: numbers come back as numbers, but a long
// array is worth checking against the real encoder rather than assumed.
const root = "C:/Users/eigoo/Documents/khuac-homepage/node_modules/next/dist/compiled/react-server-dom-webpack";
const { encodeReply } = await import(`file://${root}/client.edge.js`);
const { decodeReply } = await import(`file://${root}/server.edge.js`);
const body = await encodeReply([{ track: flat }]);
const [decoded] = await decodeReply(body, {}) as [{ track: unknown }];
const afterWire = sanitizeTrack(unflattenTrack(decoded.track));
console.log(`인코더 왕복 후: ${afterWire === null ? "null (버려짐)" : afterWire.length + "점"}`);
