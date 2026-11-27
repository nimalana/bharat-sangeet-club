// Resource library: folders, files in club-resources, rename, pin, visibility, archive, restore,
// delete (file first), failed uploads, and what a group manager may do. The list query is built by
// the app's own lib/resources-query.ts, so the request is the one the screen sends.
import { ok, equal, refused, succeeded, rowsOf, nothingHappened, describeError } from "../lib/assert.mjs";
import { mark } from "../lib/ctx.mjs";
import { pdf, text, sha256 } from "../lib/fixtures.mjs";
import { put, sign, download, listed, freshUrl, proveGone, uid } from "../lib/storage.mjs";
import { applyListPlan, buildListPlan } from "../../../lib/resources-query.ts";

const FIELDS = "id,node_kind,media_kind,title,description,parent_id,subgroup_id,visibility,storage_bucket,storage_path,external_url,original_filename,mime_type,byte_size,checksum_sha256,event_id,occurred_on,season_label,status,is_pinned,import_id,created_by,created_at,updated_at";
const safeSegment = (value) => value.normalize("NFKC").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "file";

// What ResourceActions.deleteForGood does for a file: file first, then the row.
async function deleteLikeTheApp(client, item) {
  if (item.node_kind === "file" && item.storage_path) {
    const bucket = item.storage_bucket || "club-resources";
    const removed = await client.storage.from(bucket).remove([item.storage_path]);
    if (removed.error) return { ok: false, why: `file: ${describeError(removed.error)}` };
    if (!removed.data?.length) {
      const still = await client.storage.from(bucket).createSignedUrl(item.storage_path, 60);
      if (still.data?.signedUrl) return { ok: false, why: "the file could not be deleted, so nothing was removed" };
    }
  }
  const row = await client.from("resources").delete().eq("id", item.id).select("id");
  if (row.error || !row.data?.length) return { ok: false, why: `row: ${row.error ? describeError(row.error) : "no row deleted"}` };
  return { ok: true };
}

