// Attendance: draft edit/delete, open, rotate the code, check in, mark, clear a mark, absence forms
// (submit, withdraw, approve, deny), close, void a closed meeting and its effect on totals, thresholds.
// Group-scoped meetings are used so the club-wide roster (which includes real accounts) is not touched.
import { ok, equal, refused, succeeded, rowsOf, firstRow, nothingHappened } from "../lib/assert.mjs";
import { mark } from "../lib/ctx.mjs";
import { png, sha256 } from "../lib/fixtures.mjs";
import { put, sign, download, listed, uid } from "../lib/storage.mjs";

const inHours = (hours) => new Date(Date.now() + hours * 3600000).toISOString();

// The totals the Attendance screen shows per member (features/attendance/components/attendance-page.tsx summaries): unexcused units
// over closed meetings that count toward the metrics.
function unexcusedTotals(workspace) {
  const counted = new Set(workspace.sessions.filter((x) => x.status === "closed" && x.counts_toward_metrics).map((x) => x.id));
  const totals = {};
  for (const record of workspace.records) {
    if (!counted.has(record.session_id)) continue;
    const units = Number(record.unexcused_units) || (record.status === "absent" ? 1 : 0);
    totals[record.member_id] = (totals[record.member_id] || 0) + units;
  }
  return totals;
}

