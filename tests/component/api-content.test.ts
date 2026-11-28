// lib/api/announcements.ts, lib/api/resources.ts and lib/api/public.ts against the fake Supabase client: each function sends exactly the
// call the screens used to write by hand (table, operation, chain, payload, arguments), an answer with an error becomes an ApiError
// that keeps the database's message and code, and a write that matched no row answers with an empty list for the caller to refuse.
//
// What each function stands for is in the call it checks; the screens' own behaviour (toasts, dialogs) is in the component tests of
// announcements, resources and the public pages.
import { beforeEach, describe, expect, it } from "vitest";
import { createAnnouncement, deleteAnnouncement, setAnnouncementPinned, updateAnnouncement } from "../../lib/api/announcements";
import { listPublicConcertRecordings, signInWithGoogle, signPublicConcertUrl } from "../../lib/api/public";
import {
  RESOURCE_FIELDS, countArchivedResources, countFolderChildren, countLiveResources, createImportedFolder, createPendingResourceFile, createResourceFolder, createResourceImport, createResourceLink,
  deleteResource, failResourceImport, fetchResource, finishResourceImport, listArchivedAmong, listChildFolderIds, listResourcesPage, markResourceFailed, markResourceReady, removeResourceFile,
  setResourceArchived, setResourcePinned, setResourceVisibility, signResourceFile, signResourceThumbnails, updateResourceDetails, uploadResourceFile,
} from "../../lib/api/resources";
import { ApiError } from "../../lib/errors";
import { buildListPlan, THUMBNAIL_TTL_SECONDS } from "../../lib/resources-query";
import { fail, fake, ok, rejects, withCount } from "../support/fake-supabase";
import { routeUploadsToFakeClient } from "./content-uploads";

// Uploads go through XMLHttpRequest (Phase 3.1): the scripted answers of `fake.storage(bucket, "upload")` still decide them.
beforeEach(() => { routeUploadsToFakeClient(); });

async function thrownBy(action: () => Promise<unknown>): Promise<ApiError> {
  try { await action(); } catch (error) { expect(error).toBeInstanceOf(ApiError); return error as ApiError; }
  throw new Error("expected the call to throw");
}

const FIELDS = { title: "Rehearsal moved", body: "Now at 7", is_pinned: true, subgroup_id: 4 };

describe("lib/api/announcements", () => {
  it("updateAnnouncement: update of the four fields on the id, asking for the id back, and answers with the rows changed", async () => {
    fake.from("announcements", "update").reply(ok([{ id: 9 }]));
    expect(await updateAnnouncement(9, FIELDS)).toEqual([{ id: 9 }]);
    const [call] = fake.from("announcements", "update").calls;
    expect(call.payload).toEqual(FIELDS);
    expect(call.chain.map((link) => link.method)).toEqual(["update", "eq", "select"]);
    expect(call.used("eq", "id", 9)).toBe(true);
    expect(call.used("select", "id")).toBe(true);
  });

  it("updateAnnouncement: an update that matched no row answers with an empty list, not an error", async () => {
    fake.from("announcements", "update").reply(ok([]));
    expect(await updateAnnouncement(9, FIELDS)).toEqual([]);
    fake.from("announcements", "update").reply(ok(null));
    expect(await updateAnnouncement(9, FIELDS)).toEqual([]);
  });

  it("createAnnouncement: insert of the four fields and the author, asking for the id back", async () => {
    fake.from("announcements", "insert").reply(ok([{ id: 3 }]));
    expect(await createAnnouncement(FIELDS, "u-1")).toEqual([{ id: 3 }]);
    const [call] = fake.from("announcements", "insert").calls;
    expect(call.payload).toEqual({ ...FIELDS, created_by: "u-1" });
    expect(call.used("select", "id")).toBe(true);
  });

  it("setAnnouncementPinned and deleteAnnouncement: an update of is_pinned, a delete, both on the id", async () => {
    await setAnnouncementPinned(4, false);
    await deleteAnnouncement(4);
    const [pin] = fake.from("announcements", "update").calls;
    expect(pin.payload).toEqual({ is_pinned: false });
    expect(pin.used("eq", "id", 4)).toBe(true);
    const [del] = fake.from("announcements", "delete").calls;
    expect(del.used("eq", "id", 4)).toBe(true);
    expect(fake.calls.map((call) => call.op)).toEqual(["update", "delete"]);
  });

  it("a database error is an ApiError with the database's message and code", async () => {
    fake.from("announcements").reply(fail('new row violates row-level security policy for table "announcements"', "42501"));
    for (const action of [() => updateAnnouncement(1, FIELDS), () => createAnnouncement(FIELDS, "u"), () => setAnnouncementPinned(1, true), () => deleteAnnouncement(1)]) {
      const error = await thrownBy(action);
      expect(error.message).toBe('new row violates row-level security policy for table "announcements"');
      expect(error.code).toBe("42501");
    }
  });
});

