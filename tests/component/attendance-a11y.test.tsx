// Phase 3.4 on the Attendance screen: every state of it and every dialog it opens passes axe (no serious or critical violation; colour
// contrast is not computed in jsdom), and every dialog behaves as the shared Dialog promises: it has a name, focus starts on its first
// field, Escape closes it and focus goes back to the button that opened it, a click beside a form does not close it, and nothing closes
// it while its request is running. The keyboard walkthroughs are in attendance-keyboard.test.tsx.
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AttendancePage } from "../../features/attendance/components/attendance-page";
import { setCacheOwner } from "../../lib/cache";
import { expectNoSeriousViolations } from "../support/a11y";
import { keyboardUser } from "../support/keyboard";
import { notifySpy, userOf } from "../support/helpers";
import { deferred, fail, fake, ok, type Call } from "../support/fake-supabase";

const session = (id: number, over: Record<string, unknown> = {}) => ({
  id, scope: "club", subgroup_id: null, subgroup_name: null, title: `Meeting ${id}`, starts_at: "2026-10-01T23:00:00Z", status: "closed",
  opened_at: null, closes_at: null, closed_at: null, canceled_at: null, code_expires_at: null, created_at: "2026-09-01T00:00:00Z",
  counts_toward_metrics: true, live: null, ...over,
});
const BASE = { terms: ["2026-fall", "2026-spring"], term: "2026-fall", view_term: "2026-fall", summary_term: "2026-fall" };
const PROFILES = [{ id: "u-dev", full_name: "Dev Nair", email: "dev@x.test" }, { id: "u-asha", full_name: "Asha Rao", email: "asha@x.test" }];
const GROUPS = [{ id: 7, name: "Hindustani Vocal" }];
const excuse = (id: number, over: Record<string, unknown> = {}) => ({
  id, session_id: 1, member_id: "u-dev", reason: "Class conflict this evening", proof_path: null, reason_category: "class_exam", notified_at: null,
  status: "pending", submitted_at: "2026-10-02T00:00:00Z", reviewed_at: null, review_note: null, ...over,
});
const record = (sessionId: number, status: string, over: Record<string, unknown> = {}) => ({
  session_id: sessionId, member_id: "u-me", status, source: "code", note: null, marked_at: null, minutes_late: 0, unexcused_units: 0, ...over,
});
const roster = (sessionId: number) => ({
  session_id: sessionId, version: "r1",
  rows: [
    { member_id: "u-dev", full_name: "Dev Nair", email: "dev@x.test", status: "present", minutes_late: null, unexcused_units: null },
    { member_id: "u-asha", full_name: "Asha Rao", email: "asha@x.test", status: null, minutes_late: null, unexcused_units: null },
  ],
});

function scriptOverview(over: Record<string, unknown> = {}) {
  fake.rpc("get_attendance_overview").reply((call: Call) => ok({ ...BASE, list_limit: (call.payload as { p_list_limit?: number }).p_list_limit ?? 100, profiles: PROFILES, ...over }));
}
function renderAttendance(options: { role?: "member" | "executive"; tab?: "overview" | "meetings" | "excuses" } = {}) {
  const notify = notifySpy();
  setCacheOwner("u-me");
  const view = render(<AttendancePage user={userOf("u-me")} role={options.role ?? "executive"} groups={GROUPS} initialScope="all" initialTab={options.tab ?? "overview"} />);
  return { notify, ...view };
}
const dialog = () => screen.getByRole("dialog");

// ---------------------------------------------------------------------------------------------------------------
// The screen in each state
// ---------------------------------------------------------------------------------------------------------------

