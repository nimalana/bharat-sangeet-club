// The parts the resource library was split into, one by one: the pure helpers (features/resources/model.ts), the upload batch engine
// (upload-batch.ts: which rows and files it sends, in which order, and what it marks when a step fails) and the thumbnail signing
// (thumbnails.ts). The screen as a whole is in resources-library.test.tsx; what each api function sends is in api-content.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readCache, setCacheOwner, writeCache } from "../../lib/cache";
import { ApiError } from "../../lib/errors";
import { thumbnailCacheKey } from "../../lib/resources-query";
import {
  deepestFolderLevel, formatBytes, itemIcon, mediaKindOf, normalizeUrl, safeSegment, splitRelativePath, storagePathOf, tooDeepMessage, uploadBatchName, uploadBatchStatus, uploadFailedSentence, uploadToastMessage,
} from "../../features/resources/model";
import { attachThumbnails } from "../../features/resources/thumbnails";
import type { ResourceItem } from "../../features/resources/types";
import { ensureFolderPath, shownMessage, uploadOne, type UploadBatch, type UploadSink } from "../../features/resources/upload-batch";
import { fail, fake, ok, rejects } from "../support/fake-supabase";
import { routeUploadsToFakeClient } from "./content-uploads";

// Uploads go through XMLHttpRequest (Phase 3.1): the scripted answers of `fake.storage(bucket, "upload")` still decide them.
beforeEach(() => { routeUploadsToFakeClient(); });

// `.single()` against the fake (and against PostgREST) answers with an error when no row comes back, so the guards that read "the
// database sent no row" can only be reached by an api function that answers null. These three are passed through unless a test
// names them.
const answerNull = vi.hoisted(() => new Set<string>());
vi.mock("../../lib/api/resources", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api/resources")>();
  const unlessNulled = <Args extends unknown[], Result>(name: string, call: (...args: Args) => Promise<Result>) => async (...args: Args): Promise<Result | null> => answerNull.has(name) ? null : call(...args);
  return {
    ...actual,
    createImportedFolder: unlessNulled("createImportedFolder", actual.createImportedFolder),
    createPendingResourceFile: unlessNulled("createPendingResourceFile", actual.createPendingResourceFile),
    markResourceReady: unlessNulled("markResourceReady", actual.markResourceReady),
  };
});
afterEach(() => answerNull.clear());

const row = (patch: Partial<ResourceItem> & { id: number }): ResourceItem => ({
  node_kind: "file", media_kind: "document", title: "Row", description: "", parent_id: null, subgroup_id: null, visibility: "members", storage_bucket: "club-resources", storage_path: `u/${patch.id}`,
  external_url: null, original_filename: null, mime_type: null, byte_size: null, checksum_sha256: null, event_id: null, occurred_on: null, season_label: null, status: "ready", is_pinned: false,
  import_id: null, created_by: "u-1", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", ...patch,
} as ResourceItem);