describe("lib/api/public", () => {
  it("listPublicConcertRecordings: the public recordings, newest event first, with only the columns the page shows", async () => {
    fake.from("archive_items", "select").reply(ok([{ id: 1, title: "Diwali" }]));
    expect(await listPublicConcertRecordings()).toEqual([{ id: 1, title: "Diwali" }]);
    const [call] = fake.from("archive_items", "select").calls;
    expect(call.uses("select")).toEqual([["id,title,description,type,storage_path,event_date,raga,tala,created_at,is_public"]]);
    expect(call.used("eq", "type", "recording")).toBe(true);
    expect(call.used("eq", "is_public", true)).toBe(true);
    expect(call.uses("order")).toEqual([["event_date", { ascending: false }]]);
  });

  it("listPublicConcertRecordings: an error is thrown", async () => {
    fake.from("archive_items", "select").reply(fail("canceling statement due to statement timeout"));
    expect((await thrownBy(() => listPublicConcertRecordings())).message).toBe("canceling statement due to statement timeout");
  });

  it("signPublicConcertUrl: a link for ten minutes from the club-archive bucket; null when none could be made", async () => {
    expect(await signPublicConcertUrl("concerts/a.mp3")).toBe("https://files.test/club-archive/concerts/a.mp3?signed");
    const [call] = fake.storage("club-archive", "createSignedUrl").calls;
    expect(call.args).toEqual(["concerts/a.mp3", 600]);
    fake.storage("club-archive", "createSignedUrl").reply(fail("Object not found"));
    expect(await signPublicConcertUrl("gone.mp3")).toBeNull();
  });

  it("signInWithGoogle: Google, redirecting back to the address it is given; an auth error is thrown as an ApiError", async () => {
    await signInWithGoogle("https://club.test");
    expect(fake.auth("signInWithOAuth").calls[0].payload).toEqual({ provider: "google", options: { redirectTo: "https://club.test" } });
    fake.auth("signInWithOAuth").reply(fail("Unsupported provider: provider is not enabled"));
    expect((await thrownBy(() => signInWithGoogle("https://club.test"))).message).toBe("Unsupported provider: provider is not enabled");
  });
});

