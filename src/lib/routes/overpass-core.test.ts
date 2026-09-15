import { afterEach, expect, it, vi } from "vitest";
import { fetchTrailsInBounds } from "./overpass-core";

afterEach(() => vi.unstubAllGlobals());
const bounds = { south: 37.6, west: 127, north: 37.64, east: 127.04 };

it("retains every routing vertex and requests approach roads", async () => {
  const geometry = Array.from({ length: 301 }, (_, i) => ({ lat: 37.60 + i / 100000, lon: 127 }));
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ elements: [{ type: "way", id: 1, tags: { highway: "path" }, geometry }] })));
  vi.stubGlobal("fetch", fetcher);
  const segments = await fetchTrailsInBounds(bounds, 15000);
  expect(segments[0].points).toHaveLength(301);
  const query = fetcher.mock.calls[0][1].body;
  expect(query).toContain("residential|service|unclassified");
  expect(query).toContain("[timeout:15]");
});

it("rejects HTTP 200 partial results and tries another mirror", async () => {
  const fetcher = vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ elements: [], remark: "runtime error: Query timed out" })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ elements: [] })));
  vi.stubGlobal("fetch", fetcher);
  expect(await fetchTrailsInBounds(bounds)).toEqual([]);
  expect(fetcher).toHaveBeenCalledTimes(2);
});
