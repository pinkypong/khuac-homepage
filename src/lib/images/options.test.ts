import { expect, it } from "vitest";
import { imageOptions } from "./options";
it.each(["w=-1", "w=Infinity", "w=NaN", "w=4097", "w=0", "w=1.5", "q=101", "q=-1", "q=2.3"])("rejects invalid transform %s", (query) => {
  expect(imageOptions(new URLSearchParams(query))).toBeNull();
});
it("supports current thumbnails and previews", () => {
  expect(imageOptions(new URLSearchParams("w=400&q=75"))).toEqual({ width: 400, quality: 75 });
  expect(imageOptions(new URLSearchParams("w=1600&q=85"))).toEqual({ width: 1600, quality: 85 });
});