describe("lib/api/resources: reads", () => {
  it("fetchResource: one row by id, all library columns, read as a maybe-row", async () => {
    fake.from("resources", "select").reply(ok({ id: 5, title: "Syllabus" }));
    expect(await fetchResource(5)).toEqual({ id: 5, title: "Syllabus" });
    const [call] = fake.from("resources", "select").calls;
    expect(call.uses("select")).toEqual([[RESOURCE_FIELDS]]);
    expect(call.used("eq", "id", 5)).toBe(true);
    expect(call.used("maybeSingle")).toBe(true);
    fake.from("resources", "select").reply(ok(null));
    expect(await fetchResource(6)).toBeNull();
  });

  it("listChildFolderIds: the ids of the folders that are not archived, directly under the given parents", async () => {
    fake.from("resources", "select").reply(ok([{ id: 11 }, { id: 12 }]));
    expect(await listChildFolderIds([1, 2])).toEqual([11, 12]);
    const [call] = fake.from("resources", "select").calls;
    expect(call.uses("select")).toEqual([["id"]]);
    expect(call.used("eq", "node_kind", "folder")).toBe(true);
    expect(call.used("neq", "status", "archived")).toBe(true);
    expect(call.used("in", "parent_id", [1, 2])).toBe(true);
  });

  it("listResourcesPage: the planned list, with the exact count only when asked for", async () => {
    const plan = buildListPlan({ folderId: 7, scope: "all", tab: "all", search: "", sort: "updated", archived: false, offset: 0, limit: 100 });
    fake.from("resources", "select").reply(ok([{ id: 1 }], { count: 41 }));
    expect(await listResourcesPage(plan, true)).toEqual({ rows: [{ id: 1 }], count: 41 });
    expect(await listResourcesPage(plan, false)).toEqual({ rows: [{ id: 1 }], count: 41 });
    const [first, next] = fake.from("resources", "select").calls;
    expect(first.uses("select")).toEqual([[RESOURCE_FIELDS, { count: "exact" }]]);
    expect(next.uses("select")).toEqual([[RESOURCE_FIELDS, { count: undefined }]]);
    for (const call of [first, next]) {
      expect(call.used("neq", "status", "archived")).toBe(true);
      expect(call.used("eq", "parent_id", 7)).toBe(true);
      expect(call.used("range", 0, 99)).toBe(true);
    }
    expect(first.uses("order").map(([column]) => column)).toEqual(["is_pinned", "updated_at", "id"]);
  });

  it("listResourcesPage: no rows and no count answer an empty page and a null count; an error is thrown", async () => {
    const plan = buildListPlan({ folderId: null, scope: "all", tab: "all", search: "", sort: "updated", archived: false, offset: 0, limit: 100 });
    fake.from("resources", "select").reply(ok(null));
    expect(await listResourcesPage(plan, true)).toEqual({ rows: [], count: null });
    fake.from("resources", "select").reply(fail("canceling statement due to statement timeout", "57014"));
    const error = await thrownBy(() => listResourcesPage(plan, true));
    expect(error.message).toBe("canceling statement due to statement timeout");
    expect(error.code).toBe("57014");
  });

  it("listArchivedAmong: asks for the id and status of the given rows and keeps the archived ones", async () => {
    fake.from("resources", "select").reply(ok([{ id: 1, status: "archived" }, { id: 2, status: "ready" }, { id: 3, status: "archived" }]));
    expect(await listArchivedAmong([1, 2, 3])).toEqual([1, 3]);
    const [call] = fake.from("resources", "select").calls;
    expect(call.uses("select")).toEqual([["id,status"]]);
    expect(call.used("in", "id", [1, 2, 3])).toBe(true);
  });

  it("the three counts are head requests that read no rows: archived, live, and the children of one folder", async () => {
    fake.from("resources", "select").reply(withCount(4));
    expect(await countArchivedResources()).toBe(4);
    expect(await countLiveResources()).toBe(4);
    expect(await countFolderChildren(8)).toBe(4);
    const [archived, live, children] = fake.from("resources", "select").calls;
    for (const call of [archived, live, children]) expect(call.uses("select")).toEqual([["id", { count: "exact", head: true }]]);
    expect(archived.used("eq", "status", "archived")).toBe(true);
    expect(live.used("neq", "status", "archived")).toBe(true);
    expect(children.used("eq", "parent_id", 8)).toBe(true);
  });

  it("a count the server sends no number for is null, and a failed count is thrown", async () => {
    fake.from("resources", "select").reply(ok(null));
    expect(await countLiveResources()).toBeNull();
    fake.from("resources", "select").reply(fail("boom"));
    for (const action of [countArchivedResources, countLiveResources, () => countFolderChildren(1)]) expect((await thrownBy(action)).message).toBe("boom");
  });
});

