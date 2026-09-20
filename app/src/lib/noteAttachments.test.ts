// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
import { memoryStorage } from "../test/memoryStorage";
import { attachmentMetadata, saveAttachment, syncNoteAttachments } from "./noteAttachments";
beforeEach(() => { vi.stubGlobal("localStorage", memoryStorage()); vi.stubGlobal("fetch", vi.fn()); });
it("pulls attachment metadata so another device can download blobs on demand", async () => {
  vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify([{ id: "file", name: "Course.pdf", type: "application/pdf", size: 128 }])));
  await syncNoteAttachments("token", () => true);
  expect(attachmentMetadata()).toEqual([{ id: "file", name: "Course.pdf", type: "application/pdf", size: 128, uploaded: true }]);
  expect(vi.mocked(fetch).mock.calls[0][1]?.headers).toEqual({ Authorization: "Bearer token" });
});
it("does not merge an attachment listing after an account switch", async () => {
  vi.mocked(fetch).mockImplementationOnce(async () => {
    localStorage.setItem("prior.session.user", JSON.stringify({ id: "other" }));
    return new Response(JSON.stringify([{ id: "private", name: "Private.pdf", type: "application/pdf", size: 1 }]));
  });
  await syncNoteAttachments("token", () => true);
  expect(attachmentMetadata()).toEqual([]);
});
it("rejects oversized files before saving local metadata", async () => {
  const blob = new Blob([new Uint8Array(8 * 1024 * 1024 + 1)]);
  await expect(saveAttachment({ id: "large", name: "large.bin", type: "application/octet-stream", size: blob.size }, blob)).rejects.toThrow("8 MB");
  expect(attachmentMetadata()).toEqual([]);
});
