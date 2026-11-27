// Member deactivation: the member keeps a VALID session (sessions are not revoked, decision D2) and every
// read, write, upload, signed URL and RPC must still be refused by the database. Then reactivation.
import { ok, equal, refused, succeeded, rowsOf, firstRow, describeError } from "../lib/assert.mjs";
import { mark } from "../lib/ctx.mjs";
import { wav, pdf, sha256 } from "../lib/fixtures.mjs";
import { put, sign, download, freshUrl, uid } from "../lib/storage.mjs";

const today = () => new Date().toISOString().slice(0, 10);
const recordingRow = (over) => ({
  title: mark("Deactivation take"), description: "e2e", subgroup_id: null, storage_path: "", mime_type: "audio/wav", media_kind: "audio",
  status: "published", audience: "subgroup", recording_kind: "practice", raga: "", tala: "", sruthi: "", tempo: "", duration_seconds: 1,
  published_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...over,
});

// A read is "closed" when it errors or returns no rows.
function closed(res, label) {
  if (res.error) return;
  const rows = Array.isArray(res.data) ? res.data : res.data == null ? [] : [res.data];
  if (rows.length) throw new Error(`${label} should return nothing for a deactivated member but returned ${rows.length} row(s): ${JSON.stringify(rows).slice(0, 200)}`);
}