describe("lib/api/resources: the club-resources bucket", () => {
  it("signResourceThumbnails: one request for the paths of one bucket, for the thumbnail time", async () => {
    const signed = await signResourceThumbnails("club-resources", ["a.png", "b.png"]);
    expect(signed.map((entry) => entry.path)).toEqual(["a.png", "b.png"]);
    expect(fake.storage("club-resources", "createSignedUrls").calls[0].args).toEqual([["a.png", "b.png"], THUMBNAIL_TTL_SECONDS]);
  });

  it("signResourceThumbnails: a failed request gives no links and is not an error (a thumbnail is a nicety)", async () => {
    fake.storage("club-resources", "createSignedUrls").reply(fail("Bucket not found"));
    expect(await signResourceThumbnails("club-resources", ["a.png"])).toEqual([]);
  });

  it("signResourceFile: a link for five minutes from the file's own bucket; null when none could be made", async () => {
    expect(await signResourceFile("club-resources", "u/1/a.pdf")).toBe("https://files.test/club-resources/u/1/a.pdf?signed");
    expect(fake.storage("club-resources", "createSignedUrl").calls[0].args).toEqual(["u/1/a.pdf", 300]);
    fake.storage("*", "createSignedUrl").reply(fail("Object not found"));
    expect(await signResourceFile("club-resources", "gone.pdf")).toBeNull();
  });

  it("uploadResourceFile: into club-resources, with the content type, never replacing a file; a storage error is thrown", async () => {
    const file = new File(["x"], "a.pdf", { type: "application/pdf" });
    await uploadResourceFile("u/1/a.pdf", file, "application/pdf");
    const [call] = fake.storage("club-resources", "upload").calls;
    // The upload goes through XMLHttpRequest (Phase 3.1): the options are `{ upsert }` and the content type is the one of the file part.
    expect(call.args).toEqual(["u/1/a.pdf", file, { upsert: false }]);
    expect((call.args[1] as File).type).toBe("application/pdf");
    fake.storage("club-resources", "upload").reply(fail("The object exceeded the maximum allowed size"));
    const error = await thrownBy(() => uploadResourceFile("u/1/b.pdf", file, "application/pdf"));
    expect(error.message).toBe("The object exceeded the maximum allowed size");
    // What was thrown remembers the storage error itself: an Error, which the upload list shows the sentence of.
    expect(error.cause).toBeInstanceOf(Error);
  });

  it("removeResourceFile: removes the file and says nothing (null) when it is gone", async () => {
    expect(await removeResourceFile("club-resources", "u/1/a.pdf")).toBeNull();
    expect(fake.storage("club-resources", "remove").calls[0].args).toEqual([["u/1/a.pdf"]]);
  });

  it("removeResourceFile: an empty answer from storage is a refused delete, unless the file can no longer be signed", async () => {
    fake.storage("club-resources", "remove").reply(ok([]));
    expect(await removeResourceFile("club-resources", "u/1/a.pdf")).toBe("The file could not be deleted, so nothing was removed.");
    fake.storage("club-resources", "createSignedUrl").reply(fail("Object not found"));
    expect(await removeResourceFile("club-resources", "u/1/a.pdf")).toBeNull();
    // It asked storage whether the file can still be signed, for a minute.
    expect(fake.storage("club-resources", "createSignedUrl").calls[0].args).toEqual(["u/1/a.pdf", 60]);
  });

  it("removeResourceFile: a storage error is the sentence for the person; a dropped connection says so", async () => {
    fake.storage("club-resources", "remove").reply(fail("Bucket not found"));
    expect(await removeResourceFile("club-resources", "x")).toBe("Bucket not found");
    fake.storage("club-resources", "remove").reply(rejects());
    expect(await removeResourceFile("club-resources", "x")).toBe("The connection dropped. Check your internet and try again.");
  });
});

