// The membership gate (P0-01; 20261128010000 and 20261128010100): a new sign-up waits for an executive.
//
// The account is made by the setup SQL (the way section 90 gets its disposable account): created through auth.users, so the signup
// trigger makes it a fresh sign-up, and left PENDING. This section signs in as it with its password and follows it through the whole
// life of a sign-up: it is pending, it reads nothing and writes nothing, an executive sees it in the queue, declines it, another
// executive undoes that, and after the approval it reads the club. At the end the account is deleted, so the next run needs the
// setup SQL again (gen-setup-sql.mjs), which also puts a half-used account back to pending.
//
// It skips itself, and says why, when the account does not exist or is not pending (the gate migrations are not on this project).
// It needs the two executives to be executives: section 00 does that, so list "00 accounts" too when you run this one alone.
import { readFileSync } from "node:fs";
import { ok, equal, refused, succeeded, rowsOf, firstRow } from "../lib/assert.mjs";
import { mark } from "../lib/ctx.mjs";

const inventory = JSON.parse(readFileSync(new URL("../inventory.json", import.meta.url), "utf8"));
const WAITING = /waiting for approval by a club executive/i;
const today = () => new Date().toISOString().slice(0, 10);

export default async function membershipGate(t, ctx) {
  const { c, id } = ctx;
  const s = (ctx.state.gate = {});
  t.setSection("03 membership gate");

  const applicant = await ctx.signInOptional("applicant");
  const SKIPPED = "a fresh sign-up is pending, reads nothing, is approved by an executive, then reads";
  if (!applicant) {
    t.skip(SKIPPED, `${ctx.accounts.applicant.email} does not exist (or its password is not in the secrets file): the last run deleted it. Run the setup SQL again (node scripts/e2e/gen-setup-sql.mjs) to recreate it.`);
    return;
  }
  const a = applicant.client;
  const aid = applicant.id;
  const first = succeeded(await a.rpc("get_portal_bootstrap"), "the applicant's bootstrap");
  if (first.profile?.status !== "pending") {
    t.skip(SKIPPED, `${ctx.accounts.applicant.email} is "${first.profile?.status}", not pending: either the membership gate migrations (20261128010000, 20261128010100) are not applied on this project, or a run stopped half way. Run the setup SQL again; it puts the account back to pending.`);
    return;
  }

  await t.test("the account the setup SQL made is a fresh sign-up: pending, a plain member, and its bootstrap says so and carries nothing else", async () => {
    equal(first.profile.status, "pending", "status in the bootstrap");
    equal(first.profile.role, "member", "role in the bootstrap");
    equal(first.profile.full_name, ctx.accounts.applicant.name, "name in the bootstrap");
    for (const key of ["groups", "memberships", "announcements", "events", "archive"]) equal(first[key], [], `${key} in a pending sign-up's bootstrap`);
    equal(first.resource_count, 0, "resource_count in a pending sign-up's bootstrap");
    ok(!("pending_signups" in first), "a pending sign-up is told how many people wait for approval");
  });

  await t.test("control: an executive posts an announcement that an active member reads, so that 'reads nothing' below means something", async () => {
    s.note = succeeded(await c.execA.from("announcements").insert({ title: mark("Membership gate control"), body: "for members only", is_pinned: false, subgroup_id: null, created_by: id.execA }).select("id").single(), "post the control announcement").id;
    equal(rowsOf(await c.member1.from("announcements").select("id").eq("id", s.note), "a member reads the control announcement").length, 1, "control announcement rows a member reads");
  });

  await t.test("a pending sign-up reads its own profile and nothing else: no row of any table in inventory.json, no object of any bucket", async () => {
    const own = rowsOf(await a.from("profiles").select("id,status,role").limit(50), "the applicant reads profiles");
    equal(own.length, 1, "profile rows a pending sign-up reads");
    equal(own[0].id, aid, "the one profile row is its own");
    equal(own[0].status, "pending", "status in its own row");
    equal(rowsOf(await a.from("announcements").select("id").eq("id", s.note), "the applicant reads the control announcement").length, 0, "control announcement rows a pending sign-up reads");
    const problems = [];
    for (const table of inventory.tables) {
      if (table.name === "profiles") continue;
      const res = await a.from(table.name).select("*").limit(5);
      if (!res.error && (res.data || []).length) problems.push(`${table.name}: a pending sign-up reads ${res.data.length} row(s)`);
    }
    for (const bucket of inventory.buckets) {
      const list = await a.storage.from(bucket.id).list("", { limit: 10 });
      if (!list.error && (list.data || []).length) problems.push(`${bucket.id}: a pending sign-up lists ${list.data.length} entries`);
    }
    ok(!problems.length, `${problems.length} problem(s):\n${problems.join("\n")}`);
  });

  await t.test("its writes are refused in words, and nothing is written: its own profile, an announcement, an event, a reimbursement, a group", async () => {
    refused(await a.from("profiles").update({ full_name: "E2E Hijacked" }).eq("id", aid).select("id"), "the applicant editing its own profile", WAITING);
    refused(await a.from("announcements").insert({ title: mark("sneaky"), body: "x", is_pinned: false, subgroup_id: null, created_by: aid }).select("id"), "the applicant posting an announcement", WAITING);
    refused(await a.from("events").insert({ title: mark("sneaky"), description: "", starts_at: new Date(Date.now() + 86400000).toISOString(), location: "", created_by: aid }).select("id"), "the applicant adding an event", WAITING);
    refused(await a.rpc("submit_member_reimbursement", { p_description: mark("sneaky"), p_vendor: "x", p_amount: 5, p_purchase_date: today(), p_category: "Supplies", p_payment_card_last4: "1234" }), "the applicant submitting a reimbursement");
    refused(await a.rpc("create_subgroup", { subgroup_name: mark("sneaky group"), subgroup_description: "", subgroup_mode: "open" }), "the applicant creating a group");
    refused(await a.from("profiles").update({ status: "active" }).eq("id", aid).select("id"), "the applicant making itself active");
    refused(await a.from("profiles").update({ role: "admin" }).eq("id", aid).select("id"), "the applicant making itself an administrator");
    const row = succeeded(await c.execA.from("profiles").select("full_name,status,role").eq("id", aid).single(), "an executive reads the applicant's profile");
    equal([row.full_name, row.status, row.role].join("|"), [ctx.accounts.applicant.name, "pending", "member"].join("|"), "the applicant's profile after its attempts");
    equal(rowsOf(await c.execA.from("announcements").select("id").eq("created_by", aid), "announcements by the applicant").length, 0, "announcements a pending sign-up posted");
  });

  await t.test("it cannot read the queue and cannot approve anyone, itself included; an active member cannot either", async () => {
    refused(await a.rpc("list_pending_members"), "the applicant reading the queue", /Only club executives/i);
    refused(await a.rpc("review_pending_member", { p_member_id: aid, p_approved: true, p_reason: "" }), "the applicant approving itself", /Only club executives/i);
    refused(await c.member1.rpc("list_pending_members"), "a member reading the queue", /Only club executives/i);
    refused(await c.member1.rpc("review_pending_member", { p_member_id: aid, p_approved: true, p_reason: "" }), "a member approving the applicant", /Only club executives/i);
    refused(await c.execA.rpc("review_pending_member", { p_member_id: id.execA, p_approved: true, p_reason: "" }), "an executive reviewing their own sign-up", /cannot review your own sign-up/i);
    refused(await c.admin.rpc("review_pending_member", { p_member_id: id.admin, p_approved: true, p_reason: "" }), "the administrator reviewing their own sign-up", /cannot review your own sign-up/i);
    equal(succeeded(await c.execA.from("profiles").select("status").eq("id", aid).single(), "applicant status").status, "pending", "status after the refused reviews");
  });

  await t.test("the directory hides the sign-up from members and shows it to executives; only executives are told how many wait", async () => {
    equal(rowsOf(await c.member1.from("profiles").select("id").eq("id", aid), "a member looks for the applicant").length, 0, "directory rows a member reads for a pending sign-up");
    equal(rowsOf(await c.execA.from("profiles").select("id").eq("id", aid), "an executive looks for the applicant").length, 1, "directory rows an executive reads for a pending sign-up");
    const members = rowsOf(await c.member1.from("profiles").select("id,status").limit(2000), "a member reads the directory");
    ok(members.length > 1 && members.every((row) => row.status === "active" || row.status === "deactivated"), "a member's directory holds a profile that is neither active nor deactivated");
    const execBoot = succeeded(await c.execA.rpc("get_portal_bootstrap"), "an executive's bootstrap");
    ok(Number.isInteger(execBoot.pending_signups) && execBoot.pending_signups >= 1, `an executive's bootstrap should count the waiting sign-up, got ${JSON.stringify(execBoot.pending_signups)}`);
    ok(!("pending_signups" in succeeded(await c.member1.rpc("get_portal_bootstrap"), "a member's bootstrap")), "a member's bootstrap has a pending_signups key");
  });

  await t.test("an executive sees the sign-up in the queue with its name, address and time", async () => {
    const queue = rowsOf(await c.execA.rpc("list_pending_members"), "the queue");
    const mine = queue.find((row) => row.member_id === aid);
    ok(mine, `the applicant is not in the queue of ${queue.length} row(s)`);
    equal([mine.status, mine.full_name, mine.email].join("|"), ["pending", ctx.accounts.applicant.name, ctx.accounts.applicant.email].join("|"), "the queue line");
    ok(mine.requested_at, "the queue line has no time of request");
    ok(mine.decided_at == null && mine.reason === "", "a waiting sign-up has no decision yet");
  });

  await t.test("an executive declines it with a reason: it is rejected, told so, still reads nothing, and the decision is on the record", async () => {
    const reviewed = firstRow(succeeded(await c.execA.rpc("review_pending_member", { p_member_id: aid, p_approved: false, p_reason: "e2e: declined to test the undo" }), "decline"));
    equal(reviewed.status, "rejected", "status returned by the decline");
    const boot = succeeded(await a.rpc("get_portal_bootstrap"), "the applicant's bootstrap after the decline");
    equal(boot.profile.status, "rejected", "status in the bootstrap after the decline");
    equal(rowsOf(await a.from("announcements").select("id").eq("id", s.note), "the declined sign-up reads the control announcement").length, 0, "control announcement rows a declined sign-up reads");
    refused(await a.from("profiles").update({ full_name: "E2E Hijacked" }).eq("id", aid).select("id"), "a declined sign-up editing its profile", /not approved/i);
    const line = rowsOf(await c.execB.rpc("list_pending_members"), "the queue after the decline").find((row) => row.member_id === aid);
    ok(line, "the declined sign-up is not in the queue, so nobody could undo it");
    equal([line.status, line.reason, line.decided_by_name].join("|"), ["rejected", "e2e: declined to test the undo", ctx.accounts.execA.name].join("|"), "the declined line: status, reason and who decided");
    const audit = rowsOf(await c.admin.from("admin_audit_log").select("action,actor_id,details").eq("action", "signup_declined").eq("target_id", aid), "audit log");
    equal(audit.length, 1, "signup_declined audit rows");
    equal(audit[0].actor_id, id.execA, "who declined, in the audit log");
    const record = succeeded(await c.execB.from("signup_reviews").select("decision,decided_by,reason").eq("member_id", aid).single(), "an executive reads the review record");
    equal([record.decision, record.decided_by, record.reason].join("|"), ["declined", id.execA, "e2e: declined to test the undo"].join("|"), "the review record");
    equal(rowsOf(await a.from("signup_reviews").select("member_id").limit(5), "the applicant reads the review records").length, 0, "review records a declined sign-up reads");
    equal(rowsOf(await c.member1.from("signup_reviews").select("member_id").limit(5), "a member reads the review records").length, 0, "review records a member reads");
  });

  await t.test("declining again changes nothing and says so", async () => {
    refused(await c.execB.rpc("review_pending_member", { p_member_id: aid, p_approved: false, p_reason: "again" }), "the second decline", /already declined/i);
    equal(rowsOf(await c.admin.from("admin_audit_log").select("id").eq("action", "signup_declined").eq("target_id", aid), "audit log").length, 1, "signup_declined audit rows after the second decline");
  });

  await t.test("another executive approves it: the undo. The same session is a member at once, and a second approval is refused", async () => {
    const reviewed = firstRow(succeeded(await c.execB.rpc("review_pending_member", { p_member_id: aid, p_approved: true, p_reason: "" }), "approve"));
    equal([reviewed.status, reviewed.role].join("|"), "active|member", "profile returned by the approval");
    const boot = succeeded(await a.rpc("get_portal_bootstrap"), "the applicant's bootstrap after the approval");
    equal([boot.profile.status, boot.profile.role].join("|"), "active|member", "status and role in the bootstrap after the approval");
    refused(await c.execA.rpc("review_pending_member", { p_member_id: aid, p_approved: true, p_reason: "" }), "a second approval", /already an active member/i);
    refused(await c.execA.rpc("review_pending_member", { p_member_id: aid, p_approved: false, p_reason: "" }), "declining an active member", /already an active member/i);
    const audit = rowsOf(await c.admin.from("admin_audit_log").select("action,actor_id").eq("action", "signup_approved").eq("target_id", aid), "audit log");
    equal(audit.length, 1, "signup_approved audit rows (the refused ones write none)");
    equal(audit[0].actor_id, id.execB, "who approved, in the audit log");
    const record = succeeded(await c.execA.from("signup_reviews").select("decision,decided_by").eq("member_id", aid).single(), "the review record after the undo");
    equal([record.decision, record.decided_by].join("|"), ["approved", id.execB].join("|"), "the review record names the second executive");
    const left = rowsOf(await c.execA.rpc("list_pending_members"), "the queue after the approval").find((row) => row.member_id === aid);
    ok(!left, "an approved sign-up is still in the queue");
  });

  await t.test("after the approval it reads the club like any member, and can edit its own profile but not its status or role", async () => {
    equal(rowsOf(await a.from("announcements").select("id").eq("id", s.note), "the approved member reads the control announcement").length, 1, "control announcement rows an approved member reads");
    const directory = rowsOf(await a.from("profiles").select("id").limit(2000), "the approved member reads the directory");
    ok(directory.length > 1, `an approved member reads ${directory.length} profile(s)`);
    const boot = succeeded(await a.rpc("get_portal_bootstrap"), "bootstrap");
    ok(boot.announcements.some((row) => row.id === s.note), "the control announcement is not in the approved member's bootstrap");
    succeeded(await a.from("profiles").update({ full_name: ctx.accounts.applicant.name, phone: "919-555-0199" }).eq("id", aid).select("id"), "the approved member edits their own profile");
    refused(await a.from("profiles").update({ status: "pending" }).eq("id", aid).select("id"), "a member making themselves pending");
    refused(await a.rpc("list_pending_members"), "the approved member reading the queue", /Only club executives/i);
  });

  await t.test("the account is removed at the end (no history): run the setup SQL again for the next run", async () => {
    succeeded(await c.admin.rpc("admin_delete_member", { p_target_id: aid }), "the administrator deletes the applicant");
    equal(rowsOf(await c.admin.from("profiles").select("id").eq("id", aid), "profile after the delete").length, 0, "profile rows after the delete");
    equal(rowsOf(await c.admin.from("signup_reviews").select("member_id").eq("member_id", aid), "review record after the delete").length, 0, "review records after the delete");
    equal(await ctx.signInOptional("applicant"), null, "sign-in after the delete");
  });
}