export default async function attendance(t, ctx) {
  const { c, id } = ctx;
  const g = ctx.state.g;
  const s = (ctx.state.att = {});
  const workspace = async (key, scope = "subgroup") => succeeded(await c[key].rpc("get_attendance_workspace", { p_scope: scope, p_subgroup_id: scope === "subgroup" ? g.A : null }), `${key} get_attendance_workspace`);
  t.setSection("50 attendance");

  await t.test("only executives create meetings: a plain member and a group manager are refused", async () => {
    for (const key of ["member1", "manager"]) {
      refused(await c[key].rpc("create_attendance_session", { p_scope: "subgroup", p_subgroup_id: g.A, p_title: mark("nope"), p_starts_at: inHours(2) }), `${key} creating a meeting`, /executive/i);
    }
  });

  await t.test("a draft meeting can be edited and deleted; a club-wide draft too; members never see drafts", async () => {
    const draft = firstRow(succeeded(await c.execA.rpc("create_attendance_session", { p_scope: "subgroup", p_subgroup_id: g.A, p_title: mark("draft to delete"), p_starts_at: inHours(3) }), "create draft"));
    equal(draft.status, "draft", "status of a new meeting");
    equal(rowsOf(await c.member1.from("attendance_sessions").select("id").eq("id", draft.id), "member reads draft").length, 0, "a member can see a draft meeting");
    const edited = firstRow(succeeded(await c.execA.rpc("update_attendance_session", { p_session_id: draft.id, p_title: mark("draft edited"), p_starts_at: inHours(4) }), "edit draft"));
    equal(edited.title, mark("draft edited"), "title after edit");
    refused(await c.member1.rpc("update_attendance_session", { p_session_id: draft.id, p_title: "x", p_starts_at: inHours(4) }), "member editing a draft", /executive/i);
    refused(await c.execA.rpc("update_attendance_session", { p_session_id: draft.id, p_title: "  ", p_starts_at: inHours(4) }), "editing a draft with an empty title", /title/i);
    succeeded(await c.execA.rpc("delete_attendance_session", { p_session_id: draft.id }), "delete draft");
    equal(rowsOf(await c.execA.from("attendance_sessions").select("id").eq("id", draft.id), "re-read").length, 0, "draft after delete");
    const club = firstRow(succeeded(await c.execA.rpc("create_attendance_session", { p_scope: "club", p_subgroup_id: null, p_title: mark("club draft"), p_starts_at: inHours(5) }), "create club draft"));
    succeeded(await c.execA.rpc("update_attendance_session", { p_session_id: club.id, p_title: mark("club draft edited"), p_starts_at: inHours(6) }), "edit club draft");
    succeeded(await c.execA.rpc("delete_attendance_session", { p_session_id: club.id }), "delete club draft");
  });

  await t.test("executive creates and opens a group meeting; the code is six digits, the roster is the active members of the group, and a second open meeting in the group is refused", async () => {
    s.session = firstRow(succeeded(await c.execA.rpc("create_attendance_session", { p_scope: "subgroup", p_subgroup_id: g.A, p_title: mark("Rehearsal"), p_starts_at: inHours(2) }), "create meeting"));
    const opened = firstRow(succeeded(await c.execA.rpc("open_attendance_session", { p_session_id: s.session.id, p_duration_minutes: 30 }), "open meeting"));
    ok(/^\d{6}$/.test(String(opened.check_in_code)), `check-in code is not six digits: ${opened.check_in_code}`);
    s.code1 = String(opened.check_in_code);
    const active = rowsOf(await c.execA.from("subgroup_memberships").select("member_id").eq("subgroup_id", g.A).eq("status", "active"), "active members of A");
    equal(opened.eligible_count, active.length, "eligible_count vs active members of the group");
    s.eligible = opened.eligible_count;
    const other = firstRow(succeeded(await c.execA.rpc("create_attendance_session", { p_scope: "subgroup", p_subgroup_id: g.A, p_title: mark("second"), p_starts_at: inHours(2) }), "create second"));
    refused(await c.execA.rpc("open_attendance_session", { p_session_id: other.id, p_duration_minutes: 30 }), "opening a second meeting in the same group", /already has an open/i);
    succeeded(await c.execA.rpc("delete_attendance_session", { p_session_id: other.id }), "delete the second draft");
    refused(await c.execA.rpc("update_attendance_session", { p_session_id: s.session.id, p_title: "x", p_starts_at: inHours(2) }), "editing an open meeting", /not opened yet/i);
    refused(await c.execA.rpc("delete_attendance_session", { p_session_id: s.session.id }), "deleting an open meeting", /not opened yet/i);
  });

  await t.test("rotating the code invalidates the old one; wrong code and non-roster members are refused; a roster member checks in as present", async () => {
    const rotated = firstRow(succeeded(await c.execA.rpc("rotate_attendance_code", { p_session_id: s.session.id }), "rotate code"));
    s.code2 = String(rotated.check_in_code);
    ok(s.code2 !== s.code1 && /^\d{6}$/.test(s.code2), `rotated code ${s.code2} vs ${s.code1}`);
    refused(await c.member1.rpc("check_in_attendance", { p_code: s.code1 }), "check in with the old code", /invalid or has expired/i);
    refused(await c.member1.rpc("check_in_attendance", { p_code: "000000" === s.code2 ? "111111" : "000000" }), "check in with a wrong code", /invalid or has expired/i);
    refused(await c.member2.rpc("check_in_attendance", { p_code: s.code2 }), "check in by someone not on the roster", /not eligible/i);
    refused(await c.member1.rpc("rotate_attendance_code", { p_session_id: s.session.id }), "member rotating the code", /executive/i);
    const record = succeeded(await c.member1.rpc("check_in_attendance", { p_code: s.code2 }), "check in");
    equal(record.status, "present", "status after check-in");
    equal(record.source, "self_check_in", "source after check-in");
    const own = rowsOf(await c.member1.from("attendance_records").select("status").eq("session_id", s.session.id), "member reads own record");
    equal(own.length, 1, "member's own records for the session");
  });

  await t.test("the light reads: the executive's overview carries totals but no marks, the poll is tiny and names nobody, the roster comes one meeting at a time, and a member sees only their own", async () => {
    const call = async (key, fn, args) => succeeded(await c[key].rpc(fn, args), `${key} ${fn}`);
    const others = ["leader", "manager", "victim", "nohist"];
    const overview = await call("execA", "get_attendance_overview", { p_scope: "subgroup", p_subgroup_id: g.A });
    const live = overview.sessions.find((x) => x.id === s.session.id)?.live;
    ok(live, "the open meeting is missing from the executive's overview, or carries no live counts");
    equal([overview.records.length, live.roster_count, live.checked_in_count], [0, s.eligible, 1], "overview: marks listed, roster size, checked in (member1 only)");

    const poll = await call("execA", "get_attendance_pulse", { p_scope: "subgroup", p_subgroup_id: g.A });
    equal([poll.sessions.length, poll.sessions[0]?.id, poll.sessions[0]?.live?.checked_in_count], [1, s.session.id, 1], "poll: the open meeting and its check-in count");
    ok(JSON.stringify(poll).length < 600, `the executive poll should be tiny, got ${JSON.stringify(poll).length} characters`);
    for (const key of ["member1", ...others]) ok(!JSON.stringify(poll).includes(id[key]), `the executive poll names ${key}`);
    equal(poll.sessions[0].live.version, live.version, "the poll and the overview agree on the roster version");

    const roster = await call("execA", "get_attendance_roster", { p_session_id: s.session.id });
    equal(roster.rows.length, s.eligible, "every participant is on the roster");
    equal(roster.rows.find((r) => r.member_id === id.member1)?.status, "present", "member1's mark on the roster");
    equal(roster.version, live.version, "the roster and the poll agree on the version");
    s.liveVersion = roster.version;

    const mine = await call("member1", "get_attendance_pulse", { p_scope: "subgroup", p_subgroup_id: g.A });
    equal([mine.sessions[0]?.my_record?.status, mine.sessions[0]?.my_record?.member_id, mine.sessions[0]?.live], ["present", id.member1, null], "a member's poll: own mark, no counts");
    ok(mine.pending_excuses == null, "a member's poll carries the waiting-forms count");
    for (const key of others) ok(!JSON.stringify(mine).includes(id[key]), `member1's poll names ${key}`);
    const ownRoster = await call("member1", "get_attendance_roster", { p_session_id: s.session.id });
    equal(ownRoster.rows.map((r) => r.member_id), [id.member1], "a member's roster holds only their own row");
    const memberOverview = await call("member1", "get_attendance_overview", { p_scope: "subgroup", p_subgroup_id: g.A });
    equal([memberOverview.flagged.length, memberOverview.profiles.length], [0, 1], "a member's overview: totals about others, names");
    for (const key of others) ok(!JSON.stringify(memberOverview).includes(id[key]), `member1's overview names ${key}`);
    equal((await call("member2", "get_attendance_roster", { p_session_id: s.session.id })).rows.length, 0, "a member who is not on the roster sees no rows");
  });

  await t.test("executive marks a late arrival and an excused absence, clears a mark, and clearing a missing mark is refused; members cannot mark", async () => {
    const tardy = succeeded(await c.execA.rpc("set_attendance_status", { p_session_id: s.session.id, p_member_id: id.leader, p_status: "tardy", p_note: "bus", p_minutes_late: 5 }), "mark tardy");
    equal(tardy.status, "tardy", "tardy status");
    equal(tardy.minutes_late, 5, "minutes late");
    ok(succeeded(await c.execA.rpc("get_attendance_roster", { p_session_id: s.session.id }), "roster after the mark").version !== s.liveVersion, "the roster version should change when a mark changes");
    equal(Number(tardy.unexcused_units), 0, "unexcused units for a first short tardy");
    succeeded(await c.execA.rpc("set_attendance_status", { p_session_id: s.session.id, p_member_id: id.manager, p_status: "excused", p_note: "exam", p_minutes_late: 0 }), "mark excused");
    refused(await c.member1.rpc("set_attendance_status", { p_session_id: s.session.id, p_member_id: id.leader, p_status: "present", p_note: "", p_minutes_late: 0 }), "member marking", /executive/i);
    refused(await c.execA.rpc("set_attendance_status", { p_session_id: s.session.id, p_member_id: id.member2, p_status: "present", p_note: "", p_minutes_late: 0 }), "marking someone not in the session", /not in this session/i);
    succeeded(await c.execA.rpc("clear_attendance_status", { p_session_id: s.session.id, p_member_id: id.manager }), "clear mark");
    equal(rowsOf(await c.execA.from("attendance_records").select("status").eq("session_id", s.session.id).eq("member_id", id.manager), "re-read mark").length, 0, "mark after clearing");
    refused(await c.execA.rpc("clear_attendance_status", { p_session_id: s.session.id, p_member_id: id.manager }), "clearing a mark that is not there", /no mark to clear/i);
    refused(await c.member1.rpc("clear_attendance_status", { p_session_id: s.session.id, p_member_id: id.leader }), "member clearing a mark", /executive/i);
    const audit = rowsOf(await c.execA.from("attendance_record_audit").select("previous_status,new_status,note").eq("session_id", s.session.id).eq("member_id", id.manager).order("id"), "audit rows");
    ok(audit.some((a) => a.new_status === null && a.note === "Mark cleared"), `the cleared mark is not audited: ${JSON.stringify(audit)}`);
  });

  await t.test("a member submits an absence form with proof and withdraws it; others cannot withdraw it; a proof path in someone else's folder is refused", async () => {
    const proofPath = `${id.leader}/${s.session.id}/${uid()}-proof.png`;
    succeeded(await put(c.leader, "attendance-excuses", proofPath, png(), "image/png"), "upload proof");
    const form = succeeded(await c.leader.rpc("submit_attendance_excuse", { p_session_id: s.session.id, p_reason: "I had a class exam that evening", p_proof_path: proofPath, p_reason_category: "class_exam", p_notified_at: new Date().toISOString() }), "submit form");
    equal(form.status, "pending", "excuse status");
    const mine = succeeded(await c.leader.from("attendance_excuses").select("id,status").eq("id", form.id).single(), "leader reads own form");
    equal(mine.status, "pending", "status seen by the member");
    equal(rowsOf(await c.member1.from("attendance_excuses").select("id").eq("id", form.id), "member1 reads").length, 0, "another member reads the form");
    const proofUrl = succeeded(await sign(c.execA, "attendance-excuses", proofPath), "executive signs the proof");
    equal((await download(proofUrl.signedUrl)).sha, sha256(png()), "proof bytes");
    ok(!(await sign(c.member1, "attendance-excuses", proofPath)).data?.signedUrl, "another member could sign the proof");
    refused(await c.member1.rpc("withdraw_attendance_excuse", { p_excuse_id: form.id }), "another member withdrawing", /own forms/i);
    refused(await c.leader.rpc("submit_attendance_excuse", { p_session_id: s.session.id, p_reason: "path in someone else's folder", p_proof_path: `${id.member1}/${s.session.id}/x.png`, p_reason_category: "other", p_notified_at: null }), "proof path in another member's folder", /invalid proof path/i);
    refused(await c.member2.rpc("submit_attendance_excuse", { p_session_id: s.session.id, p_reason: "I was not on the roster at all", p_proof_path: null, p_reason_category: "other", p_notified_at: null }), "form from someone not on the roster", /not on this meeting roster/i);
    const withdrawn = succeeded(await c.leader.rpc("withdraw_attendance_excuse", { p_excuse_id: form.id }), "withdraw form");
    equal(withdrawn.status, "withdrawn", "status after withdrawing");
    refused(await c.leader.rpc("withdraw_attendance_excuse", { p_excuse_id: form.id }), "withdrawing twice", /still waiting/i);
    refused(await c.execA.rpc("review_attendance_excuse", { p_excuse_id: form.id, p_decision: "approved", p_note: "" }), "reviewing a withdrawn form", /already reviewed/i);
    // The member can remove their own proof file.
    const removed = await c.leader.storage.from("attendance-excuses").remove([proofPath]);
    equal(removed.data?.length, 1, "member removing own proof");
    ok(!(await listed(c.leader, "attendance-excuses", proofPath)), "proof still listed after removal");
  });

  await t.test("executive approves one absence form and denies another; the marks follow (excused, absent)", async () => {
    const approvedForm = succeeded(await c.victim.rpc("submit_attendance_excuse", { p_session_id: s.session.id, p_reason: "Family emergency out of town", p_proof_path: null, p_reason_category: "family_emergency", p_notified_at: null }), "victim submits");
    const deniedForm = succeeded(await c.nohist.rpc("submit_attendance_excuse", { p_session_id: s.session.id, p_reason: "Wanted to sleep in that day", p_proof_path: null, p_reason_category: "other", p_notified_at: null }), "nohist submits");
    refused(await c.member1.rpc("review_attendance_excuse", { p_excuse_id: approvedForm.id, p_decision: "approved", p_note: "" }), "member reviewing", /executive/i);
    const approved = succeeded(await c.execA.rpc("review_attendance_excuse", { p_excuse_id: approvedForm.id, p_decision: "approved", p_note: "ok" }), "approve");
    equal(approved.status, "approved", "approved status");
    const denied = succeeded(await c.execA.rpc("review_attendance_excuse", { p_excuse_id: deniedForm.id, p_decision: "denied", p_note: "not accepted" }), "deny");
    equal(denied.status, "denied", "denied status");
    const marks = Object.fromEntries(rowsOf(await c.execA.from("attendance_records").select("member_id,status").eq("session_id", s.session.id), "marks").map((r) => [r.member_id, r.status]));
    equal(marks[id.victim], "excused", "mark after approval");
    equal(marks[id.nohist], "absent", "mark after denial");
  });

  await t.test("closing the meeting marks everyone still missing as absent; the closed meeting counts toward each member's unexcused total", async () => {
    const closed = succeeded(await c.execA.rpc("close_attendance_session", { p_session_id: s.session.id }), "close");
    equal(closed.status, "closed", "status after close");
    refused(await c.execA.rpc("close_attendance_session", { p_session_id: s.session.id }), "closing twice", /not open/i);
    const ws = await workspace("execA");
    const totals = unexcusedTotals(ws);
    s.totalsBefore = totals;
    equal(totals[id.manager], 1, "manager: absent after the mark was cleared and the meeting closed");
    equal(totals[id.execA], 1, "execA: absent (never checked in)");
    equal(totals[id.nohist], 1, "nohist: absent after the denied form");
    equal(totals[id.member1] || 0, 0, "member1: present");
    equal(totals[id.victim] || 0, 0, "victim: excused");
    equal(totals[id.leader] || 0, 0, "leader: short tardy");
    const manager = await workspace("manager");
    equal(manager.records.every((r) => r.member_id === id.manager), true, "a member's workspace holds only their own records");
    equal(manager.profiles.length, 1, "a member's workspace holds only their own profile");
    equal(manager.settings.warning_absences >= 1, true, "thresholds are visible to members");
  });

  await t.test("voiding the closed meeting takes it out of the totals, waives remediation, and further changes to it are refused", async () => {
    refused(await c.member1.rpc("void_attendance_session", { p_session_id: s.session.id, p_reason: "member trying" }), "member voiding", /executive/i);
    refused(await c.execA.rpc("void_attendance_session", { p_session_id: s.session.id, p_reason: "x" }), "void without a reason", /why/i);
    const voided = succeeded(await c.execA.rpc("void_attendance_session", { p_session_id: s.session.id, p_reason: "e2e: wrong date" }), "void");
    equal(voided.status, "canceled", "status after void");
    equal(voided.counts_toward_metrics, false, "counts_toward_metrics after void");
    equal(voided.cancel_reason, "e2e: wrong date", "cancel_reason");
    const ws = await workspace("execA");
    const after = unexcusedTotals(ws);
    equal(Object.values(after).reduce((a, b) => a + b, 0), 0, "sum of unexcused totals after the void");
    ok(Object.values(s.totalsBefore).reduce((a, b) => a + b, 0) >= 3, "the totals were not above zero before the void (test is not proving anything)");
    const remediations = rowsOf(await c.execA.from("attendance_remediations").select("status").eq("session_id", s.session.id), "remediations");
    ok(remediations.length >= 1 && remediations.every((r) => r.status === "waived"), `remediations after the void: ${JSON.stringify(remediations)}`);
    refused(await c.execA.rpc("void_attendance_session", { p_session_id: s.session.id, p_reason: "again" }), "voiding twice", /Only closed meetings/i);
    refused(await c.execA.rpc("clear_attendance_status", { p_session_id: s.session.id, p_member_id: id.member1 }), "clearing a mark in a voided meeting", /canceled/i);
    // 20261127090100: setting a mark is refused too (it used to reopen a waived remediation inside a voided meeting).
    refused(await c.execA.rpc("set_attendance_status", { p_session_id: s.session.id, p_member_id: id.member1, p_status: "absent", p_note: "", p_minutes_late: 0 }), "marking a member in a voided meeting", /canceled/i);
    const afterRefusal = rowsOf(await c.execA.from("attendance_remediations").select("status").eq("session_id", s.session.id), "remediations after the refused mark");
    ok(afterRefusal.every((r) => r.status === "waived"), `a refused mark reopened a remediation: ${JSON.stringify(afterRefusal)}`);
  });

  await t.test("a meeting can be canceled while it is open", async () => {
    const draft = firstRow(succeeded(await c.execA.rpc("create_attendance_session", { p_scope: "subgroup", p_subgroup_id: g.A, p_title: mark("cancel me"), p_starts_at: inHours(2) }), "create"));
    succeeded(await c.execA.rpc("open_attendance_session", { p_session_id: draft.id, p_duration_minutes: 10 }), "open");
    const canceled = succeeded(await c.execA.rpc("cancel_attendance_session", { p_session_id: draft.id }), "cancel");
    equal(canceled.status, "canceled", "status after cancel");
    s.canceledId = draft.id;
    refused(await c.execA.rpc("set_attendance_status", { p_session_id: draft.id, p_member_id: id.member1, p_status: "present", p_note: "", p_minutes_late: 0 }), "marking a member in a canceled meeting", /canceled/i);
  });

  await t.test("the warning and critical thresholds can be changed by an executive and are read back; invalid values and members are refused", async () => {
    const changed = succeeded(await c.execA.rpc("set_attendance_thresholds", { p_warning: 3, p_critical: 5 }), "change thresholds");
    equal([changed.warning_absences, changed.critical_absences], [3, 5], "thresholds returned");
    const seen = await workspace("member1", "all");
    equal([seen.settings.warning_absences, seen.settings.critical_absences], [3, 5], "thresholds seen by a member in get_attendance_workspace");
    refused(await c.execA.rpc("set_attendance_thresholds", { p_warning: 5, p_critical: 5 }), "critical not above warning", /critical level must be higher/i);
    refused(await c.member1.rpc("set_attendance_thresholds", { p_warning: 1, p_critical: 2 }), "member changing thresholds", /executive/i);
    succeeded(await c.execA.rpc("set_attendance_thresholds", { p_warning: 2, p_critical: 3 }), "restore thresholds");
  });

  await t.test("the remediation and eligibility actions work for executives and are closed to members", async () => {
    const remediation = rowsOf(await c.execA.from("attendance_remediations").select("id,status").eq("session_id", s.session.id).limit(1), "find a remediation")[0];
    ok(remediation, "no remediation exists to update");
    succeeded(await c.execA.rpc("set_attendance_remediation", { p_remediation_id: remediation.id, p_status: "complete", p_assignment: "listen to the take", p_due_at: null, p_note: "done" }), "executive completes a remediation");
    refused(await c.member1.rpc("set_attendance_remediation", { p_remediation_id: remediation.id, p_status: "waived", p_assignment: null, p_due_at: null, p_note: null }), "member changing remediation", /executive/i);
    const eligibility = succeeded(await c.execA.rpc("set_attendance_eligibility", { p_term_key: "2026-fall", p_member_id: id.member1, p_status: "under_review", p_reason: "e2e" }), "executive sets eligibility");
    equal(eligibility.status, "under_review", "eligibility status");
    refused(await c.member1.rpc("set_attendance_eligibility", { p_term_key: "2026-fall", p_member_id: id.member1, p_status: "eligible", p_reason: "self" }), "member changing own eligibility", /executive/i);
    // 20261127090000: the function is SECURITY DEFINER and records who and when; the table itself is no longer writable (20261127075000).
    equal([eligibility.updated_by, Math.abs(Date.now() - Date.parse(eligibility.updated_at)) < 600000], [id.execA, true], "the executive and the time recorded by the function");
    refused(await c.execA.from("attendance_eligibility").insert({ term_key: "2026-fall", member_id: id.member2, status: "reinstated", updated_by: id.execB }), "an executive inserting into attendance_eligibility directly", /permission denied/i);
    refused(await c.execA.from("attendance_eligibility").update({ status: "eligible", updated_by: id.execB }).eq("member_id", id.member1), "an executive updating attendance_eligibility directly", /permission denied/i);
    refused(await c.execA.from("attendance_eligibility").delete().eq("member_id", id.member1), "an executive deleting from attendance_eligibility directly", /permission denied/i);
    refused(await c.admin.from("attendance_eligibility").update({ status: "eligible" }).eq("member_id", id.member1), "an administrator updating attendance_eligibility directly", /permission denied/i);
    const own = rowsOf(await c.member1.from("attendance_eligibility").select("status").eq("member_id", id.member1), "member reads own eligibility");
    equal(own.length >= 1, true, "the member can read their own eligibility");
    nothingHappened(await c.member2.from("attendance_eligibility").select("status").eq("member_id", id.member1), "member2 reading member1's eligibility");
  });
}