describe("model: how things are written", () => {
  it("formatBytes: a dash for nothing, then B, KB, MB and GB with one decimal from KB up", () => {
    expect(formatBytes(null)).toBe("—");
    expect(formatBytes(0)).toBe("—");
    expect(formatBytes(0.5)).toBe("—");
    expect(formatBytes(-5)).toBe("—");
    expect(formatBytes(1)).toBe("1 B");
    expect(formatBytes(1023)).toBe("1023 B");
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(1024 * 1024 - 1)).toBe("1024.0 KB");
    expect(formatBytes(1024 * 1024)).toBe("1.0 MB");
    expect(formatBytes(5.5 * 1024 * 1024)).toBe("5.5 MB");
    expect(formatBytes(1024 * 1024 * 1024)).toBe("1.0 GB");
    expect(formatBytes(2.25 * 1024 * 1024 * 1024)).toBe("2.3 GB");
  });

  it("safeSegment: letters, digits, dot, underscore and dash stay; every other run becomes one dash; the ends are trimmed; nothing left is `file`", () => {
    expect(safeSegment("Raga Yaman (v2).pdf")).toBe("Raga-Yaman-v2-.pdf");
    expect(safeSegment("a  b///c")).toBe("a-b-c");
    expect(safeSegment("--x--")).toBe("x");
    expect(safeSegment("_keep.this-1_")).toBe("_keep.this-1_");
    expect(safeSegment("日本語")).toBe("file");
    expect(safeSegment("")).toBe("file");
    // Compatibility forms are folded first: a full-width letter is a plain letter.
    expect(safeSegment("Ａ.txt")).toBe("A.txt");
  });

  it("uploadBatch texts: the batch is named for its file or its count; plural only when not one", () => {
    expect(uploadBatchName([{ name: "a.pdf" }])).toBe("a.pdf");
    expect(uploadBatchName([{ name: "a.pdf" }, { name: "b.pdf" }])).toBe("2 uploaded resources");
    expect(uploadFailedSentence(1)).toBe("1 file failed. You can retry the failed rows after checking their error details.");
    expect(uploadFailedSentence(3)).toBe("3 files failed. You can retry the failed rows after checking their error details.");
    expect(uploadToastMessage(1, 0)).toBe("1 file uploaded");
    expect(uploadToastMessage(4, 0)).toBe("4 files uploaded");
    expect(uploadToastMessage(2, 1)).toBe("2 files uploaded; 1 failed");
    expect(uploadToastMessage(0, 2)).toBe("0 files uploaded; 2 failed");
  });

  it("uploadBatchStatus: completed when none failed, partial when some did, failed when all did", () => {
    expect(uploadBatchStatus(3, 0)).toBe("completed");
    expect(uploadBatchStatus(2, 1)).toBe("partial");
    expect(uploadBatchStatus(1, 1)).toBe("partial");
    expect(uploadBatchStatus(0, 2)).toBe("failed");
  });
});

describe("model: what a thing is", () => {
  it("itemIcon: folder, link, image (by kind or by mime type) or file", () => {
    expect(itemIcon(row({ id: 1, node_kind: "folder" }))).toBe("folder");
    expect(itemIcon(row({ id: 1, node_kind: "link" }))).toBe("link");
    expect(itemIcon(row({ id: 1, media_kind: "image" }))).toBe("image");
    expect(itemIcon(row({ id: 1, media_kind: "other", mime_type: "image/png" }))).toBe("image");
    expect(itemIcon(row({ id: 1, media_kind: "document", mime_type: "application/pdf" }))).toBe("file");
  });

  it("mediaKindOf: image by type, document by text/pdf/office extension, anything else is other", () => {
    expect(mediaKindOf({ type: "image/jpeg", name: "a.jpg" })).toBe("image");
    expect(mediaKindOf({ type: "text/plain", name: "a.txt" })).toBe("document");
    expect(mediaKindOf({ type: "application/pdf", name: "a" })).toBe("document");
    for (const name of ["a.doc", "a.DOCX", "a.xls", "a.xlsx", "a.ppt", "a.pptx", "a.csv"]) expect(mediaKindOf({ type: "", name })).toBe("document");
    expect(mediaKindOf({ type: "", name: "a.docxx" })).toBe("other");
    expect(mediaKindOf({ type: "audio/mpeg", name: "a.mp3" })).toBe("other");
    expect(mediaKindOf({ type: "", name: "doc" })).toBe("other");
  });

  it("normalizeUrl: https is assumed, http and https are kept, other schemes are refused, a non-address throws", () => {
    expect(normalizeUrl("example.com/a")).toBe("https://example.com/a");
    expect(normalizeUrl("  http://example.com  ")).toBe("http://example.com/");
    expect(normalizeUrl("HTTPS://Example.com")).toBe("https://example.com/");
    expect(() => normalizeUrl("javascript:alert(1)")).toThrow();
    expect(() => normalizeUrl("")).toThrow();
  });
});