describe("lib/api/resources: creating", () => {
  const node = { title: "Fall concert", description: "Planning", parentId: 7, subgroupId: 3, visibility: "members" as const, userId: "u-1" };

  it("createResourceFolder: a ready folder in the open place, written by the person, with every library column read back", async () => {
    fake.from("resources", "insert").reply(ok({ id: 50 }));
    expect(await createResourceFolder(node)).toEqual({ id: 50 });
    const [call] = fake.from("resources", "insert").calls;
    expect(call.payload).toEqual({ node_kind: "folder", media_kind: null, title: "Fall concert", description: "Planning", parent_id: 7, subgroup_id: 3, visibility: "members", status: "ready", is_pinned: false, created_by: "u-1" });
    expect(call.chain.map((link) => link.method)).toEqual(["insert", "select", "single"]);
    expect(call.used("select", RESOURCE_FIELDS)).toBe(true);
  });

  it("createResourceLink: a ready link with its address", async () => {
    fake.from("resources", "insert").reply(ok({ id: 51 }));
    await createResourceLink({ ...node, externalUrl: "https://docs.google.com/d/abc" });
    expect(fake.from("resources", "insert").calls[0].payload).toEqual({ node_kind: "link", media_kind: null, title: "Fall concert", description: "Planning", parent_id: 7, subgroup_id: 3, visibility: "members", external_url: "https://docs.google.com/d/abc", status: "ready", is_pinned: false, created_by: "u-1" });
  });

  it("createImportedFolder: the same folder, tagged with the upload batch", async () => {
    fake.from("resources", "insert").reply(ok({ id: 52 }));
    await createImportedFolder({ ...node, description: "", importId: "imp-1" });
    expect(fake.from("resources", "insert").calls[0].payload).toEqual({ node_kind: "folder", media_kind: null, title: "Fall concert", description: "", parent_id: 7, subgroup_id: 3, visibility: "members", status: "ready", is_pinned: false, import_id: "imp-1", created_by: "u-1" });
  });

  it("createPendingResourceFile: a file row waiting for its upload, pointing at its place in club-resources", async () => {
    fake.from("resources", "insert").reply(ok({ id: 53 }));
    await createPendingResourceFile({ ...node, description: "", mediaKind: "document", storagePath: "u-1/imp-1/a.pdf", originalFilename: "a.pdf", mimeType: "application/pdf", byteSize: 2048, importId: "imp-1" });
    expect(fake.from("resources", "insert").calls[0].payload).toEqual({
      node_kind: "file", media_kind: "document", title: "Fall concert", description: "", parent_id: 7, subgroup_id: 3, visibility: "members", storage_bucket: "club-resources", storage_path: "u-1/imp-1/a.pdf",
      original_filename: "a.pdf", mime_type: "application/pdf", byte_size: 2048, status: "pending_upload", is_pinned: false, import_id: "imp-1", created_by: "u-1",
    });
  });

  it("an insert the database refuses is an ApiError with its message; a missing row is null", async () => {
    fake.from("resources", "insert").reply(fail("resource hierarchy cannot exceed three folder levels", "P0001"));
    for (const action of [() => createResourceFolder(node), () => createResourceLink({ ...node, externalUrl: "https://x.test" }), () => createImportedFolder({ ...node, importId: "i" })]) {
      const error = await thrownBy(action);
      expect(error.message).toBe("resource hierarchy cannot exceed three folder levels");
      expect(error.code).toBe("P0001");
    }
  });

  it("markResourceReady: status ready with the time, on the id, reading the row back; markResourceFailed: only the status", async () => {
    fake.from("resources", "update").reply(ok({ id: 53, status: "ready" }));
    expect(await markResourceReady(53)).toEqual({ id: 53, status: "ready" });
    await markResourceFailed(53);
    const [ready, failed] = fake.from("resources", "update").calls;
    expect(ready.payload).toMatchObject({ status: "ready" });
    expect(typeof (ready.payload as { updated_at: string }).updated_at).toBe("string");
    expect(ready.used("eq", "id", 53)).toBe(true);
    expect(ready.chain.map((link) => link.method)).toEqual(["update", "eq", "select", "single"]);
    expect(failed.payload).toEqual({ status: "failed" });
    expect(failed.used("eq", "id", 53)).toBe(true);
  });
});

describe("lib/api/resources: upload batches", () => {
  it("createResourceImport: records the batch as uploading, with its totals, and answers with its id", async () => {
    fake.from("resource_imports", "insert").reply(ok({ id: "imp-1" }));
    expect(await createResourceImport({ name: "3 uploaded resources", rootParentId: 7, subgroupId: null, visibility: "executives", totalFiles: 3, totalBytes: 300, userId: "u-1" })).toEqual({ id: "imp-1" });
    const [call] = fake.from("resource_imports", "insert").calls;
    expect(call.payload).toEqual({ name: "3 uploaded resources", root_parent_id: 7, subgroup_id: null, visibility: "executives", status: "uploading", total_files: 3, completed_files: 0, failed_files: 0, total_bytes: 300, uploaded_bytes: 0, created_by: "u-1" });
    expect(call.chain.map((link) => link.method)).toEqual(["insert", "select", "single"]);
    expect(call.used("select", "id")).toBe(true);
  });

  it("failResourceImport and finishResourceImport: update the batch by id", async () => {
    await failResourceImport("imp-1", 3);
    await finishResourceImport("imp-1", { completedFiles: 2, failedFiles: 1, uploadedBytes: 200, status: "partial" });
    const [failed, finished] = fake.from("resource_imports", "update").calls;
    expect(failed.payload).toEqual({ status: "failed", failed_files: 3 });
    expect(finished.payload).toEqual({ completed_files: 2, failed_files: 1, uploaded_bytes: 200, status: "partial" });
    expect(failed.used("eq", "id", "imp-1")).toBe(true);
    expect(finished.used("eq", "id", "imp-1")).toBe(true);
  });

  it("a batch the database refuses to record is an ApiError with its message", async () => {
    fake.from("resource_imports", "insert").reply(fail("You do not have permission to add resources here"));
    expect((await thrownBy(() => createResourceImport({ name: "x", rootParentId: null, subgroupId: null, visibility: "members", totalFiles: 1, totalBytes: 1, userId: "u" }))).message).toBe("You do not have permission to add resources here");
  });
});

