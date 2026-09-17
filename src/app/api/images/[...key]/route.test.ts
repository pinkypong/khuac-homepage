import { beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@opennextjs/cloudflare", () => ({ getCloudflareContext: vi.fn() }));
vi.mock("@/lib/r2/client", () => ({ getObject: vi.fn(), putObject: vi.fn() }));
vi.mock("@/lib/supabase/require-role", () => ({
  requireApprovedMember: vi.fn(),
  RoleError: class extends Error { constructor(public status: number) { super("Forbidden"); } },
}));
import { GET } from "./route";
import { getObject, putObject } from "@/lib/r2/client";
import { requireApprovedMember, RoleError } from "@/lib/supabase/require-role";
import { getCloudflareContext } from "@opennextjs/cloudflare";
const params = { params: Promise.resolve({ key: ["photos", "test.jpg"] }) };
beforeEach(() => vi.resetAllMocks());
it("does not read originals or cached variants for an unapproved user", async () => {
  vi.mocked(requireApprovedMember).mockRejectedValue(new RoleError(403));
  expect((await GET(new Request("https://khuac.com/api/images/photos/test.jpg?w=400"), params)).status).toBe(403);
  expect(getObject).not.toHaveBeenCalled();
});
it("rejects invalid transform sizes before accessing R2", async () => {
  expect((await GET(new Request("https://khuac.com/api/images/photos/test.jpg?w=-1"), params)).status).toBe(400);
  expect(getObject).not.toHaveBeenCalled();
});
it("rejects keys outside the photo directory", async () => {
  const response = await GET(new Request("https://khuac.com/api/images/private.json"), { params: Promise.resolve({ key: ["private.json"] }) });
  expect(response.status).toBe(400);
  expect(getObject).not.toHaveBeenCalled();
});
it("serves the original if Images cannot transform it and never caches fake WebP", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(getObject).mockResolvedValueOnce(null).mockResolvedValueOnce({ bytes: new Uint8Array([1,2,3]).buffer, contentType: "image/jpeg" });
  vi.mocked(getCloudflareContext).mockReturnValue({ env: { IMAGES: { input: () => { throw new Error("image too large"); } } } } as never);
  const response = await GET(new Request("https://khuac.com/api/images/photos/test.jpg?w=400"), params);
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("image/jpeg");
  expect(response.headers.get("cache-control")).not.toContain("immutable");
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1,2,3]));
  expect(putObject).not.toHaveBeenCalled();
  vi.restoreAllMocks();
});
