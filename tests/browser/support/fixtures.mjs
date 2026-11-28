// Seeds the content every screen needs, through the API, as the e2e accounts, with the same calls the app makes.
// Every row carries "[e2e]" in its title (scripts/e2e/lib/ctx.mjs `mark`), so scripts/e2e/cleanup.mjs and cleanup.sql remove it.
//
// What exists afterwards (see fx in state.json):
//   groups       "BR Group A" (approval): manager = manager, leader = leader, members member1 and victim, and two PENDING requests
//                (nohist's is approved by a journey, hist's stays); "BR Open Group" (open), which member1 is not in
//   calendar     a club-wide date today, a group-A date in three days; a pinned club announcement and a group-A announcement
//   recordings   one published group-A take by member1 with a text note
//   resources    a folder with a link and a PDF inside, plus two top-level PDFs (one a journey deletes, one that stays)
//   attendance   a CLOSED group-A meeting with marks, and an OPEN group-A meeting whose check-in code is kept in fx
//   finance      requests by member1: two submitted with two receipts each, one approved (to pay), one paid; club expenses
//                (one to claim, one to void, one on the fixture funding claim); the claim; income
//   archive      a public concert (it must exist BEFORE `next build`: the landing page is prerendered with it) and a members-only recording
import { ACCOUNT_KEYS } from "../../../scripts/e2e/accounts.mjs";
import { mark, RUN } from "../../../scripts/e2e/lib/ctx.mjs";
import { png, pdf, wav } from "../../../scripts/e2e/lib/fixtures.mjs";
import { put, uid } from "../../../scripts/e2e/lib/storage.mjs";
import { describeError, firstRow, ok, rowsOf, succeeded } from "../../../scripts/e2e/lib/assert.mjs";

const hoursFromNow = (hours) => new Date(Date.now() + hours * 3600000).toISOString();
const daysFromNow = (days) => hoursFromNow(days * 24);
const today = () => new Date().toISOString().slice(0, 10);
// Today at 16:00 UTC (noon in New York): inside the calendar's current month whatever the time of day.
const todayNoon = () => { const d = new Date(); d.setUTCHours(16, 0, 0, 0); return d.toISOString(); };

// The deactivation, role and group state the suite needs before anything is seeded.
export async function prepareAccounts(ctx) {
  const { c, id } = ctx;
  const roleOf = async (key) => succeeded(await c[key].rpc("get_portal_bootstrap"), `${key} bootstrap`).profile;
  // Since the membership gate (20261128010100) the signup trigger makes every profile pending; the setup SQL (scripts/e2e/gen-setup-sql.mjs)
  // makes the suite's accounts ACTIVE. An account that is still waiting (made by an older copy of the SQL) is approved below, as an
  // executive would, once the executives are in place: the three accounts that do the approving cannot be fixed that way.
  const waiting = [];
  for (const key of ACCOUNT_KEYS) if (["pending", "rejected"].includes((await roleOf(key)).status)) waiting.push(key);
  for (const key of ["admin", "execA", "execB"]) ok(!waiting.includes(key), `${key} is not an active account (it is waiting for approval): run the setup SQL again (scripts/e2e/README.md)`);
  // A victim left deactivated by a crashed run is brought back first.
  if ((await roleOf("victim")).status === "deactivated") succeeded(await c.admin.rpc("admin_reactivate_member", { p_target_id: id.victim }), "reactivate the victim left over from an earlier run");
  for (const key of ["execA", "execB"]) {
    if ((await roleOf(key)).role !== "executive") succeeded(await c.admin.rpc("admin_change_member_role", { p_target_id: id[key], p_new_role: "executive" }), `promote ${key}`);
  }
  ok((await roleOf("admin")).role === "admin", "the admin account is not an administrator: run the setup SQL (scripts/e2e/README.md)");
  for (const key of waiting) succeeded(await c.execA.rpc("review_pending_member", { p_member_id: id[key], p_approved: true, p_reason: "browser suite: the setup SQL left this account waiting" }), `approve ${key}`);
  for (const key of ACCOUNT_KEYS) ok((await roleOf(key)).status === "active", `${key} is not an active account: run the setup SQL again (scripts/e2e/README.md)`);
}