describe("lib/api/resources: changing one item", () => {
  it("updateResourceDetails: a name and a description, plus the address only when one is given; answers with the rows changed", async () => {
    fake.from("resources", "update").reply(ok([{ id: 5 }]));
    expect(await updateResourceDetails(5, { title: "New", description: "d" })).toEqual([{ id: 5 }]);
    await updateResourceDetails(6, { title: "Link", description: "", external_url: "https://x.test/" });
    const [file, link] = fake.from("resources", "update").calls;
    expect(file.payload).toEqual({ title: "New", description: "d" });
    // Not even an empty address: a folder or a file has none to change.
    expect(Object.keys(file.payload as object)).toEqual(["title", "description"]);
    expect(link.payload).toEqual({ title: "Link", description: "", external_url: "https://x.test/" });
    expect(file.used("eq", "id", 5)).toBe(true);
    expect(file.used("select", "id")).toBe(true);
  });

  it("an update or delete that matches no row answers with an empty list, not an error", async () => {
    fake.from("resources").reply(ok([]));
    expect(await updateResourceDetails(5, { title: "t", description: "" })).toEqual([]);
    expect(await setResourcePinned(5, true)).toEqual([]);
    expect(await deleteResource(5)).toEqual([]);
    fake.from("resources").reply(ok(null));
    expect(await deleteResource(5)).toEqual([]);
  });

  it("setResourcePinned and deleteResource: an update of is_pinned and a delete, on the id, asking for the id back", async () => {
    fake.from("resources").reply(ok([{ id: 5 }]));
    expect(await setResourcePinned(5, true)).toEqual([{ id: 5 }]);
    expect(await deleteResource(5)).toEqual([{ id: 5 }]);
    const [pin] = fake.from("resources", "update").calls;
    const [del] = fake.from("resources", "delete").calls;
    expect(pin.payload).toEqual({ is_pinned: true });
    for (const call of [pin, del]) {
      expect(call.used("eq", "id", 5)).toBe(true);
      expect(call.used("select", "id")).toBe(true);
    }
  });

  it("setResourceVisibility and setResourceArchived: the database functions, with their argument names", async () => {
    await setResourceVisibility(5, "executives");
    await setResourceArchived(5, true);
    expect(fake.rpc("set_resource_visibility").calls[0].args[0]).toEqual({ p_resource_id: 5, p_visibility: "executives" });
    expect(fake.rpc("set_resource_archived").calls[0].args[0]).toEqual({ p_resource_id: 5, p_archived: true });
  });

  it("a refused change is an ApiError with the database's sentence", async () => {
    fake.rpc("set_resource_visibility").reply(fail("Only executives can change who sees a resource", "P0001"));
    const error = await thrownBy(() => setResourceVisibility(5, "members"));
    expect(error.message).toBe("Only executives can change who sees a resource");
    expect(error.code).toBe("P0001");
    fake.rpc("set_resource_archived").reply(fail("resource not found"));
    expect((await thrownBy(() => setResourceArchived(5, false))).message).toBe("resource not found");
    fake.from("resources").reply(fail("permission denied for table resources", "42501"));
    for (const action of [() => updateResourceDetails(5, { title: "t", description: "" }), () => setResourcePinned(5, true), () => deleteResource(5)]) expect((await thrownBy(action)).code).toBe("42501");
  });
});