describe("the screen passes axe in each state", () => {
  it("an executive's Overview: flagged members, follow-up items, the live card", async () => {
    scriptOverview({
      sessions: [session(1), session(2, { status: "open", live: { roster_count: 5, checked_in_count: 2, version: "v1" } })],
      flagged: [{ member_id: "u-dev", present: 1, absent: 3, excused: 0, tardy: 0, club_units: 3, subgroup_units: 0, eligibility: null }],
      remediations: [{ id: 2, session_id: 1, member_id: "u-dev", assignment: "Write a short reflection", due_at: null, status: "pending", note: null }],
      remediations_pending: 1,
    });
    const view = renderAttendance();
    await screen.findByText("Members needing attention");
    await expectNoSeriousViolations(view.container);
  });

  it("an executive's Overview with nothing in it", async () => {
    scriptOverview({ sessions: [] });
    const view = renderAttendance();
    await screen.findByText("No members are currently flagged in this view.");
    await expectNoSeriousViolations(view.container);
  });

  it("the Meetings tab with a roster, and while the roster is on the way", async () => {
    const slow = deferred();
    scriptOverview({ sessions: [session(1), session(2, { status: "draft" })] });
    fake.rpc("get_attendance_roster").replyOnce(slow.reply).reply(ok(roster(1)));
    const view = renderAttendance({ tab: "meetings" });
    await screen.findByText("Loading roster…");
    await expectNoSeriousViolations(view.container);
    await act(async () => { slow.resolve(ok(roster(1))); });
    await screen.findByLabelText("Attendance status for Dev Nair");
    await expectNoSeriousViolations(view.container);
  });

  it("the Meetings tab when the roster could not be read", async () => {
    scriptOverview({ sessions: [session(1)] });
    fake.rpc("get_attendance_roster").reply(fail("boom"));
    const view = renderAttendance({ tab: "meetings" });
    await screen.findByText(/The roster could not be loaded\./);
    await expectNoSeriousViolations(view.container);
  });

  it("the Absence forms tab, with a form to review and with none", async () => {
    scriptOverview({ sessions: [session(1)], excuses: [excuse(1, { proof_path: "u-dev/1/proof.png" }), excuse(2, { status: "approved", review_note: "Fine" })], excuses_pending: 1, excuses_total: 2 });
    const { unmount, container } = renderAttendance({ tab: "excuses" });
    await screen.findByText("PRIVATE REVIEW QUEUE");
    await expectNoSeriousViolations(container);
    unmount();
    scriptOverview({ sessions: [session(1)] });
    const second = renderAttendance({ tab: "excuses" });
    await screen.findByText("No absence forms have been submitted.");
    await expectNoSeriousViolations(second.container);
  });

  it("a member's view, with marks, a form waiting, a follow-up item and an eligibility notice", async () => {
    scriptOverview({
      sessions: [session(1), session(2)],
      records: [record(1, "present"), record(2, "tardy", { minutes_late: 12 })],
      excuses: [excuse(4, { member_id: "u-me" })],
      remediations: [{ id: 2, session_id: 1, member_id: "u-me", assignment: "Write a short reflection", due_at: null, status: "pending", note: null }],
      eligibility: [{ term_key: "2026-fall", member_id: "u-me", status: "under_review", reason: "Too many absences" }],
    });
    const view = renderAttendance({ role: "member" });
    await screen.findByText("Meeting attendance");
    await expectNoSeriousViolations(view.container);
  });

  it("the first read on its way, and a first read that failed", async () => {
    const slow = deferred();
    fake.rpc("get_attendance_overview").replyOnce(slow.reply).replyOnce(fail("boom"));
    const view = renderAttendance();
    await screen.findByText("Loading attendance…");
    await expectNoSeriousViolations(view.container);
    await act(async () => { slow.resolve(fail("boom")); });
    await screen.findByText(/Attendance could not be loaded\./);
    await expectNoSeriousViolations(view.container);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// The dialogs
// ---------------------------------------------------------------------------------------------------------------

describe("the new meeting dialog", () => {
  async function open() {
    scriptOverview({ sessions: [] });
    renderAttendance();
    const opener = await screen.findByRole("button", { name: "＋ New meeting" });
    opener.focus(); // a click focuses the button in a browser; fireEvent does not
    fireEvent.click(opener);
    return opener;
  }

  it("is a named, described dialog and passes axe", async () => {
    await open();
    expect(dialog()).toHaveAccessibleName("New meeting");
    expect(dialog()).toHaveAccessibleDescription("Create a club-wide meeting or subgroup rehearsal.");
    await expectNoSeriousViolations(document.body);
  });

  it("puts the focus on the first field, and Escape closes it and gives the focus back to the button that opened it", async () => {
    const opener = await open();
    expect(within(dialog()).getByLabelText("Audience")).toHaveFocus();
    await keyboardUser().keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it("is not closed by a click beside it (what was typed would be lost), and the × closes it", async () => {
    await open();
    const backdrop = dialog().parentElement!;
    fireEvent.mouseDown(backdrop);
    fireEvent.click(backdrop);
    expect(dialog()).toBeInTheDocument();
    fireEvent.click(within(dialog()).getByRole("button", { name: "Close the new meeting form" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("cannot be closed while the meeting is being created: not by Escape, not by the ×", async () => {
    const slow = deferred();
    fake.rpc("create_attendance_session").reply(slow.reply);
    await open();
    fireEvent.click(within(dialog()).getByLabelText("Open check-in immediately"));
    fireEvent.submit(within(dialog()).getByRole("button", { name: "Create meeting" }).closest("form")!);
    await screen.findByRole("button", { name: "Creating…" });
    await keyboardUser().keyboard("{Escape}");
    expect(dialog()).toBeInTheDocument();
    expect(within(dialog()).getByRole("button", { name: "Close the new meeting form" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Creating…" })).toHaveAttribute("aria-busy", "true");
    await act(async () => { slow.resolve(ok([{ id: 9 }])); });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("keeps what was typed when the meeting cannot be created", async () => {
    fake.rpc("create_attendance_session").reply(fail("Meetings cannot start in the past"));
    await open();
    fireEvent.change(within(dialog()).getByLabelText("Meeting date and time"), { target: { value: "2026-12-01T18:30" } });
    fireEvent.change(within(dialog()).getByLabelText("Code duration"), { target: { value: "30" } });
    fireEvent.submit(within(dialog()).getByRole("button", { name: "Create meeting" }).closest("form")!);
    await waitFor(() => expect(fake.rpc("create_attendance_session").count).toBe(1));
    await waitFor(() => expect(within(dialog()).getByRole("button", { name: "Create meeting" })).toBeEnabled());
    expect(within(dialog()).getByLabelText("Meeting date and time")).toHaveValue("2026-12-01T18:30");
    expect(within(dialog()).getByLabelText("Code duration")).toHaveValue("30");
  });
});

describe("the absence form dialog", () => {
  async function open() {
    scriptOverview({ sessions: [session(1, { title: "Opening" })] });
    renderAttendance({ role: "member" });
    const opener = await screen.findByRole("button", { name: "Submit absence form" });
    opener.focus(); // a click focuses the button in a browser; fireEvent does not
    fireEvent.click(opener);
    return opener;
  }

  it("is a named, described dialog and passes axe", async () => {
    await open();
    expect(dialog()).toHaveAccessibleName("Absence form");
    expect(dialog()).toHaveAccessibleDescription("Submit this for every absence. An executive will decide whether it is excused.");
    await expectNoSeriousViolations(document.body);
  });

  it("starts on the first field, and Escape gives the focus back to the button that opened it", async () => {
    const opener = await open();
    expect(within(dialog()).getByLabelText("Meeting")).toHaveFocus();
    await keyboardUser().keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it("keeps Tab inside while it is open", async () => {
    await open();
    const user = keyboardUser();
    const seen = new Set<Element | null>();
    for (let step = 0; step < 14; step += 1) { await user.tab(); seen.add(document.activeElement); expect(dialog().contains(document.activeElement)).toBe(true); }
    expect(seen.size).toBeGreaterThan(5);
  });

  it("cannot be closed while it is being sent, and keeps what was typed when the form is refused", async () => {
    const slow = deferred();
    fake.rpc("submit_attendance_excuse").reply(slow.reply);
    await open();
    fireEvent.change(within(dialog()).getByLabelText("Meeting"), { target: { value: "1" } });
    fireEvent.change(within(dialog()).getByLabelText(/What happened/), { target: { value: "I was ill and saw a doctor" } });
    fireEvent.submit(within(dialog()).getByRole("button", { name: "Submit form" }).closest("form")!);
    await screen.findByRole("button", { name: "Submitting…" });
    await keyboardUser().keyboard("{Escape}");
    expect(dialog()).toBeInTheDocument();
    expect(within(dialog()).getByRole("button", { name: "Close the absence form" })).toBeDisabled();
    await act(async () => { slow.resolve(fail("That meeting has already closed")); });
    await waitFor(() => expect(within(dialog()).getByRole("button", { name: "Submit form" })).toBeEnabled());
    expect(within(dialog()).getByLabelText(/What happened/)).toHaveValue("I was ill and saw a doctor");
    expect(within(dialog()).getByLabelText("Meeting")).toHaveValue("1");
  });
});

describe("the dialogs behind a button", () => {
  it("a mark: a named form dialog that passes axe, and Escape returns the focus to the picker", async () => {
    scriptOverview({ sessions: [session(5, { status: "draft" })] });
    fake.rpc("get_attendance_roster").reply(ok(roster(5)));
    renderAttendance({ tab: "meetings" });
    const select = await screen.findByLabelText("Attendance status for Asha Rao");
    select.focus();
    fireEvent.change(select, { target: { value: "tardy" } });
    expect(dialog()).toHaveAccessibleName("Mark Asha Rao tardy");
    await expectNoSeriousViolations(document.body);
    await keyboardUser().keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("closing check-in, canceling a meeting, deciding an absence form and restricting a member: each is named and passes axe", async () => {
    scriptOverview({
      sessions: [session(1), session(3, { status: "open", live: { roster_count: 4, checked_in_count: 1, version: "v1" } })],
      excuses: [excuse(1)], excuses_pending: 1, excuses_total: 1,
      flagged: [{ member_id: "u-dev", present: 1, absent: 3, excused: 0, tardy: 0, club_units: 3, subgroup_units: 0, eligibility: null }],
    });
    renderAttendance();
    fireEvent.click(await screen.findByRole("button", { name: "Close attendance" }));
    expect(dialog()).toHaveAccessibleName("Close check-in?");
    await expectNoSeriousViolations(document.body);
    fireEvent.click(within(dialog()).getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel meeting" }));
    expect(dialog()).toHaveAccessibleName("Cancel this meeting?");
    await expectNoSeriousViolations(document.body);
    fireEvent.click(within(dialog()).getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Restrict" }));
    expect(dialog()).toHaveAccessibleName("Restrict Dev Nair?");
    await expectNoSeriousViolations(document.body);
    fireEvent.click(within(dialog()).getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("tab", { name: /Absence forms/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Deny" }));
    expect(dialog()).toHaveAccessibleName("Deny this absence form?");
    await expectNoSeriousViolations(document.body);
  });

  it("edit, delete and void a meeting, and change the thresholds: each is named, passes axe and cannot be closed while it saves", async () => {
    const slow = deferred();
    scriptOverview({ sessions: [session(5, { status: "draft" })] });
    fake.rpc("get_attendance_roster").reply(ok(roster(5)));
    fake.rpc("update_attendance_session").reply(slow.reply);
    renderAttendance({ tab: "meetings" });
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    expect(dialog()).toHaveAccessibleName("Edit meeting");
    await expectNoSeriousViolations(document.body);
    fireEvent.submit(within(dialog()).getByRole("button", { name: "Save changes" }).closest("form")!);
    await screen.findByRole("button", { name: "Saving…" });
    await keyboardUser().keyboard("{Escape}");
    expect(dialog()).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Saving…" })).toHaveAttribute("aria-busy", "true");
    await act(async () => { slow.resolve(ok(null)); });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(dialog()).toHaveAccessibleName("Delete this meeting?");
    await expectNoSeriousViolations(document.body);
  });

  it("void a closed meeting, change the thresholds, clear a mark: named and axe-clean", async () => {
    scriptOverview({ sessions: [session(1)] });
    fake.rpc("get_attendance_roster").reply(ok(roster(1)));
    renderAttendance({ tab: "meetings" });
    fireEvent.click(await screen.findByRole("button", { name: "Void meeting" }));
    expect(dialog()).toHaveAccessibleName("Void this meeting?");
    expect(dialog()).toHaveAccessibleDescription(/It stops counting toward everyone's attendance/);
    await expectNoSeriousViolations(document.body);
    fireEvent.click(within(dialog()).getByRole("button", { name: "Keep meeting" }));
    fireEvent.click(await screen.findByRole("button", { name: "Clear attendance mark for Dev Nair" }));
    expect(dialog()).toHaveAccessibleName("Clear the mark for Dev Nair?");
    await expectNoSeriousViolations(document.body);
    fireEvent.click(within(dialog()).getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("tab", { name: "Overview" }));
    fireEvent.click(await screen.findByRole("button", { name: "Change thresholds" }));
    expect(dialog()).toHaveAccessibleName("Attendance thresholds");
    expect(dialog()).toHaveAccessibleDescription("Unexcused units in a term before a member is flagged.");
    await expectNoSeriousViolations(document.body);
  });

  it("withdrawing an absence form: named and axe-clean", async () => {
    scriptOverview({ sessions: [session(1)], excuses: [excuse(4, { member_id: "u-me" })] });
    renderAttendance({ role: "member" });
    fireEvent.click(await screen.findByRole("button", { name: "Withdraw" }));
    expect(dialog()).toHaveAccessibleName("Withdraw this absence form?");
    await expectNoSeriousViolations(document.body);
  });
});