describe("model: paths of an upload", () => {
  it("splitRelativePath: the last part is the file, the rest are folders; empty parts are dropped", () => {
    expect(splitRelativePath("Concert/Notes/a.pdf")).toEqual({ folders: ["Concert", "Notes"], fileName: "a.pdf" });
    expect(splitRelativePath("a.pdf")).toEqual({ folders: [], fileName: "a.pdf" });
    expect(splitRelativePath("/x//y/")).toEqual({ folders: ["x"], fileName: "y" });
    expect(splitRelativePath("")).toEqual({ folders: [], fileName: undefined });
  });

  it("storagePathOf: person, batch, then each folder and the name written safely, with no stray slash", () => {
    expect(storagePathOf("u-1", "b-1", [], "a b.pdf")).toBe("u-1/b-1/a-b.pdf");
    expect(storagePathOf("u-1", "b-1", ["Con cert", "Notes"], "a.pdf")).toBe("u-1/b-1/Con-cert/Notes/a.pdf");
  });

  it("deepestFolderLevel and tooDeepMessage: the deepest folder count of a selection, and the sentence when the tree would pass three levels", () => {
    expect(deepestFolderLevel([])).toBe(0);
    expect(deepestFolderLevel(["a.pdf", "x/a.pdf", "x/y/z/a.pdf", "q/a.pdf"])).toBe(3);
    expect(tooDeepMessage(0, 3)).toBeNull();
    expect(tooDeepMessage(2, 1)).toBeNull();
    expect(tooDeepMessage(2, 2)).toBe("This selection would create more than three folder levels (destination is already 2 levels deep). Choose a shallower folder or a less nested selection.");
    expect(tooDeepMessage(1, 3)).toContain("destination is already 1 level deep)");
  });
});

// ---------------------------------------------------------------------------------------------- the upload batch engine

function newBatch(patch: Partial<UploadBatch> = {}): UploadBatch {
  return { userId: "u-1", importId: "imp-1", folderId: 10, destinationScope: 4, visibility: "members", folderCache: new Map(), ...patch };
}

function newSink() {
  const added: ResourceItem[] = [];
  const replaced: Array<{ id: number; result: ResourceItem }> = [];
  const sink: UploadSink = {
    addRow: (item) => { added.push(item); },
    replaceRow: (id, change) => { replaced.push({ id, result: change(row({ id, status: "pending_upload" })) }); },
  };
  return { sink, added, replaced };
}

const entry = (name: string, relativePath: string, type = "application/pdf") => ({ file: new File(["abc"], name, { type }), relativePath, state: "queued" as const });

describe("upload-batch: shownMessage", () => {
  it("shows the sentence of an Error, of the Error an ApiError was made from, and the fallback for anything else", () => {
    expect(shownMessage(new Error("Bucket full"), "Upload failed")).toBe("Bucket full");
    expect(shownMessage(new ApiError("wrapped", { cause: new Error("Bucket full") }), "Upload failed")).toBe("Bucket full");
    // PostgREST answers with a plain object, which was never shown.
    expect(shownMessage(new ApiError("duplicate key value", { code: "23505", cause: { message: "duplicate key value" } }), "Upload failed")).toBe("Upload failed");
    expect(shownMessage({ message: "plain" }, "Upload failed")).toBe("Upload failed");
    expect(shownMessage("text", "Upload failed")).toBe("Upload failed");
    expect(shownMessage(undefined, "Upload failed")).toBe("Upload failed");
  });
});