export async function seed(ctx) {
  const { c, id } = ctx;
  const titles = {};
  const ids = {};
  const label = (key, text) => (titles[key] = mark(`BR ${text}`));
  const step = async (name, fn) => {
    try { return await fn(); } catch (error) { throw new Error(`seeding "${name}" failed: ${error.message}`, { cause: error }); }
  };

  // ---- groups ---------------------------------------------------------------------------------------------
  await step("groups", async () => {
    const make = async (key, name, mode) => {
      const row = firstRow(succeeded(await c.execA.rpc("create_subgroup", { subgroup_name: label(key, name), subgroup_description: "created by the browser suite", subgroup_mode: mode }), `create ${name}`));
      ids[key] = row.id;
    };
    await make("groupA", "Group A", "approval");
    await make("groupOpen", "Open Group", "open");
    const add = async (who, role) => {
      succeeded(await c.execA.rpc("add_subgroup_member", { p_subgroup_id: ids.groupA, p_member_id: id[who] }), `add ${who}`);
      if (role) succeeded(await c.execA.rpc("set_subgroup_member_role", { target_subgroup_id: ids.groupA, target_member_id: id[who], next_role: role }), `make ${who} ${role}`);
    };
    await add("manager", "manager");
    await add("leader", "leader");
    await add("member1");
    await add("victim");
    // A waiting request for the group manager to approve in the browser.
    succeeded(await c.nohist.rpc("request_subgroup_enrollment", { target_subgroup_id: ids.groupA }), "nohist requests group A");
    // A second one that no test approves, so the manager's screen always has a request waiting whatever order the tests run in.
    succeeded(await c.hist.rpc("request_subgroup_enrollment", { target_subgroup_id: ids.groupA }), "hist requests group A");
  });

  // ---- calendar and announcements ------------------------------------------------------------------------
  await step("calendar and announcements", async () => {
    const event = async (key, title, startsAt, subgroupId, location) => {
      const row = succeeded(await c.execA.from("events").insert({ title: label(key, title), description: "browser suite", starts_at: startsAt, location, subgroup_id: subgroupId, created_by: id.execA }).select("id"), `insert ${title}`);
      ids[key] = row[0].id;
    };
    await event("eventToday", "Concert today", todayNoon(), null, "Memorial Hall");
    await event("eventGroup", "Group A rehearsal", daysFromNow(3), ids.groupA, "Hill Hall");
    await event("eventNext", "Spring concert", daysFromNow(40), null, "Memorial Hall");
    const announce = async (key, title, body, pinned, subgroupId) => {
      const row = succeeded(await c.execA.from("announcements").insert({ title: label(key, title), body, is_pinned: pinned, subgroup_id: subgroupId, created_by: id.execA }).select("id"), `insert ${title}`);
      ids[key] = row[0].id;
    };
    await announce("annPinned", "Pinned notice", "Rehearsal rooms move to Hill Hall this week.", true, null);
    await announce("annGroup", "Group A notice", "Bring your sruthi box.", false, ids.groupA);
  });

  // ---- recordings -----------------------------------------------------------------------------------------
  await step("recordings", async () => {
    const path = `${id.member1}/subgroups/${ids.groupA}/${uid()}-br-take.wav`;
    succeeded(await put(c.member1, "recordings", path, wav(0.4), "audio/wav"), "upload the take");
    const row = succeeded(await c.member1.from("recordings").insert({
      title: label("recording", "Published take"), description: "A short take for the browser suite", subgroup_id: ids.groupA, storage_path: path, mime_type: "audio/wav", media_kind: "audio",
      status: "published", audience: "subgroup", recording_kind: "rehearsal", raga: "Bhairavi", tala: "Adi", sruthi: "C", tempo: "Madhyama", duration_seconds: 1,
      published_at: new Date().toISOString(), updated_at: new Date().toISOString(), uploaded_by: id.member1,
    }).select("id").single(), "insert the take");
    ids.recording = row.id;
    titles.note = mark("BR Notation text");
    succeeded(await c.member1.from("recording_notes").insert({ recording_id: row.id, title: "Notation", note_type: "text", body: titles.note, storage_path: null, mime_type: null, uploaded_by: id.member1 }), "insert the notation text");
  });

  // ---- resources ------------------------------------------------------------------------------------------
  await step("resources", async () => {
    const base = { media_kind: null, description: "", subgroup_id: null, visibility: "members", is_pinned: false, created_by: id.execA };
    const folder = succeeded(await c.execA.from("resources").insert({ ...base, node_kind: "folder", title: label("folder", "Folder"), parent_id: null, status: "ready" }).select("id").single(), "insert the folder");
    ids.folder = folder.id;
    succeeded(await c.execA.from("resources").insert({ ...base, node_kind: "link", title: label("link", "Link"), parent_id: folder.id, external_url: "https://example.org/br-repertoire", status: "ready" }).select("id").single(), "insert the link");
    const file = async (key, title, parentId) => {
      const name = `${key}.pdf`;
      const bytes = pdf(`br ${key}`);
      const path = `${id.execA}/br-${uid()}/${name}`;
      const pending = succeeded(await c.execA.from("resources").insert({ ...base, node_kind: "file", media_kind: "document", title: label(key, title), parent_id: parentId, storage_bucket: "club-resources", storage_path: path, original_filename: name, mime_type: "application/pdf", byte_size: bytes.length, status: "pending_upload" }).select("id").single(), `insert ${title}`);
      succeeded(await put(c.execA, "club-resources", path, bytes, "application/pdf"), `upload ${title}`);
      succeeded(await c.execA.from("resources").update({ status: "ready", updated_at: new Date().toISOString() }).eq("id", pending.id).select("id").single(), `mark ${title} ready`);
      ids[key] = pending.id;
      ids[`${key}Path`] = path;
    };
    await file("fileInFolder", "Rehearsal notes", folder.id);
    await file("fileToDelete", "Delete me", null);
    // The one no journey removes: what the Resources screen's landmark looks for.
    await file("fileKept", "Season repertoire", null);
  });

  // ---- attendance -----------------------------------------------------------------------------------------
  await step("attendance", async () => {
    // The closed meeting first: a group has one open meeting at a time.
    const closed = firstRow(succeeded(await c.execA.rpc("create_attendance_session", { p_scope: "subgroup", p_subgroup_id: ids.groupA, p_title: label("sessionClosed", "Closed rehearsal"), p_starts_at: hoursFromNow(-26) }), "create the closed meeting"));
    succeeded(await c.execA.rpc("open_attendance_session", { p_session_id: closed.id, p_duration_minutes: 30 }), "open the closed meeting");
    const mark_ = (who, status, extra = {}) => c.execA.rpc("set_attendance_status", { p_session_id: closed.id, p_member_id: id[who], p_status: status, p_note: "", p_minutes_late: 0, ...extra });
    succeeded(await mark_("member1", "present"), "mark member1 present");
    succeeded(await mark_("leader", "tardy", { p_minutes_late: 5 }), "mark the leader tardy");
    succeeded(await mark_("manager", "excused", { p_note: "exam" }), "mark the manager excused");
    succeeded(await c.execA.rpc("close_attendance_session", { p_session_id: closed.id }), "close the meeting (everyone left becomes absent)");
    ids.sessionClosed = closed.id;

    const open = firstRow(succeeded(await c.execA.rpc("create_attendance_session", { p_scope: "subgroup", p_subgroup_id: ids.groupA, p_title: label("sessionOpen", "Open rehearsal"), p_starts_at: hoursFromNow(1) }), "create the open meeting"));
    const opened = firstRow(succeeded(await c.execA.rpc("open_attendance_session", { p_session_id: open.id, p_duration_minutes: 120 }), "open the open meeting"));
    ok(/^\d{6}$/.test(String(opened.check_in_code)), `check-in code is not six digits: ${opened.check_in_code}`);
    ids.sessionOpen = open.id;
    ids.checkInCode = String(opened.check_in_code);
  });

  // ---- finance --------------------------------------------------------------------------------------------
  // The app's uploadDocument(): file to finance-private, a finance_documents record, then the links.
  async function uploadDoc(who, { type = "receipt", title, buffer = png(), mime = "image/png", name = "receipt.png", last4 = null, links = {} }) {
    const client = c[who];
    const path = `${id[who]}/${uid()}-${name}`;
    succeeded(await put(client, "finance-private", path, buffer, mime), `upload ${title}`);
    const saved = succeeded(await client.from("finance_documents").insert({ document_type: type, title, storage_path: path, mime_type: mime, file_size_bytes: buffer.length, payment_card_last4: last4, uploaded_by: id[who] }).select("id").single(), `record ${title}`);
    const requests = [];
    if (links.expenseId) requests.push(client.from("finance_expense_documents").insert({ expense_id: links.expenseId, document_id: saved.id }));
    if (links.reimbursementId) requests.push(client.from("finance_reimbursement_documents").insert({ reimbursement_id: links.reimbursementId, document_id: saved.id }));
    if (links.claimId) requests.push(client.from("finance_claim_documents").insert({ claim_id: links.claimId, document_id: saved.id }));
    for (const res of await Promise.all(requests)) if (res.error) throw new Error(`linking ${title} failed: ${describeError(res.error)}`);
    return { id: Number(saved.id), path };
  }
  async function memberRequest(key, text, amount, { extraReceipt = false } = {}) {
    const description = label(key, text);
    const sub = firstRow(succeeded(await c.member1.rpc("submit_member_reimbursement", { p_description: description, p_vendor: "Music Shop", p_amount: amount, p_purchase_date: today(), p_category: "Supplies", p_payment_card_last4: "1234", p_member_note: "browser suite" }), `submit ${text}`));
    const request = { expenseId: Number(sub.expense_id), reimbursementId: Number(sub.reimbursement_id) };
    const links = { expenseId: request.expenseId, reimbursementId: request.reimbursementId };
    request.receipt = await uploadDoc("member1", { title: mark(`BR Receipt ${text}`), last4: "1234", links });
    if (extraReceipt) {
      titles[`${key}Extra`] = mark(`BR Extra receipt ${text}`);
      request.extra = await uploadDoc("member1", { title: titles[`${key}Extra`], last4: "1234", links });
    }
    ids[key] = request;
    return request;
  }
  async function clubExpense(key, text, amount) {
    const description = label(key, text);
    const expenseId = Number(succeeded(await c.execA.rpc("record_club_expense", { p_description: description, p_vendor: "Music Shop", p_amount: amount, p_purchase_date: today(), p_category: "Supplies", p_account_name: "Club bank account", p_payment_card_last4: "4321", p_event_related: false }), `record ${text}`));
    await uploadDoc("execA", { title: mark(`BR Receipt ${text}`), last4: "4321", links: { expenseId } });
    ids[key] = expenseId;
    return expenseId;
  }

  await step("finance", async () => {
    // Two requests with two receipts each: one is cleaned by the executive, the other by the member.
    const byExec = await memberRequest("reqExecRemoves", "Request, executive removes a receipt", 31, { extraReceipt: true });
    ids.docExecRemoves = byExec.extra;
    const byMember = await memberRequest("reqMemberRemoves", "Request, member removes a receipt", 32, { extraReceipt: true });
    ids.docMemberRemoves = byMember.extra;
    // One approved by execB (to be paid by execA in the browser) and one approved and paid.
    const toPay = await memberRequest("reqToPay", "Request approved, to pay", 33);
    succeeded(await c.execB.rpc("review_personal_reimbursement", { p_reimbursement_id: toPay.reimbursementId, p_decision: "approved", p_approved_amount: 33, p_review_note: "ok" }), "approve the request to pay");
    const paid = await memberRequest("reqPaid", "Request already paid", 34);
    succeeded(await c.execB.rpc("review_personal_reimbursement", { p_reimbursement_id: paid.reimbursementId, p_decision: "approved", p_approved_amount: 34, p_review_note: "ok" }), "approve the paid request");
    succeeded(await c.execB.rpc("pay_personal_reimbursement", { p_reimbursement_id: paid.reimbursementId, p_payment_date: today(), p_account_name: "Club bank account" }), "pay the request");

    succeeded(await c.execA.rpc("record_finance_income", { p_description: label("income", "Dues income"), p_amount: 120, p_payment_date: today(), p_category: "Membership dues", p_counterparty: "Members" }), "record income");
    await clubExpense("expToClaim", "Club expense to claim", 21);
    await clubExpense("expToVoid", "Club expense to void", 22);
    const inClaim = await clubExpense("expInClaim", "Club expense on a claim", 23);
    const claim = firstRow(succeeded(await c.execA.rpc("create_funding_claim", { p_title: label("claim", "Funding claim"), p_funder_name: "GPSG Senate", p_award_reference: "BR-1", p_heellife_reference: "", p_submission_deadline: null, p_notes: "browser suite", p_expense_ids: [inClaim] }), "create the funding claim"));
    ids.claim = claim.id;
    await uploadDoc("execA", { type: "funding_approval", title: mark("BR Funding approval"), links: { claimId: claim.id } });
  });

  // ---- club archive (the public concert page is prerendered, so this must exist before the build) ----------
  await step("club archive", async () => {
    const item = async (key, text, isPublic) => {
      const path = `${id.execA}/${uid()}-${key}.wav`;
      succeeded(await put(c.execA, "club-archive", path, wav(0.3), "audio/wav"), `upload ${text}`);
      const row = succeeded(await c.execA.from("archive_items").insert({ title: label(key, text), description: "browser suite", type: "recording", storage_path: path, visibility: "members", is_public: isPublic, raga: "Yaman", tala: "Teental", event_date: "2026-01-15", uploaded_by: id.execA }).select("id").single(), `insert ${text}`);
      ids[key] = row.id;
    };
    await item("archivePublic", "Public concert", true);
    await item("archiveMembers", "Members archive recording", false);
  });

  return { run: RUN, titles, ids };
}