export default async function deactivation(t, ctx) {
  const { c, id } = ctx;
  const g = ctx.state.g;
  const s = (ctx.state.deact = {});
  t.setSection("70 deactivation");

  await t.test("before deactivation the member (victim, group A) reads the directory, recordings and resources, signs files, and has their own upload", async () => {
    // A published group-A take by member1 and a club-wide file by an executive: the things the victim can use today.
    s.takePath = `${id.member1}/subgroups/${g.A}/${uid()}-deact.wav`;
    s.takeBytes = wav(0.2);
    succeeded(await put(c.member1, "recordings", s.takePath, s.takeBytes, "audio/wav"), "upload group take");
    s.take = succeeded(await c.member1.from("recordings").insert(recordingRow({ subgroup_id: g.A, storage_path: s.takePath, uploaded_by: id.member1 })).select("id,storage_bucket").single(), "insert group take");

    s.filePath = `${id.execA}/deact-${uid()}/club-notes.pdf`;
    s.fileBytes = pdf("deactivation");
    s.file = succeeded(await c.execA.from("resources").insert({ node_kind: "file", media_kind: "document", title: mark("Club-wide notes"), description: "", parent_id: null, subgroup_id: null, visibility: "members", storage_bucket: "club-resources", storage_path: s.filePath, original_filename: "club-notes.pdf", mime_type: "application/pdf", byte_size: s.fileBytes.length, status: "pending_upload", is_pinned: false, created_by: id.execA }).select("id").single(), "insert resource row");
    succeeded(await put(c.execA, "club-resources", s.filePath, s.fileBytes, "application/pdf"), "upload resource");
    succeeded(await c.execA.from("resources").update({ status: "ready", updated_at: new Date().toISOString() }).eq("id", s.file.id).select("id").single(), "mark resource ready");

    // The victim's own take (a draft in their folder).
    s.ownPath = `${id.victim}/subgroups/${g.A}/${uid()}-own.wav`;
    s.ownBytes = wav(0.2);
    succeeded(await put(c.victim, "recordings", s.ownPath, s.ownBytes, "audio/wav"), "victim uploads own take");
    s.own = succeeded(await c.victim.from("recordings").insert(recordingRow({ title: mark("Victim's own take"), status: "draft", published_at: null, subgroup_id: g.A, storage_path: s.ownPath, uploaded_by: id.victim })).select("id").single(), "victim inserts own take");

    const directory = rowsOf(await c.victim.from("profiles").select("id,full_name").limit(50), "victim reads directory");
    ok(directory.length > 3, `the directory should list the club, got ${directory.length} rows`);
    ok(rowsOf(await c.victim.from("recordings").select("id").eq("id", s.take.id), "victim reads group take").length === 1, "victim cannot see the group take before deactivation");
    ok(rowsOf(await c.victim.from("resources").select("id").eq("id", s.file.id), "victim reads resource").length === 1, "victim cannot see the club file before deactivation");
    const takeUrl = succeeded(await sign(c.victim, "recordings", s.takePath, 300), "victim signs the group take");
    equal((await download(takeUrl.signedUrl)).sha, sha256(s.takeBytes), "group take bytes");
    const fileUrl = succeeded(await sign(c.victim, "club-resources", s.filePath, 300), "victim signs the resource");
    equal((await download(fileUrl.signedUrl)).sha, sha256(s.fileBytes), "resource bytes");
    // Signed URLs made now and never fetched: used after the deactivation (and after the expiry check below).
    s.urlTake = await freshUrl(c.victim, "recordings", s.takePath);
    s.urlFile = await freshUrl(c.victim, "club-resources", s.filePath);
    const boot = succeeded(await c.victim.rpc("get_portal_bootstrap"), "bootstrap before");
    equal(boot.profile.status, "active", "status before");
    ok(boot.groups.length > 0 && boot.memberships.length > 0, "groups and memberships are listed before deactivation");
    ok(Number(boot.resource_count) >= 1, "resource_count before");
    const summary = succeeded(await c.victim.rpc("get_finance_summary"), "summary before");
    ok(summary && "available_cash" in summary, "finance summary shape");
  });

  await t.test("only an administrator can deactivate: an executive, the member and the administrator themselves are refused; the reason is stored", async () => {
    refused(await c.execA.rpc("admin_deactivate_member", { p_target_id: id.victim, p_reason: "not allowed" }), "executive deactivating", /Only administrators/i);
    refused(await c.victim.rpc("admin_deactivate_member", { p_target_id: id.victim, p_reason: "self" }), "member deactivating themselves", /Only administrators/i);
    refused(await c.admin.rpc("admin_deactivate_member", { p_target_id: id.admin, p_reason: "self" }), "administrator deactivating themselves", /cannot deactivate themselves/i);
    refused(await c.admin.rpc("admin_deactivate_member", { p_target_id: "00000000-0000-0000-0000-000000000000", p_reason: "nobody" }), "unknown member", /not found/i);
    const result = succeeded(await c.admin.rpc("admin_deactivate_member", { p_target_id: id.victim, p_reason: mark("left the club") }), "deactivate victim");
    equal(result.status, "deactivated", "deactivated profile");
    // 20261127041000 (core-2): who deactivated them, when and why moved off profiles, which every member can read, into a table only administrators read.
    ok(!("deactivation_reason" in result) && !("deactivated_by" in result), `the profile still carries the deactivation record: ${JSON.stringify(Object.keys(result))}`);
    equal(rowsOf(await c.admin.from("member_deactivations").select("reason,deactivated_by").eq("member_id", id.victim), "administrator reads the deactivation record"), [{ reason: mark("left the club"), deactivated_by: id.admin }], "stored deactivation record");
    for (const key of ["execA", "member1"]) {
      equal(rowsOf(await c[key].from("member_deactivations").select("member_id"), `${key} reads member_deactivations`).length, 0, `${key}: deactivation records visible to someone who is not an administrator`);
    }
    refused(await c.member1.from("profiles").select("id,deactivation_reason").eq("id", id.victim), "a member selecting the old reason column from profiles", /deactivation_reason/i);
    refused(await c.admin.rpc("admin_deactivate_member", { p_target_id: id.victim, p_reason: "again" }), "deactivating twice", /already deactivated/i);
    // 20261127041100 (core-8): the memberships become 'inactive' (as if the person had left), not 'removed', and any leader or manager role is reset.
    const memberships = rowsOf(await c.execA.from("subgroup_memberships").select("subgroup_id,status,membership_role").eq("member_id", id.victim), "victim memberships as an executive");
    ok(memberships.length > 0 && memberships.every((m) => m.status === "inactive" && m.membership_role === "member"), `all group memberships should be inactive, with the role reset: ${JSON.stringify(memberships)}`);
    const audit = rowsOf(await c.admin.from("admin_audit_log").select("action,target_id,details").eq("target_id", id.victim).eq("action", "member_deactivated"), "audit log");
    ok(audit.length >= 1, "no member_deactivated entry in the admin audit log");
    ok(audit.some((a) => a.details?.reason === mark("left the club") && (a.details?.groups || []).some((x) => x.subgroup_id === g.A && x.status === "active")), `the audit entry should keep the reason and the groups the member had: ${JSON.stringify(audit.map((a) => a.details))}`);
  });

  await t.test("the deactivated member's session is still valid, but profiles/directory, recordings, resources, groups, events and announcements all read as empty", async () => {
    const user = await c.victim.auth.getUser();
    ok(!user.error && user.data.user?.id === id.victim, `the member's session should still be valid (sessions are not revoked): ${user.error ? describeError(user.error) : "ok"}`);
    const profiles = rowsOf(await c.victim.from("profiles").select("id,status"), "victim reads profiles");
    equal(profiles.map((p) => p.id), [id.victim], "the only profile a deactivated member can read is their own");
    equal(profiles[0].status, "deactivated", "own profile status");
    closed(await c.victim.from("profiles").select("id").eq("id", id.execA), "the directory entry of an executive");
    for (const table of ["recordings", "recording_notes", "resources", "subgroups", "subgroup_memberships", "events", "announcements", "attendance_sessions", "attendance_records", "finance_expenses", "personal_reimbursements", "finance_payments", "finance_documents", "archive_items"]) {
      closed(await c.victim.from(table).select("*").limit(5), `${table} read`);
    }
    closed(await c.victim.from("recordings").select("id").eq("id", s.own.id), "the member's own draft take");
    const boot = succeeded(await c.victim.rpc("get_portal_bootstrap"), "bootstrap while deactivated");
    equal(boot.profile.status, "deactivated", "bootstrap profile status");
    equal([boot.groups.length, boot.memberships.length, boot.announcements.length, boot.events.length, Number(boot.resource_count)], [0, 0, 0, 0, 0], "bootstrap lists");
    const workspace = succeeded(await c.victim.rpc("get_attendance_workspace", { p_scope: "all" }), "attendance workspace while deactivated");
    equal([workspace.sessions.length, workspace.records.length, workspace.excuses.length], [0, 0, 0], "attendance workspace lists");
    const summary = succeeded(await c.victim.rpc("get_finance_summary"), "finance summary while deactivated");
    equal(KEYS.map((k) => Number(summary[k])), [0, 0, 0, 0, 0, 0], "finance summary");
  });

  await t.test("files are closed: no new signed URL for a recording, a resource or an own file; uploads to every bucket are refused", async () => {
    ok((await sign(c.victim, "recordings", s.takePath, 60)).error, "a deactivated member could sign a group recording");
    ok((await sign(c.victim, "club-resources", s.filePath, 60)).error, "a deactivated member could sign a resource");
    ok((await sign(c.victim, "recordings", s.ownPath, 60)).error, "a deactivated member could sign their own take");
    for (const [bucket, path, bytes, type] of [
      ["recordings", `${id.victim}/subgroups/${g.A}/${uid()}-no.wav`, wav(0.1), "audio/wav"],
      ["recording-notations", `${id.victim}/${uid()}-no.pdf`, pdf("no"), "application/pdf"],
      ["finance-private", `${id.victim}/${uid()}-no.pdf`, pdf("no"), "application/pdf"],
      ["attendance-excuses", `${id.victim}/${uid()}-no.pdf`, pdf("no"), "application/pdf"],
    ]) {
      const res = await put(c.victim, bucket, path, bytes, type);
      ok(res.error, `upload to ${bucket} by a deactivated member should be refused`);
    }
    const removed = await c.victim.storage.from("recordings").remove([s.ownPath]);
    equal((removed.data || []).length, 0, "objects a deactivated member could delete");
  });

  await t.test("writes and RPCs are refused: reimbursement, group request, profile edit, recording row, check-in; a deactivated member cannot be added to a group", async () => {
    const reimbursement = refused(await c.victim.rpc("submit_member_reimbursement", { p_description: mark("deactivated request"), p_vendor: "x", p_amount: 5, p_purchase_date: today(), p_category: "Supplies", p_payment_card_last4: "1234" }), "submit_member_reimbursement");
    ok(/deactivated|permission|row-level/i.test(reimbursement.message), `unexpected refusal text: ${reimbursement.message}`);
    refused(await c.victim.rpc("request_subgroup_enrollment", { target_subgroup_id: g.C }), "request_subgroup_enrollment to an open group");
    equal(rowsOf(await c.execA.from("subgroup_memberships").select("status").eq("member_id", id.victim).eq("subgroup_id", g.C).in("status", ["active", "pending", "waitlisted"]), "memberships in C").length, 0, "victim memberships created in group C");
    const edit = await c.victim.from("profiles").update({ full_name: "Changed while deactivated" }).eq("id", id.victim).select("id");
    ok(edit.error || (edit.data || []).length === 0, "a deactivated member edited their own profile");
    const row = await c.victim.from("recordings").insert(recordingRow({ subgroup_id: g.A, storage_path: s.ownPath, uploaded_by: id.victim })).select("id");
    ok(row.error, "a deactivated member inserted a recording row");
    refused(await c.victim.rpc("check_in_attendance", { p_code: "123456" }), "check_in_attendance");
    const deleted = await c.victim.from("recordings").delete().eq("id", s.own.id).select("id");
    ok(deleted.error || (deleted.data || []).length === 0, "a deactivated member deleted their own recording row");
    refused(await c.execA.rpc("add_subgroup_member", { p_subgroup_id: g.C, p_member_id: id.victim }), "adding a deactivated member to a group", /deactivated/i);
    const profile = rowsOf(await c.admin.from("profiles").select("full_name,status").eq("id", id.victim), "admin reads victim");
    ok(profile[0].full_name !== "Changed while deactivated", "the profile name changed");
  });

  await t.observe("signed URLs issued BEFORE the deactivation keep downloading until they expire (sessions and URLs are not revoked)", async () => {
    const take = await download(s.urlTake);
    const file = await download(s.urlFile);
    return `unfetched signed URLs created before the deactivation: recording -> HTTP ${take.status}, resource -> HTTP ${file.status}. A URL is a bearer credential valid for its expiry (here 1 hour); the database cannot recall it. New URLs are refused (see the test above).`;
  });

  await t.test("reactivation: only an administrator, once; the same session sees the club again, group content returns after an executive re-adds the member", async () => {
    refused(await c.execA.rpc("admin_reactivate_member", { p_target_id: id.victim }), "executive reactivating", /Only administrators/i);
    refused(await c.victim.rpc("admin_reactivate_member", { p_target_id: id.victim }), "the member reactivating themselves", /Only administrators/i);
    const result = succeeded(await c.admin.rpc("admin_reactivate_member", { p_target_id: id.victim }), "reactivate");
    equal(result.status, "active", "reactivated profile");
    equal(rowsOf(await c.admin.from("member_deactivations").select("member_id").eq("member_id", id.victim), "administrator reads the deactivation record").length, 0, "the deactivation record after reactivation");
    refused(await c.admin.rpc("admin_reactivate_member", { p_target_id: id.victim }), "reactivating twice", /already active/i);

    // Same client, same session: no sign-in again.
    const directory = rowsOf(await c.victim.from("profiles").select("id").limit(50), "directory after");
    ok(directory.length > 3, `the directory should be back, got ${directory.length}`);
    ok(rowsOf(await c.victim.from("resources").select("id").eq("id", s.file.id), "resource after").length === 1, "the club-wide resource is visible again");
    const fileUrl = succeeded(await sign(c.victim, "club-resources", s.filePath, 120), "sign the resource again");
    equal((await download(fileUrl.signedUrl)).sha, sha256(s.fileBytes), "resource bytes after reactivation");
    let boot = succeeded(await c.victim.rpc("get_portal_bootstrap"), "bootstrap after");
    equal(boot.profile.status, "active", "status after");
    equal(boot.memberships.filter((m) => m.status === "active").length, 0, "group memberships are not restored by reactivation");
    equal(rowsOf(await c.victim.from("recordings").select("id").eq("id", s.take.id), "group take before re-adding").length, 0, "the group recording before the member is added back");
    // 20261127041100 (core-8): the memberships are 'inactive', like after leaving, so the member can ask to join an open group again.
    equal(succeeded(await c.victim.rpc("request_subgroup_enrollment", { target_subgroup_id: g.C }), "the reactivated member joins the open group C").status, "active", "membership in the open group after reactivation");
    succeeded(await c.victim.rpc("leave_subgroup", { p_subgroup_id: g.C }), "the member leaves C again");

    succeeded(await c.execA.rpc("add_subgroup_member", { p_subgroup_id: g.A, p_member_id: id.victim }), "executive adds the member back to group A");
    equal(rowsOf(await c.victim.from("recordings").select("id").eq("id", s.take.id), "group take after re-adding").length, 1, "the group recording after the member is added back");
    const takeUrl = succeeded(await sign(c.victim, "recordings", s.takePath, 120), "sign the group take again");
    equal((await download(takeUrl.signedUrl)).sha, sha256(s.takeBytes), "group take bytes after re-adding");
    boot = succeeded(await c.victim.rpc("get_portal_bootstrap"), "bootstrap after re-adding");
    ok(boot.memberships.some((m) => m.subgroup_id === g.A && m.status === "active"), "group A is back in the member's memberships");
    equal(rowsOf(await c.victim.from("recordings").select("id").eq("id", s.own.id), "own take after").length, 1, "the member's own draft survived the deactivation");
    const written = await c.victim.rpc("submit_member_reimbursement", { p_description: mark("after reactivation"), p_vendor: "x", p_amount: 5, p_purchase_date: today(), p_category: "Supplies", p_payment_card_last4: "1234" });
    succeeded(written, "a write works again after reactivation");
    const created = firstRow(written.data);
    succeeded(await c.victim.rpc("withdraw_member_reimbursement", { p_reimbursement_id: created.reimbursement_id }), "withdraw the test request");
    const audit = rowsOf(await c.admin.from("admin_audit_log").select("action").eq("target_id", id.victim).eq("action", "member_reactivated"), "audit log");
    ok(audit.length >= 1, "no member_reactivated entry in the admin audit log");
  });

  await t.test("cleanup of the fixtures: the member deletes their own take, the uploader deletes the group take, the executive deletes the resource (file first, then the row); the files are gone", async () => {
    // Unfetched URLs made now (the earlier ones were fetched by the test above, so the CDN may serve them).
    const fresh = [await freshUrl(c.member1, "recordings", s.takePath), await freshUrl(c.execA, "club-resources", s.filePath)];
    for (const [client, bucket, path, table, rowId] of [
      [c.victim, "recordings", s.ownPath, "recordings", s.own.id],
      [c.member1, "recordings", s.takePath, "recordings", s.take.id],
      [c.execA, "club-resources", s.filePath, "resources", s.file.id],
    ]) {
      const removed = await client.storage.from(bucket).remove([path]);
      if (removed.error || (removed.data || []).length !== 1) throw new Error(`removing ${bucket}/${path}: ${removed.error ? describeError(removed.error) : "nothing removed"}`);
      const row = await client.from(table).delete().eq("id", rowId).select("id");
      if (row.error || !row.data?.length) throw new Error(`deleting the ${table} row: ${row.error ? describeError(row.error) : "no row deleted"}`);
    }
    for (const url of fresh) equal((await download(url)).status === 200, false, "a signed URL made before the delete (never fetched) still downloads after the delete");
  });
}

const KEYS = ["available_cash", "income", "spending", "pending_reimbursement_total", "pending_reimbursement_count", "expected_funding"];
