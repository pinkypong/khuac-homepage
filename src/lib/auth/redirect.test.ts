import { expect, it } from "vitest";
import { safeReturnPath } from "./redirect";
it.each([null, "@evil.example/", "https://evil.example", "//evil.example", "/\\evil.example", "/\nevil.example"])("rejects unsafe return target %s", (value) => {
  const path = safeReturnPath(value);
  expect(new URL(`https://khuac.com${path}`).origin).toBe("https://khuac.com");
  expect(path).toBe("/map");
});
it("keeps an internal recovery destination", () => {
  expect(safeReturnPath("/auth/reset-password?from=email")).toBe("/auth/reset-password?from=email");
});