// The deactivated member: signed in first (the session stays valid, decision D2), deactivated last.
export async function deactivateVictim(ctx) {
  succeeded(await ctx.c.admin.rpc("admin_deactivate_member", { p_target_id: ctx.id.victim, p_reason: mark("BR left the club") }), "deactivate the victim");
}

export async function reactivateVictim(ctx) {
  const status = succeeded(await ctx.c.admin.from("profiles").select("status").eq("id", ctx.id.victim).single(), "read the victim's status").status;
  if (status !== "deactivated") return "already active";
  succeeded(await ctx.c.admin.rpc("admin_reactivate_member", { p_target_id: ctx.id.victim }), "reactivate the victim");
  return "reactivated";
}

// What the app itself may delete (events, announcements, resources with their file, recordings with their files and notes), for the rows
// this run's title marker identifies. Money, groups, attendance and audit rows are never hard-deleted by the app: cleanup.sql removes them.
export async function removeWhatTheAppMayDelete(ctx) {
  const { c } = ctx;
  const like = `%[e2e]%${RUN}`;
  const done = { events: 0, announcements: 0, resources: 0, recordings: 0, files: 0 };
  const fileGone = async (client, bucket, path) => {
    const removed = await client.storage.from(bucket).remove([path]);
    if (!removed.error && (removed.data || []).length) done.files += 1;
  };
  const events = rowsOf(await c.execA.from("events").select("id").like("title", like), "list events");
  for (const row of events) if (!(await c.execA.from("events").delete().eq("id", row.id)).error) done.events += 1;
  const announcements = rowsOf(await c.execA.from("announcements").select("id").like("title", like), "list announcements");
  for (const row of announcements) if (!(await c.execA.from("announcements").delete().eq("id", row.id)).error) done.announcements += 1;

  const recordings = rowsOf(await c.execA.from("recordings").select("id,storage_path,storage_bucket").like("title", like), "list recordings");
  for (const row of recordings) {
    const notes = rowsOf(await c.execA.from("recording_notes").select("storage_path").eq("recording_id", row.id), "list notes");
    for (const note of notes) if (note.storage_path) await fileGone(c.execA, "recording-notations", note.storage_path);
    if (row.storage_path) await fileGone(c.execA, row.storage_bucket || "recordings", row.storage_path);
    if (!(await c.execA.from("recordings").delete().eq("id", row.id)).error) done.recordings += 1;
  }
  // Children before parents.
  for (let pass = 0; pass < 4; pass += 1) {
    const resources = rowsOf(await c.execA.from("resources").select("id,node_kind,storage_bucket,storage_path").like("title", like), "list resources");
    if (!resources.length) break;
    for (const row of resources.sort((a, b) => (a.node_kind === "folder") - (b.node_kind === "folder"))) {
      if (row.node_kind === "file" && row.storage_path) await fileGone(c.execA, row.storage_bucket || "club-resources", row.storage_path);
      if (!(await c.execA.from("resources").delete().eq("id", row.id)).error) done.resources += 1;
    }
  }
  const archive = rowsOf(await c.execA.from("archive_items").select("id,storage_path").like("title", like), "list archive items");
  for (const row of archive) {
    await fileGone(c.execA, "club-archive", row.storage_path);
    await c.execA.from("archive_items").delete().eq("id", row.id);
  }
  return done;
}