describe("upload-batch: ensureFolderPath", () => {
  it("makes each folder of a path once, under the open folder, tagged with the batch, and answers with the last one", async () => {
    fake.from("resources", "insert").replyOnce(ok(row({ id: 21, node_kind: "folder", title: "Concert" }))).replyOnce(ok(row({ id: 22, node_kind: "folder", title: "Notes" })));
    const batch = newBatch();
    const { sink, added } = newSink();
    expect(await ensureFolderPath(batch, sink, "Concert/Notes")).toBe(22);
    const [first, second] = fake.from("resources", "insert").calls;
    expect(first.payload).toMatchObject({ node_kind: "folder", title: "Concert", parent_id: 10, subgroup_id: 4, visibility: "members", status: "ready", import_id: "imp-1", created_by: "u-1" });
    expect(second.payload).toMatchObject({ title: "Notes", parent_id: 21, import_id: "imp-1" });
    expect(added.map((item) => item.id)).toEqual([21, 22]);
    expect([...batch.folderCache]).toEqual([["Concert", 21], ["Concert/Notes", 22]]);
  });

  it("does not make a folder it already made for this batch, and an empty path is the open folder", async () => {
    const batch = newBatch({ folderCache: new Map([["Concert", 21]]) });
    const { sink } = newSink();
    expect(await ensureFolderPath(batch, sink, "Concert")).toBe(21);
    expect(await ensureFolderPath(batch, sink, "")).toBe(10);
    expect(await ensureFolderPath(newBatch({ folderId: null }), sink, "")).toBeNull();
    expect(fake.calls).toHaveLength(0);
  });

  it("cuts a folder name to 160 characters, and refuses when no row comes back", async () => {
    fake.from("resources", "insert").replyOnce(ok(row({ id: 40, node_kind: "folder" })));
    const { sink, added } = newSink();
    await ensureFolderPath(newBatch(), sink, "x".repeat(200));
    expect((fake.from("resources", "insert").calls[0].payload as { title: string }).title).toBe("x".repeat(160));
    expect(added.map((item) => item.id)).toEqual([40]);
    answerNull.add("createImportedFolder");
    await expect(ensureFolderPath(newBatch(), sink, "Concert")).rejects.toThrow("Folder “Concert” could not be created");
    expect(added).toHaveLength(1);
  });

  it("lets the database's refusal through as an ApiError, and makes no later folder", async () => {
    fake.from("resources", "insert").replyOnce(fail("row-level security", "42501"));
    const { sink } = newSink();
    await expect(ensureFolderPath(newBatch(), sink, "A/B")).rejects.toMatchObject({ name: "ApiError", code: "42501" });
    expect(fake.from("resources", "insert").calls).toHaveLength(1);
  });
});