export default async function resources(t, ctx) {
  const { c, id } = ctx;
  const g = ctx.state.g;
  const s = (ctx.state.res = {});
  t.setSection("40 resources");

  await t.test("executive creates a top-level folder and uploads a PDF into it exactly as the library does (import batch, pending row, upload, ready)", async () => {
    s.folder = succeeded(await c.execA.from("resources").insert({ node_kind: "folder", media_kind: null, title: mark("Folder"), description: "", parent_id: null, subgroup_id: null, visibility: "members", status: "ready", is_pinned: false, created_by: id.execA }).select(FIELDS).single(), "create folder");
    s.bytes = pdf("resource");
    const imp = succeeded(await c.execA.from("resource_imports").insert({ name: "notes.pdf", root_parent_id: s.folder.id, subgroup_id: null, visibility: "members", status: "uploading", total_files: 1, completed_files: 0, failed_files: 0, total_bytes: s.bytes.length, uploaded_bytes: 0, created_by: id.execA }).select("id").single(), "create import batch");
    s.importId = String(imp.id);
    const path = `${id.execA}/${s.importId}/${safeSegment("notes.pdf")}`;
    const pending = succeeded(await c.execA.from("resources").insert({ node_kind: "file", media_kind: "document", title: mark("notes.pdf"), description: "", parent_id: s.folder.id, subgroup_id: null, visibility: "members", storage_bucket: "club-resources", storage_path: path, original_filename: "notes.pdf", mime_type: "application/pdf", byte_size: s.bytes.length, status: "pending_upload", is_pinned: false, import_id: s.importId, created_by: id.execA }).select(FIELDS).single(), "insert pending file row");
    s.file = pending;
    // While the upload is unfinished only its creator can see it.
    equal(rowsOf(await c.member1.from("resources").select("id").eq("id", pending.id), "member1 reads pending").length, 0, "a pending upload is visible to a member");
    const up = await put(c.execA, "club-resources", path, s.bytes, "application/pdf");
    succeeded(up, "upload to club-resources");
    const ready = succeeded(await c.execA.from("resources").update({ status: "ready", updated_at: new Date().toISOString() }).eq("id", pending.id).select(FIELDS).single(), "mark ready");
    equal(ready.status, "ready", "status after upload");
    succeeded(await c.execA.from("resource_imports").update({ completed_files: 1, failed_files: 0, uploaded_bytes: s.bytes.length, status: "completed" }).eq("id", s.importId), "finish import batch");
    s.fileUrl = (await sign(c.execA, "club-resources", path, 600)).data.signedUrl;
    ok(s.fileUrl, "executive could not sign the uploaded resource");
    s.fileFresh = await freshUrl(c.execA, "club-resources", path);
  });

  await t.test("a member lists the library with the app's own query (top level, then inside the folder) and opens the file; the bytes match", async () => {
    const top = await applyListPlan(c.member1.from("resources").select(FIELDS, { count: "exact" }), buildListPlan({ folderId: null, scope: "all", tab: "all", search: "", sort: "updated", archived: false, offset: 0, limit: 100 }));
    const topRows = rowsOf(top, "member1 top-level list");
    ok(topRows.some((r) => r.id === s.folder.id), "the new folder is missing from the top-level list");
    ok(top.count >= 1, `count header not returned (${top.count})`);
    const inside = rowsOf(await applyListPlan(c.member1.from("resources").select(FIELDS, { count: "exact" }), buildListPlan({ folderId: s.folder.id, scope: "all", tab: "all", search: "", sort: "updated", archived: false, offset: 0, limit: 100 })), "member1 folder list");
    ok(inside.some((r) => r.id === s.file.id), "the file is missing from the folder list");
    const searched = rowsOf(await applyListPlan(c.member1.from("resources").select(FIELDS), buildListPlan({ folderId: s.folder.id, scope: "all", tab: "documents", search: "notes", sort: "updated", archived: false, offset: 0, limit: 100, subtreeIds: [s.folder.id] })), "member1 search");
    ok(searched.some((r) => r.id === s.file.id), "search (ilike on title) did not find the file");
    const signed = succeeded(await sign(c.member1, "club-resources", s.file.storage_path, 300), "member1 signs the file");
    const got = await download(signed.signedUrl);
    equal(got.status, 200, "download status");
    equal(got.sha, sha256(s.bytes), "downloaded bytes");
    // Fetching this URL puts it in the CDN cache, which is why the delete proof below also uses an unfetched one.
    equal((await download(s.fileUrl)).status, 200, "executive's signed URL downloads");
  });

  await t.test("executive renames the file and folder and pins the file; members see the new names and the pin; members cannot edit or pin", async () => {
    equal(succeeded(await c.execA.from("resources").update({ title: mark("notes (renamed).pdf"), description: "renamed" }).eq("id", s.file.id).select("id"), "rename file").length, 1, "rows renamed");
    equal(succeeded(await c.execA.from("resources").update({ title: mark("Folder (renamed)"), description: "" }).eq("id", s.folder.id).select("id"), "rename folder").length, 1, "rows renamed");
    equal(succeeded(await c.execA.from("resources").update({ is_pinned: true }).eq("id", s.file.id).select("id"), "pin").length, 1, "rows pinned");
    const seen = succeeded(await c.member1.from("resources").select("title,is_pinned").eq("id", s.file.id).single(), "member reads");
    equal(seen.title, mark("notes (renamed).pdf"), "renamed title seen by member");
    equal(seen.is_pinned, true, "pin seen by member");
    nothingHappened(await c.member1.from("resources").update({ title: "hijacked" }).eq("id", s.file.id).select("id"), "member renaming");
    nothingHappened(await c.member1.from("resources").update({ is_pinned: false }).eq("id", s.file.id).select("id"), "member unpinning");
    succeeded(await c.execA.from("resources").update({ is_pinned: false }).eq("id", s.file.id), "unpin");
  });

  await t.test("visibility: limit the top-level folder to executives (whole subtree), members lose the folder, the file and the signed URL; share it again", async () => {
    refused(await c.manager.rpc("set_resource_visibility", { p_resource_id: s.folder.id, p_visibility: "executives" }), "group manager changing visibility", /executives/i);
    refused(await c.execA.rpc("set_resource_visibility", { p_resource_id: s.file.id, p_visibility: "executives" }), "changing visibility of an item inside a folder", /top-level folder/i);
    const changed = succeeded(await c.execA.rpc("set_resource_visibility", { p_resource_id: s.folder.id, p_visibility: "executives" }), "limit to executives");
    equal(changed, 2, "rows whose visibility changed (folder + file)");
    equal(rowsOf(await c.member1.from("resources").select("id").in("id", [s.folder.id, s.file.id]), "member reads").length, 0, "member still sees the folder or file");
    ok(!(await sign(c.member1, "club-resources", s.file.storage_path)).data?.signedUrl, "member could still sign the file");
    equal(rowsOf(await c.execB.from("resources").select("id").in("id", [s.folder.id, s.file.id]), "exec reads").length, 2, "an executive no longer sees them");
    succeeded(await c.execA.rpc("set_resource_visibility", { p_resource_id: s.folder.id, p_visibility: "members" }), "share with members");
    equal(rowsOf(await c.member1.from("resources").select("id").in("id", [s.folder.id, s.file.id]), "member reads again").length, 2, "member cannot see them after sharing again");
    ok((await sign(c.member1, "club-resources", s.file.storage_path)).data?.signedUrl, "member cannot sign after sharing again");
  });

  await t.test("archive and restore: an archived folder and its contents disappear for members (and from the live list), then return", async () => {
    refused(await c.manager.rpc("set_resource_archived", { p_resource_id: s.folder.id, p_archived: true }), "group manager archiving a club-wide folder", /permission/i);
    refused(await c.member1.rpc("set_resource_archived", { p_resource_id: s.folder.id, p_archived: true }), "member archiving", /permission/i);
    const changed = succeeded(await c.execA.rpc("set_resource_archived", { p_resource_id: s.folder.id, p_archived: true }), "archive");
    equal(changed, 2, "rows archived (folder + file)");
    const live = rowsOf(await applyListPlan(c.execA.from("resources").select(FIELDS), buildListPlan({ folderId: null, scope: "all", tab: "all", search: "", sort: "updated", archived: false, offset: 0, limit: 100 })), "live list");
    ok(!live.some((r) => r.id === s.folder.id), "archived folder is still in the live list");
    const archived = rowsOf(await applyListPlan(c.execA.from("resources").select(FIELDS), buildListPlan({ folderId: null, scope: "all", tab: "all", search: "", sort: "updated", archived: true, offset: 0, limit: 100 })), "archived list");
    ok(archived.some((r) => r.id === s.folder.id), "archived folder is missing from Show archived");
    const memberView = rowsOf(await c.member1.from("resources").select("id,status").in("id", [s.folder.id, s.file.id]), "member reads archived");
    equal(memberView.length, 0, "archived rows visible to a member");
    refused(await c.execA.rpc("set_resource_archived", { p_resource_id: s.file.id, p_archived: false }), "restoring a file whose folder is archived", /Restore the folder/i);
    const restored = succeeded(await c.execA.rpc("set_resource_archived", { p_resource_id: s.folder.id, p_archived: false }), "restore");
    equal(restored, 2, "rows restored");
    equal(rowsOf(await c.member1.from("resources").select("id").in("id", [s.folder.id, s.file.id]).eq("status", "ready"), "member reads restored").length, 2, "restored rows visible to member");
  });

  await t.test("a folder that still holds a file cannot be deleted (database refuses); deleting the file first, then the folder, works", async () => {
    const early = await c.execA.from("resources").delete().eq("id", s.folder.id).select("id");
    refused(early, "deleting a non-empty folder");
    const result = await deleteLikeTheApp(c.execA, s.file);
    ok(result.ok, `deleting the file as the app does: ${result.why}`);
    await proveGone({ execA: c.execA, execB: c.execB, member1: c.member1 }, "club-resources", s.file.storage_path, { fresh: s.fileFresh, fetched: s.fileUrl });
    equal(rowsOf(await c.execA.from("resources").select("id").eq("id", s.file.id), "re-read file row").length, 0, "file row after delete");
    const folder = await deleteLikeTheApp(c.execA, s.folder);
    ok(folder.ok, `deleting the empty folder: ${folder.why}`);
  });

  await t.test("discard a failed upload: the row is created, the upload is refused, the row is marked failed, then discarded (file call finds nothing, row is deleted)", async () => {
    const rowPath = `${id.execA}/${uid()}/declared.txt`;
    const row = succeeded(await c.execA.from("resources").insert({ node_kind: "file", media_kind: "document", title: mark("failing.txt"), description: "", parent_id: null, subgroup_id: null, visibility: "members", storage_bucket: "club-resources", storage_path: rowPath, original_filename: "failing.txt", mime_type: "text/plain", byte_size: 10, status: "pending_upload", is_pinned: false, created_by: id.execA }).select(FIELDS).single(), "pending row");
    // The upload goes to a path no resource row declares, so storage refuses it.
    const refusedUpload = await put(c.execA, "club-resources", `${id.execA}/${uid()}/undeclared.txt`, text("fail"), "text/plain");
    refused(refusedUpload, "upload to a path no row declares");
    succeeded(await c.execA.from("resources").update({ status: "failed" }).eq("id", row.id), "mark failed");
    equal(rowsOf(await c.member1.from("resources").select("id").eq("id", row.id), "member reads failed").length, 0, "a failed upload is visible to a member");
    const discarded = await deleteLikeTheApp(c.execA, { ...row, status: "failed" });
    ok(discarded.ok, `discarding the failed upload: ${discarded.why}`);
    equal(rowsOf(await c.execA.from("resources").select("id").eq("id", row.id), "re-read").length, 0, "failed row after discard");
    ok(!(await listed(c.execA, "club-resources", rowPath)), "an object appeared for the declared path");
  });

  await t.test("a group manager (not an executive) uploads, renames and deletes a file in group A; group members see it, members of other groups do not; a plain member cannot upload", async () => {
    const bytes = pdf("group-resource");
    const path = `${id.manager}/${uid()}/group.pdf`;
    const row = succeeded(await c.manager.from("resources").insert({ node_kind: "file", media_kind: "document", title: mark("Group file"), description: "", parent_id: null, subgroup_id: g.A, visibility: "members", storage_bucket: "club-resources", storage_path: path, original_filename: "group.pdf", mime_type: "application/pdf", byte_size: bytes.length, status: "pending_upload", is_pinned: false, created_by: id.manager }).select(FIELDS).single(), "manager inserts group resource");
    succeeded(await put(c.manager, "club-resources", path, bytes, "application/pdf"), "manager uploads");
    succeeded(await c.manager.from("resources").update({ status: "ready" }).eq("id", row.id).select(FIELDS).single(), "manager marks ready");
    const url = (await sign(c.manager, "club-resources", path, 600)).data.signedUrl;
    equal((await download((await sign(c.member1, "club-resources", path)).data.signedUrl)).sha, sha256(bytes), "member1 downloads the group file");
    equal((await download(url)).status, 200, "manager's signed URL downloads");
    const fresh = await freshUrl(c.manager, "club-resources", path);
    equal(rowsOf(await c.member2.from("resources").select("id").eq("id", row.id), "member2 reads").length, 0, "member2 (other group) sees the group file");
    ok(!(await sign(c.member2, "club-resources", path)).data?.signedUrl, "member2 could sign the group file");
    equal(succeeded(await c.manager.from("resources").update({ title: mark("Group file (renamed)") }).eq("id", row.id).select("id"), "manager renames").length, 1, "rows renamed");
    refused(await c.member1.from("resources").insert({ node_kind: "folder", media_kind: null, title: mark("member folder"), parent_id: null, subgroup_id: g.A, visibility: "members", status: "ready", created_by: id.member1 }).select("id"), "plain member creating a folder");
    refused(await c.manager.from("resources").insert({ node_kind: "folder", media_kind: null, title: mark("club folder by manager"), parent_id: null, subgroup_id: null, visibility: "members", status: "ready", created_by: id.manager }).select("id"), "group manager creating a club-wide folder");
    const del = await deleteLikeTheApp(c.manager, row);
    ok(del.ok, `manager deleting their group file: ${del.why}`);
    await proveGone({ manager: c.manager, member1: c.member1, execA: c.execA }, "club-resources", path, { fresh, fetched: url });
  });

  await t.test("links: executive adds a link, edits it, and a member opens it; deleting removes it", async () => {
    const link = succeeded(await c.execA.from("resources").insert({ node_kind: "link", media_kind: null, title: mark("Link"), description: "", parent_id: null, subgroup_id: null, visibility: "members", external_url: "https://example.com/e2e", status: "ready", is_pinned: false, created_by: id.execA }).select(FIELDS).single(), "create link");
    equal(succeeded(await c.execA.from("resources").update({ title: mark("Link (renamed)"), description: "", external_url: "https://example.com/e2e-2" }).eq("id", link.id).select("id"), "edit link").length, 1, "rows edited");
    equal(succeeded(await c.member2.from("resources").select("external_url").eq("id", link.id).single(), "member reads link").external_url, "https://example.com/e2e-2", "url seen by member");
    refused(await c.execA.from("resources").insert({ node_kind: "link", media_kind: null, title: mark("bad link"), external_url: "javascript:alert(1)", status: "ready", visibility: "members", created_by: id.execA }).select("id"), "a link that is not http(s)");
    succeeded(await c.execA.from("resources").delete().eq("id", link.id).select("id"), "delete link");
  });
}
