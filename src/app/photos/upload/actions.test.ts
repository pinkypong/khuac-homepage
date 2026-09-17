import { beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/require-role", () => ({ requireApprovedMember: vi.fn() }));
vi.mock("@/lib/r2/client", () => ({ headObject: vi.fn(), deleteObject: vi.fn(), presignPutUrl: vi.fn(), buildStorageKey: vi.fn() }));
import { requireApprovedMember } from "@/lib/supabase/require-role";
import { headObject, deleteObject } from "@/lib/r2/client";
import { processUploadedPhoto } from "./actions";

const memberId = "11111111-1111-4111-8111-111111111111";
const photoId = "22222222-2222-4222-8222-222222222222";
const storageKey = `photos/${memberId}/${photoId}.jpg`;
const input = { storageKey, hikeId: null };
const row = { id: photoId, uploader_id: memberId, storage_key_original: storageKey, hike_id: null, location_match_status: "no_gps" };
const lookup = vi.fn();
const insertResult = vi.fn();
const insert = vi.fn();
const from = vi.fn();
beforeEach(() => {
  vi.resetAllMocks();
  lookup.mockResolvedValue({ data: null, error: null });
  insertResult.mockResolvedValue({ data: { id: photoId }, error: null });
  insert.mockImplementation(() => ({ select: () => ({ single: insertResult }) }));
  from.mockImplementation((table: string) => table === "photos"
    ? { select: () => ({ eq: () => ({ maybeSingle: lookup }) }), insert }
    : { select: () => ({ not: () => ({ not: async () => ({ data: [] }) }) }) });
  vi.mocked(requireApprovedMember).mockResolvedValue({ supabase: { from }, memberId, isAdmin: false } as never);
  vi.mocked(headObject).mockResolvedValue({ contentType: "image/jpeg", size: 100 });
});
it.each([
  `photos/33333333-3333-4333-8333-333333333333/${photoId}.jpg`,
  `photos/${memberId}/../../private`,
  `photos/${memberId}/${photoId}.jpg?other=1`,
  `photos/${photoId}.jpg`,
])("rejects an unowned or manipulated key before storage access: %s", async (key) => {
  await expect(processUploadedPhoto({ ...input, storageKey: key })).rejects.toThrow("업로드 정보");
  expect(headObject).not.toHaveBeenCalled();
  expect(deleteObject).not.toHaveBeenCalled();
});
it("returns the existing row on a completed-upload retry", async () => {
  lookup.mockResolvedValue({ data: row, error: null });
  expect(await processUploadedPhoto(input)).toEqual({ photoId, status: "no_gps" });
  expect(headObject).not.toHaveBeenCalled();
  expect(insert).not.toHaveBeenCalled();
});
it("uses one primary key for concurrent attempts and recovers a duplicate", async () => {
  lookup.mockResolvedValueOnce({ data: null, error: null }).mockResolvedValueOnce({ data: row, error: null });
  insertResult.mockResolvedValue({ data: null, error: { code: "23505", message: "duplicate" } });
  expect(await processUploadedPhoto(input)).toEqual({ photoId, status: "no_gps" });
  expect(insert).toHaveBeenCalledWith(expect.objectContaining({ id: photoId, uploader_id: memberId }));
  expect(deleteObject).not.toHaveBeenCalled();
});
it("does not delete an original after an ambiguous database failure", async () => {
  insertResult.mockResolvedValue({ data: null, error: { message: "connection lost" } });
  await expect(processUploadedPhoto(input)).rejects.toEqual({ message: "connection lost" });
  expect(deleteObject).not.toHaveBeenCalled();
});
it("rejects an empty uploaded object", async () => {
  vi.mocked(headObject).mockResolvedValue({ contentType: "image/jpeg", size: 0 });
  await expect(processUploadedPhoto(input)).rejects.toThrow("20MB");
  expect(insert).not.toHaveBeenCalled();
  expect(deleteObject).toHaveBeenCalledWith(storageKey);
});