describe("upload-batch: uploadOne", () => {
  it("sends the row (pending_upload), then the file, then marks the row ready, in that order", async () => {
    fake.from("resources", "insert").replyOnce(ok(row({ id: 30, node_kind: "folder", title: "Concert" }))).replyOnce(ok(row({ id: 31, status: "pending_upload" })));
    fake.storage("club-resources", "upload").reply(ok({ path: "x" }));
    fake.from("resources", "update").reply(ok(row({ id: 31, status: "ready", title: "a.pdf" })));
    const { sink, added, replaced } = newSink();
    const file = entry("Raga Notes.pdf", "Concert/Raga Notes.pdf");
    await uploadOne(newBatch({ folderId: null }), sink, file);
    // Concert (folder row), then the file's row, the file itself (the upload reads the session first: no network), then the mark.
    expect(fake.calls.map((call) => `${call.kind}:${call.target}:${call.op}`)).toEqual(["from:resources:insert", "from:resources:insert", "auth:auth:getSession", "storage:club-resources:upload", "from:resources:update"]);
    const [, pending] = fake.from("resources", "insert").calls;
    expect(pending.payload).toEqual({
      node_kind: "file", media_kind: "document", title: "Raga Notes.pdf", description: "", parent_id: 30, subgroup_id: 4, visibility: "members", storage_bucket: "club-resources", storage_path: "u-1/imp-1/Concert/Raga-Notes.pdf",
      original_filename: "Raga Notes.pdf", mime_type: "application/pdf", byte_size: 3, status: "pending_upload", is_pinned: false, import_id: "imp-1", created_by: "u-1",
    });
    const [upload] = fake.storage("club-resources", "upload").calls;
    expect(upload.args[0]).toBe("u-1/imp-1/Concert/Raga-Notes.pdf");
    expect(upload.args[1]).toBe(file.file);
    expect(upload.args[2]).toEqual({ upsert: false });
    expect((upload.args[1] as File).type).toBe("application/pdf");
    const [mark] = fake.from("resources", "update").calls;
    expect((mark.payload as { status: string }).status).toBe("ready");
    expect(mark.used("eq", "id", 31)).toBe(true);
    expect(added.map((item) => item.id)).toEqual([30, 31]);
    expect(replaced).toEqual([{ id: 31, result: expect.objectContaining({ status: "ready", id: 31 }) }]);
  });

  it("a file with no type goes up as application/octet-stream, as kind other, with its own name when the path has none", async () => {
    fake.from("resources", "insert").reply(ok(row({ id: 32, status: "pending_upload" })));
    fake.storage("club-resources", "upload").reply(ok({ path: "x" }));
    fake.from("resources", "update").reply(ok(row({ id: 32 })));
    const { sink } = newSink();
    await uploadOne(newBatch(), sink, { file: new File(["z"], "blob.bin", { type: "" }), relativePath: "", state: "queued" });
    const [pending] = fake.from("resources", "insert").calls;
    expect(pending.payload).toMatchObject({ media_kind: "other", mime_type: "application/octet-stream", title: "blob.bin", original_filename: "blob.bin", parent_id: 10, storage_path: "u-1/imp-1/blob.bin" });
    // The file has no type of its own: it is sent as the type the row says (what a browser writes for such a part, and what the bucket takes for scores).
    const [sent] = fake.storage("club-resources", "upload").calls;
    expect(sent.args[2]).toEqual({ upsert: false });
    expect((sent.args[1] as File).type).toBe("application/octet-stream");
  });

  it("cuts the title of the row to 160 characters and keeps the whole file name beside it", async () => {
    const longName = `${"n".repeat(200)}.pdf`;
    fake.from("resources", "insert").reply(ok(row({ id: 36, status: "pending_upload" })));
    fake.storage("club-resources", "upload").reply(ok({ path: "x" }));
    fake.from("resources", "update").reply(ok(row({ id: 36 })));
    await uploadOne(newBatch(), newSink().sink, entry(longName, longName));
    expect(fake.from("resources", "insert").calls[0].payload).toMatchObject({ title: longName.slice(0, 160), original_filename: longName });
  });

  it("when the file does not go up, the row is marked failed and shown failed, and the upload's own error is thrown", async () => {
    fake.from("resources", "insert").reply(ok(row({ id: 33, status: "pending_upload" })));
    fake.storage("club-resources", "upload").reply(fail("The object exceeded the maximum allowed size"));
    fake.from("resources", "update").reply(ok(null));
    const { sink, replaced } = newSink();
    const thrown = await uploadOne(newBatch(), sink, entry("big.pdf", "big.pdf")).then(() => null, (error: unknown) => error);
    expect(shownMessage(thrown, "Upload failed")).toBe("The object exceeded the maximum allowed size");
    const [mark] = fake.from("resources", "update").calls;
    expect(mark.payload).toEqual({ status: "failed" });
    expect(mark.used("eq", "id", 33)).toBe(true);
    expect(replaced).toEqual([{ id: 33, result: expect.objectContaining({ status: "failed" }) }]);
  });

  it("a mark that cannot be made does not hide why the upload failed", async () => {
    fake.from("resources", "insert").reply(ok(row({ id: 34, status: "pending_upload" })));
    fake.storage("club-resources", "upload").reply(rejects(new Error("Failed to fetch")));
    fake.from("resources", "update").reply(fail("permission denied"));
    const { sink, replaced } = newSink();
    await expect(uploadOne(newBatch(), sink, entry("a.pdf", "a.pdf"))).rejects.toThrow("Failed to fetch");
    expect(replaced).toEqual([{ id: 34, result: expect.objectContaining({ status: "failed" }) }]);
  });

  it("when the row cannot be marked ready it is marked failed, and when no row comes back it says it could not be finalized", async () => {
    fake.from("resources", "insert").reply(ok(row({ id: 35, status: "pending_upload" })));
    fake.storage("club-resources", "upload").reply(ok({ path: "x" }));
    fake.from("resources", "update").replyOnce(fail("boom")).reply(ok(null));
    const first = newSink();
    await expect(uploadOne(newBatch(), first.sink, entry("a.pdf", "a.pdf"))).rejects.toMatchObject({ name: "ApiError", message: "boom" });
    expect(fake.from("resources", "update").calls.map((call) => (call.payload as { status: string }).status)).toEqual(["ready", "failed"]);
    expect(first.replaced).toEqual([{ id: 35, result: expect.objectContaining({ status: "failed" }) }]);

    fake.from("resources", "update").reply(ok(null));
    answerNull.add("markResourceReady");
    const second = newSink();
    await expect(uploadOne(newBatch(), second.sink, entry("b.pdf", "b.pdf"))).rejects.toThrow("File record could not be finalized");
    expect(second.replaced.map((r) => r.result.status)).toEqual(["failed"]);
  });

  it("when no row comes back for the file, nothing is uploaded", async () => {
    answerNull.add("createPendingResourceFile");
    const { sink, added } = newSink();
    await expect(uploadOne(newBatch(), sink, entry("a.pdf", "a.pdf"))).rejects.toThrow("File record could not be created");
    expect(added).toHaveLength(0);
    expect(fake.storage("club-resources", "upload").calls).toHaveLength(0);
  });
});

// ------------------------------------------------------------------------------------------------------ the thumbnails

describe("thumbnails: attachThumbnails", () => {
  beforeEach(() => setCacheOwner("u-1"));
  const image = (id: number, patch: Partial<ResourceItem> = {}) => row({ id, media_kind: "image", mime_type: "image/png", storage_path: `u/${id}.png`, ...patch });

  it("signs the images in one request per bucket, attaches the links and keeps them for the next list", async () => {
    fake.storage("club-resources", "createSignedUrls").reply(ok([{ path: "u/1.png", signedUrl: "https://signed/1" }, { path: "u/2.png", signedUrl: "https://signed/2" }]));
    fake.storage("other-bucket", "createSignedUrls").reply(ok([{ path: "u/3.png", signedUrl: "https://signed/3" }]));
    const list = [image(1), image(2), image(3, { storage_bucket: "other-bucket" }), row({ id: 4, media_kind: "document" }), image(5, { node_kind: "folder", storage_path: null })];
    const shown = await attachThumbnails("u-1", list);
    expect(shown.map((item) => item.signedUrl)).toEqual(["https://signed/1", "https://signed/2", "https://signed/3", undefined, undefined]);
    const requests = fake.calls.map((call) => ({ bucket: call.target, paths: call.args[0], ttl: call.args[1] }));
    expect(requests).toEqual([
      { bucket: "club-resources", paths: ["u/1.png", "u/2.png"], ttl: 3600 },
      { bucket: "other-bucket", paths: ["u/3.png"], ttl: 3600 },
    ]);
    expect(readCache<{ url: string }>("u-1", thumbnailCacheKey("club-resources", "u/1.png"))?.url).toBe("https://signed/1");
    // The same list again asks for nothing.
    const again = await attachThumbnails("u-1", list);
    expect(again.map((item) => item.signedUrl)).toEqual(["https://signed/1", "https://signed/2", "https://signed/3", undefined, undefined]);
    expect(fake.calls).toHaveLength(2);
  });

  it("an expired link in the cache is signed again, and a request that gives no link leaves the row without one", async () => {
    writeCache("u-1", thumbnailCacheKey("club-resources", "u/1.png"), { url: "https://old", expires: Date.now() - 1000 });
    fake.storage("club-resources", "createSignedUrls").reply(ok([{ path: "u/1.png", signedUrl: null }, { path: null, signedUrl: "https://nowhere" }]));
    const [shown] = await attachThumbnails("u-1", [image(1)]);
    expect(fake.calls).toHaveLength(1);
    expect(shown.signedUrl).toBeUndefined();
  });

  it("a link already kept is attached only to a ready-to-show image file, not to a document or a folder", async () => {
    const entryFor = (path: string) => writeCache("u-1", thumbnailCacheKey("club-resources", path), { url: `https://kept/${path}`, expires: Date.now() + 60_000 });
    for (const path of ["u/1.png", "u/2.pdf", "u/3.png"]) entryFor(path);
    const list = [image(1), row({ id: 2, media_kind: "document", mime_type: "application/pdf", storage_path: "u/2.pdf" }), image(3, { node_kind: "folder" })];
    expect((await attachThumbnails("u-1", list)).map((item) => item.signedUrl)).toEqual(["https://kept/u/1.png", undefined, undefined]);
    expect(fake.calls).toHaveLength(0);
  });

  it("a request that fails is not an error: the rows come back as they were", async () => {
    fake.storage("club-resources", "createSignedUrls").reply(fail("nope"));
    const list = [image(1)];
    expect(await attachThumbnails("u-1", list)).toEqual(list);
  });
});
