// The Attendance screen, run for real against the fake client.
//
// Replaces the five tests at the end of tests/attendance-model.test.mjs that read app/attendance.tsx as text (the
// pure-logic tests above them stay in that file). What each old assertion protected, and where it is checked now:
//
//  "attendance.tsx has no window.prompt or window.confirm and polls through the small function":
//    no browser dialogs; FormDialog and ConfirmDialog are used
//      -> "the screen asks in its own dialogs, never the browser's, and sends nothing until one is confirmed".
//    the 10 second poll uses get_attendance_pulse, polling follows page visibility, the 5 MB workspace read is gone
//      -> "the poll ..." group (what it calls, how often, when it pauses and resumes, that nothing else is called).
//  "attendance.tsx reads the roster again after check-in opens or closes":
//    opening, with and without a code in the answer; closing, canceling and every mark go through refresh()
//      -> "the roster is read again ..." group.
//  "attendance.tsx compares the overview's items version in the poll":
//    -> "a poll whose items version differs from the overview's reads the overview again" (and the same version does not).
//  "attendance.tsx asks for a larger queue cap only from the overview, never from the poll":
//    -> "Show more ..." group (p_list_limit on the overview only, a new audience or term starts again at the first page).
//  "attendance.tsx says which view the absence-form and follow-up panels list":
//    -> "the panels say which view they list".
//
// Also pinned here, because they are what the screen does today and the refactor must keep: a failing background refresh
// is reported once, the absence form's proof upload and its rollback, the toast tone of every failure that shows database
// text on this screen, and what a member does and does not see.

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AttendancePage } from "../../features/attendance/components/attendance-page";
import { setCacheOwner } from "../../lib/cache";
import { advance, flush, notifySpy, userOf } from "../support/helpers";
import { deferred, fail, fake, ok, rejects, type Call } from "../support/fake-supabase";

// ---------------------------------------------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------------------------------------------

const session = (id: number, over: Record<string, unknown> = {}) => ({
  id, scope: "club", subgroup_id: null, subgroup_name: null, title: `Meeting ${id}`, starts_at: "2026-10-01T23:00:00Z", status: "closed",
  opened_at: null, closes_at: null, closed_at: null, canceled_at: null, code_expires_at: null, created_at: "2026-09-01T00:00:00Z",
  counts_toward_metrics: true, live: null, ...over,
});
const live = (checkedIn: number, version = "v1") => ({ roster_count: 10, checked_in_count: checkedIn, version });
const BASE = { terms: ["2026-fall", "2026-spring"], term: "2026-fall", view_term: "2026-fall", summary_term: "2026-fall" };
const DEFAULT_LIMIT = 100;

/** Answers get_attendance_overview with `over` merged into a minimal overview. */
function scriptOverview(over: Record<string, unknown> | ((call: Call) => Record<string, unknown>) = {}) {
  fake.rpc("get_attendance_overview").reply((call) => ok({ ...BASE, list_limit: (call.payload as { p_list_limit?: number }).p_list_limit ?? DEFAULT_LIMIT, ...(typeof over === "function" ? over(call) : over) }));
}
const pulseOf = (sessions: unknown[], extra: Record<string, unknown> = {}) => ({ sessions, pending_excuses: 0, ...extra });
const pulseSession = (id: number, liveNow: ReturnType<typeof live>) => ({ id, status: "open", closes_at: null, code_expires_at: null, live: liveNow, my_record: null });
const roster = (sessionId: number, version = "r1") => ({
  session_id: sessionId, version,
  rows: [{ member_id: "u-dev", full_name: "Dev Nair", email: "dev@x.test", status: null, minutes_late: null, unexcused_units: null }],
});
const excuse = (id: number, over: Record<string, unknown> = {}) => ({
  id, session_id: 1, member_id: "u-dev", reason: "Class conflict this evening", proof_path: null, reason_category: "class_exam", notified_at: null,
  status: "pending", submitted_at: "2026-10-02T00:00:00Z", reviewed_at: null, review_note: null, ...over,
});

const GROUPS = [{ id: 7, name: "Hindustani Vocal" }];

function renderAttendance(options: { role?: "member" | "executive" | "admin"; tab?: "overview" | "meetings" | "excuses"; scope?: "all" | "club" | number; groups?: typeof GROUPS; userId?: string } = {}) {
  const notify = notifySpy();
  const userId = options.userId ?? "u-me";
  // The shell makes the signed-in account the cache owner before a screen mounts.
  setCacheOwner(userId);
  const view = render(<AttendancePage user={userOf(userId)} role={options.role ?? "executive"} groups={options.groups ?? GROUPS} initialScope={options.scope ?? "all"} initialTab={options.tab ?? "overview"} notify={notify} />);
  return { notify, ...view };
}
const rpcCount = (name: string) => fake.rpc(name).count;
const overviewCalls = () => fake.rpc("get_attendance_overview").calls;
const pulseCalls = () => fake.rpc("get_attendance_pulse").calls;
const rosterCalls = () => fake.rpc("get_attendance_roster").calls;
const dialog = () => screen.getByRole("dialog");
const limitOf = (call: Call) => (call.payload as { p_list_limit?: number }).p_list_limit;

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  document.dispatchEvent(new Event("visibilitychange"));
}
function restoreVisibility() { delete (document as unknown as Record<string, unknown>).visibilityState; }

// ---------------------------------------------------------------------------------------------------------------
// Dialogs
// ---------------------------------------------------------------------------------------------------------------

describe("the screen asks in its own dialogs, never the browser's, and sends nothing until one is confirmed", () => {
  it("closing check-in: a confirmation first; Cancel sends nothing; the confirmed close is sent once", async () => {
    scriptOverview({ sessions: [session(3, { status: "open", live: live(4) })] });
    fake.rpc("close_attendance_session").reply(ok(null));
    renderAttendance();
    fireEvent.click(await screen.findByRole("button", { name: "Close attendance" }));
    expect(within(dialog()).getByText("Close check-in?")).toBeInTheDocument();
    expect(rpcCount("close_attendance_session")).toBe(0);
    fireEvent.click(within(dialog()).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(rpcCount("close_attendance_session")).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: "Close attendance" }));
    fireEvent.click(within(dialog()).getByRole("button", { name: "Close attendance" }));
    await waitFor(() => expect(rpcCount("close_attendance_session")).toBe(1));
    expect(fake.rpc("close_attendance_session").calls[0].payload).toEqual({ p_session_id: 3 });
    expect(window.confirm).not.toHaveBeenCalled();
    expect(window.prompt).not.toHaveBeenCalled();
    expect(window.alert).not.toHaveBeenCalled();
  });

  it("canceling a meeting asks first and says it will not count", async () => {
    scriptOverview({ sessions: [session(3, { status: "open", live: live(4) })] });
    fake.rpc("cancel_attendance_session").reply(ok(null));
    renderAttendance();
    fireEvent.click(await screen.findByRole("button", { name: "Cancel meeting" }));
    expect(within(dialog()).getByText("Cancel this meeting?")).toBeInTheDocument();
    expect(within(dialog()).getByText("It will not count toward attendance.")).toBeInTheDocument();
    expect(rpcCount("cancel_attendance_session")).toBe(0);
    fireEvent.click(within(dialog()).getByRole("button", { name: "Cancel meeting" }));
    await waitFor(() => expect(rpcCount("cancel_attendance_session")).toBe(1));
  });

  it("a mark asks for a note in a form dialog; Cancel sends nothing; saving sends the mark with the note", async () => {
    scriptOverview({ sessions: [session(5, { status: "draft" })] });
    fake.rpc("get_attendance_roster").reply(ok(roster(5)));
    fake.rpc("set_attendance_status").reply(ok(null));
    renderAttendance({ tab: "meetings" });
    const select = await screen.findByLabelText("Attendance status for Dev Nair");
    fireEvent.change(select, { target: { value: "present" } });
    expect(within(dialog()).getByText("Mark Dev Nair present")).toBeInTheDocument();
    fireEvent.click(within(dialog()).getByRole("button", { name: "Cancel" }));
    expect(rpcCount("set_attendance_status")).toBe(0);
    fireEvent.change(screen.getByLabelText("Attendance status for Dev Nair"), { target: { value: "present" } });
    fireEvent.change(within(dialog()).getByLabelText("Correction note (optional)"), { target: { value: "Arrived early" } });
    fireEvent.submit(within(dialog()).getByRole("button", { name: "Save mark" }).closest("form")!);
    await waitFor(() => expect(rpcCount("set_attendance_status")).toBe(1));
    expect(fake.rpc("set_attendance_status").calls[0].payload).toEqual({ p_session_id: 5, p_member_id: "u-dev", p_status: "present", p_note: "Arrived early", p_minutes_late: 0 });
    expect(window.prompt).not.toHaveBeenCalled();
  });

  it("a tardy mark needs whole minutes from 0 to 1440; anything else is refused before it is sent", async () => {
    scriptOverview({ sessions: [session(5, { status: "draft" })] });
    fake.rpc("get_attendance_roster").reply(ok(roster(5)));
    fake.rpc("set_attendance_status").reply(ok(null));
    const { notify } = renderAttendance({ tab: "meetings" });
    fireEvent.change(await screen.findByLabelText("Attendance status for Dev Nair"), { target: { value: "tardy" } });
    const minutes = within(dialog()).getByLabelText("Minutes late");
    expect(minutes).toHaveValue(10);
    const submit = () => fireEvent.submit(within(dialog()).getByRole("button", { name: "Save mark" }).closest("form")!);
    fireEvent.change(minutes, { target: { value: "2000" } });
    submit();
    expect(notify.find("Enter a whole number of minutes, from 0 to 1440.").tone).toBe("error");
    expect(rpcCount("set_attendance_status")).toBe(0);
    fireEvent.change(minutes, { target: { value: "25" } });
    submit();
    await waitFor(() => expect(rpcCount("set_attendance_status")).toBe(1));
    expect(fake.rpc("set_attendance_status").calls[0].payload).toMatchObject({ p_status: "tardy", p_minutes_late: 25 });
  });

  it("a dialog that fails stays open and says why; one that works closes and says so", async () => {
    scriptOverview({ sessions: [session(5, { status: "draft" })] });
    fake.rpc("get_attendance_roster").reply(ok(roster(5)));
    fake.rpc("set_attendance_status").replyOnce(fail("This meeting is locked")).reply(ok(null));
    const { notify } = renderAttendance({ tab: "meetings" });
    fireEvent.change(await screen.findByLabelText("Attendance status for Dev Nair"), { target: { value: "absent" } });
    const submit = () => fireEvent.submit(within(dialog()).getByRole("button", { name: "Save mark" }).closest("form")!);
    submit();
    await waitFor(() => expect(notify.find("This meeting is locked").tone).toBe("error"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    submit();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(notify.find("Attendance updated")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------------------------------------------
// The poll
// ---------------------------------------------------------------------------------------------------------------

describe("the poll while check-in is open", () => {
  it("asks get_attendance_pulse every 10 seconds, with the audience and term and no list limit, and never reads the workspace", async () => {
    vi.useFakeTimers();
    scriptOverview({ sessions: [session(3, { status: "open", live: live(4) })] });
    fake.rpc("get_attendance_pulse").reply(ok(pulseOf([pulseSession(3, live(4))])));
    renderAttendance();
    await advance(1);
    expect(screen.getByText("4 of 10 checked in")).toBeInTheDocument();
    expect(pulseCalls()).toHaveLength(0);
    await advance(9_000);
    expect(pulseCalls()).toHaveLength(0);
    await advance(1_100);
    expect(pulseCalls()).toHaveLength(1);
    await advance(20_000);
    expect(pulseCalls()).toHaveLength(3);
    expect(pulseCalls()[0].payload).toEqual({ p_scope: "all", p_subgroup_id: null, p_term_key: null });
    expect(rpcCount("get_attendance_workspace")).toBe(0);
    // Only these functions are ever called by this screen on a quiet open meeting.
    const used = new Set(fake.calls.map((call) => call.target));
    expect([...used].sort()).toEqual(["get_attendance_overview", "get_attendance_pulse"]);
  });

  it("patches the open meeting in place when only the counts moved: no second read of the overview", async () => {
    vi.useFakeTimers();
    scriptOverview({ sessions: [session(3, { status: "open", live: live(4) })] });
    fake.rpc("get_attendance_pulse").reply(ok(pulseOf([pulseSession(3, live(7, "v2"))])));
    renderAttendance();
    await advance(1);
    await advance(11_000);
    expect(screen.getByText("7 of 10 checked in")).toBeInTheDocument();
    expect(overviewCalls()).toHaveLength(1);
  });

  it("pauses while the page is hidden, and asks at once when it is visible again", async () => {
    vi.useFakeTimers();
    try {
      scriptOverview({ sessions: [session(3, { status: "open", live: live(4) })] });
      fake.rpc("get_attendance_pulse").reply(ok(pulseOf([pulseSession(3, live(4))])));
      renderAttendance();
      await advance(1);
      setVisibility("hidden");
      await advance(35_000);
      expect(pulseCalls()).toHaveLength(0);
      setVisibility("visible");
      await advance(1);
      expect(pulseCalls()).toHaveLength(1);
    } finally { restoreVisibility(); }
  });

  it("does not run when no meeting is open, and stops when the screen goes away", async () => {
    vi.useFakeTimers();
    scriptOverview({ sessions: [session(1, { status: "closed" })] });
    const { unmount } = renderAttendance();
    await advance(30_000);
    expect(pulseCalls()).toHaveLength(0);
    unmount();
    fake.reset();
    await advance(30_000);
    expect(fake.calls).toHaveLength(0);
  });

  it("a poll that fails is reported once, until one succeeds", async () => {
    vi.useFakeTimers();
    scriptOverview({ sessions: [session(3, { status: "open", live: live(4) })] });
    fake.rpc("get_attendance_pulse")
      .replyOnce(fail("boom")).replyOnce(fail("boom")).replyOnce(fail("boom"))
      .replyOnce(ok(pulseOf([pulseSession(3, live(4))])))
      .reply(fail("boom"));
    const { notify } = renderAttendance();
    await advance(1);
    await advance(31_000);
    expect(notify.toasts().filter((toast) => /could not be refreshed/.test(toast.message))).toHaveLength(1);
    expect(notify.toasts()[0].tone).toBe("error");
    await advance(20_000);
    expect(notify.toasts().filter((toast) => /could not be refreshed/.test(toast.message))).toHaveLength(2);
  });

  it("an answer for a poll that is no longer the newest, or for another view, changes nothing", async () => {
    vi.useFakeTimers();
    const slow = deferred();
    scriptOverview({ sessions: [session(3, { status: "open", live: live(4) })] });
    fake.rpc("get_attendance_pulse").replyOnce(slow.reply).reply(ok(pulseOf([pulseSession(3, live(9, "v3"))])));
    renderAttendance();
    await advance(1);
    await advance(10_100);
    await advance(10_000);
    expect(screen.getByText("9 of 10 checked in")).toBeInTheDocument();
    await act(async () => { slow.resolve(ok(pulseOf([pulseSession(3, live(1, "v0"))]))); });
    await advance(1);
    expect(screen.getByText("9 of 10 checked in")).toBeInTheDocument();
  });
});

describe("what a poll reads again", () => {
  it("a meeting that is no longer open: the overview is read again", async () => {
    vi.useFakeTimers();
    scriptOverview({ sessions: [session(3, { status: "open", live: live(4) })] });
    fake.rpc("get_attendance_pulse").reply(ok(pulseOf([])));
    renderAttendance();
    await advance(1);
    await advance(11_000);
    expect(overviewCalls()).toHaveLength(2);
  });

  it("a poll whose items version differs from the overview's reads the overview again; the same version does not", async () => {
    vi.useFakeTimers();
    scriptOverview({ sessions: [session(3, { status: "open", live: live(4) })], items_version: "items-a" });
    fake.rpc("get_attendance_pulse").replyOnce(ok(pulseOf([pulseSession(3, live(4))], { items_version: "items-a" }))).reply(ok(pulseOf([pulseSession(3, live(4))], { items_version: "items-b" })));
    renderAttendance();
    await advance(1);
    await advance(10_100);
    expect(pulseCalls()).toHaveLength(1);
    expect(overviewCalls()).toHaveLength(1);
    await advance(10_000);
    expect(pulseCalls()).toHaveLength(2);
    expect(overviewCalls()).toHaveLength(2);
  });

  it("an executive's poll reads again when the number of waiting absence forms changed", async () => {
    vi.useFakeTimers();
    scriptOverview({ sessions: [session(3, { status: "open", live: live(4) })], excuses_pending: 1 });
    fake.rpc("get_attendance_pulse").reply(ok(pulseOf([pulseSession(3, live(4))], { pending_excuses: 2 })));
    renderAttendance();
    await advance(1);
    await advance(10_100);
    expect(overviewCalls()).toHaveLength(2);
  });

  it("a member's poll does not read again for the waiting-forms count (that is the executives' queue)", async () => {
    vi.useFakeTimers();
    scriptOverview({ sessions: [session(3, { status: "open", live: live(4) })], excuses_pending: 1 });
    fake.rpc("get_attendance_pulse").reply(ok(pulseOf([pulseSession(3, live(4))], { pending_excuses: 2 })));
    renderAttendance({ role: "member" });
    await advance(1);
    await advance(10_100);
    expect(overviewCalls()).toHaveLength(1);
  });

  it("the roster on the Meetings tab is read again when the poll says its marks moved, and not when they did not", async () => {
    vi.useFakeTimers();
    scriptOverview({ sessions: [session(3, { status: "open", live: live(4, "r1") })] });
    fake.rpc("get_attendance_roster").reply(ok(roster(3, "r1")));
    fake.rpc("get_attendance_pulse").replyOnce(ok(pulseOf([pulseSession(3, live(4, "r1"))]))).reply(ok(pulseOf([pulseSession(3, live(5, "r2"))])));
    renderAttendance({ tab: "meetings" });
    await advance(1);
    expect(rosterCalls()).toHaveLength(1);
    await advance(10_100);
    expect(rosterCalls()).toHaveLength(1);
    await advance(10_000);
    expect(rosterCalls()).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// The roster
// ---------------------------------------------------------------------------------------------------------------

describe("the roster is read again after anything that changes it", () => {
  async function onDraftMeeting() {
    scriptOverview({ sessions: [session(5, { status: "draft" })] });
    fake.rpc("get_attendance_roster").reply(ok(roster(5)));
    const rendered = renderAttendance({ tab: "meetings" });
    await screen.findByLabelText("Attendance status for Dev Nair");
    expect(rosterCalls()).toHaveLength(1);
    return rendered;
  }

  it("opening check-in, when the answer carries a code: the code is shown and the roster is read again", async () => {
    fake.rpc("open_attendance_session").reply(ok([{ check_in_code: "123456" }]));
    const { notify } = await onDraftMeeting();
    fireEvent.click(screen.getByRole("button", { name: "Open check-in" }));
    await waitFor(() => expect(rosterCalls()).toHaveLength(2));
    expect(fake.rpc("open_attendance_session").calls[0].payload).toEqual({ p_session_id: 5, p_duration_minutes: 60 });
    expect(notify.find("Check-in is open")).toBeTruthy();
    await waitFor(() => expect(overviewCalls().length).toBeGreaterThanOrEqual(2));
  });

  it("opening check-in, when the answer carries no code: the person is told, and the roster is still read again", async () => {
    fake.rpc("open_attendance_session").reply(ok([{}]));
    const { notify } = await onDraftMeeting();
    fireEvent.click(screen.getByRole("button", { name: "Open check-in" }));
    await waitFor(() => expect(rosterCalls()).toHaveLength(2));
    expect(notify.find(/no sign-in code was returned/).tone).toBe("error");
  });

  it("a mark: the overview and the roster are read again", async () => {
    fake.rpc("set_attendance_status").reply(ok(null));
    await onDraftMeeting();
    fireEvent.change(screen.getByLabelText("Attendance status for Dev Nair"), { target: { value: "present" } });
    fireEvent.submit(within(dialog()).getByRole("button", { name: "Save mark" }).closest("form")!);
    await waitFor(() => expect(rosterCalls()).toHaveLength(2));
    await waitFor(() => expect(overviewCalls()).toHaveLength(2));
  });

  it("closing and canceling: the overview and the roster are read again", async () => {
    scriptOverview({ sessions: [session(5, { status: "open", live: live(2) })] });
    fake.rpc("get_attendance_roster").reply(ok(roster(5)));
    fake.rpc("close_attendance_session").reply(ok(null));
    renderAttendance({ tab: "meetings" });
    await screen.findByLabelText("Attendance status for Dev Nair");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(within(dialog()).getByRole("button", { name: "Close attendance" }));
    await waitFor(() => expect(rosterCalls()).toHaveLength(2));
    await waitFor(() => expect(overviewCalls()).toHaveLength(2));
  });

  it("clearing a mark: the roster is read again", async () => {
    scriptOverview({ sessions: [session(5, { status: "closed" })] });
    fake.rpc("get_attendance_roster").reply(ok({ ...roster(5), rows: [{ ...roster(5).rows[0], status: "present" }] }));
    fake.rpc("clear_attendance_status").reply(ok(null));
    renderAttendance({ tab: "meetings" });
    fireEvent.click(await screen.findByRole("button", { name: "Clear attendance mark for Dev Nair" }));
    fireEvent.click(within(dialog()).getByRole("button", { name: "Clear mark" }));
    await waitFor(() => expect(rosterCalls()).toHaveLength(2));
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Show more
// ---------------------------------------------------------------------------------------------------------------

describe("Show more raises the cap of the review queues, from the overview only", () => {
  const forms = (count: number) => Array.from({ length: count }, (_, i) => excuse(i + 1));

  it("asks for the next cap, shows the larger list, and the poll afterwards still sends no limit", async () => {
    vi.useFakeTimers();
    scriptOverview({ sessions: [session(3, { status: "open", live: live(4) })], excuses: forms(3), excuses_total: 150, excuses_pending: 150 });
    fake.rpc("get_attendance_pulse").reply(ok(pulseOf([pulseSession(3, live(4))], { pending_excuses: 150 })));
    renderAttendance({ tab: "excuses" });
    await advance(1);
    expect(screen.getByText(/Showing the latest 3 of 150 absence forms/)).toBeInTheDocument();
    expect(limitOf(overviewCalls()[0])).toBe(100);
    fireEvent.click(screen.getByRole("button", { name: "Show more" }));
    await advance(1);
    expect(overviewCalls()).toHaveLength(2);
    expect(limitOf(overviewCalls()[1])).toBe(250);
    await advance(10_100);
    expect(pulseCalls()).toHaveLength(1);
    expect("p_list_limit" in (pulseCalls()[0].payload as object)).toBe(false);
  });

  it("climbs 100, 250, 500, 1000 and then offers no more, pointing at the filters", async () => {
    scriptOverview({ excuses: forms(3), excuses_total: 5000 });
    renderAttendance({ tab: "excuses" });
    for (const expected of [250, 500, 1000]) {
      fireEvent.click(await screen.findByRole("button", { name: "Show more" }));
      await waitFor(() => expect(limitOf(overviewCalls()[overviewCalls().length - 1])).toBe(expected));
    }
    await waitFor(() => expect(screen.queryByRole("button", { name: "Show more" })).not.toBeInTheDocument());
    expect(screen.getByText(/Narrow the view by group or term to reach them/)).toBeInTheDocument();
  });

  it("a new audience starts again at the first page, and so does a new term", async () => {
    scriptOverview({ excuses: forms(3), excuses_total: 150 });
    renderAttendance({ tab: "excuses" });
    fireEvent.click(await screen.findByRole("button", { name: "Show more" }));
    await waitFor(() => expect(limitOf(overviewCalls()[overviewCalls().length - 1])).toBe(250));
    fireEvent.change(screen.getByLabelText("Filter attendance by audience"), { target: { value: "club" } });
    await waitFor(() => expect(overviewCalls().some((call) => (call.payload as { p_scope: string }).p_scope === "club")).toBe(true));
    const afterScope = overviewCalls().filter((call) => (call.payload as { p_scope: string }).p_scope === "club");
    expect(limitOf(afterScope[0])).toBe(100);
    // Raise it again, then change the term.
    fireEvent.click(await screen.findByRole("tab", { name: /Absence forms/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Show more" }));
    await waitFor(() => expect(overviewCalls().filter((call) => limitOf(call) === 250).length).toBeGreaterThanOrEqual(2));
    fireEvent.change(screen.getByLabelText("Filter attendance by term"), { target: { value: "2026-spring" } });
    await waitFor(() => expect(overviewCalls().some((call) => (call.payload as { p_term_key: string | null }).p_term_key === "2026-spring")).toBe(true));
    const afterTerm = overviewCalls().filter((call) => (call.payload as { p_term_key: string | null }).p_term_key === "2026-spring");
    expect(limitOf(afterTerm[0])).toBe(100);
  });

  it("a Show more that fails leaves the page as it was, and the button tries again", async () => {
    fake.rpc("get_attendance_overview").replyOnce(ok({ ...BASE, list_limit: 100, excuses: forms(3), excuses_total: 150 })).replyOnce(fail("boom")).reply(ok({ ...BASE, list_limit: 250, excuses: forms(5), excuses_total: 150 }));
    const { notify } = renderAttendance({ tab: "excuses" });
    fireEvent.click(await screen.findByRole("button", { name: "Show more" }));
    await waitFor(() => expect(notify.find(/Attendance could not be loaded/).tone).toBe("error"));
    expect(screen.getAllByRole("article")).toHaveLength(3);
    fireEvent.click(await screen.findByRole("button", { name: "Show more" }));
    await waitFor(() => expect(screen.getAllByRole("article")).toHaveLength(5));
    expect(limitOf(overviewCalls()[1])).toBe(250);
    expect(limitOf(overviewCalls()[2])).toBe(250);
  });

  it("a member's queue is never capped, so there is nothing to show more of", async () => {
    scriptOverview({ excuses: forms(2), excuses_total: 150 });
    renderAttendance({ role: "member" });
    await screen.findByText("Meeting attendance");
    expect(screen.queryByRole("button", { name: "Show more" })).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------------------------------------------
// The panels
// ---------------------------------------------------------------------------------------------------------------

describe("the panels say which view they list", () => {
  it("absence forms: 'awaiting review · audience · term', following the View and Term filters", async () => {
    scriptOverview((call) => ({ excuses_pending: 3, excuses: [excuse(1)], excuses_total: 3, ...(call.payload as { p_term_key: string | null }).p_term_key ? { terms: ["2026-fall", "2026-spring"] } : {} }));
    renderAttendance({ tab: "excuses" });
    expect(await screen.findByText("3 awaiting review · All activity · All terms")).toBeInTheDocument();
    // Choosing another audience or term brings the person back to the Overview tab.
    fireEvent.change(screen.getByLabelText("Filter attendance by audience"), { target: { value: "group:7" } });
    fireEvent.click(await screen.findByRole("tab", { name: /Absence forms/ }));
    expect(await screen.findByText("3 awaiting review · Hindustani Vocal · All terms")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Filter attendance by term"), { target: { value: "2026-spring" } });
    fireEvent.click(await screen.findByRole("tab", { name: /Absence forms/ }));
    expect(await screen.findByText("3 awaiting review · Hindustani Vocal · Spring 2026")).toBeInTheDocument();
  });

  it("follow-up items: 'pending · audience · term'", async () => {
    scriptOverview({ remediations_pending: 4, remediations: [] });
    renderAttendance({ tab: "overview" });
    expect(await screen.findByText("4 pending · All activity · All terms")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Filter attendance by audience"), { target: { value: "club" } });
    expect(await screen.findByText("4 pending · Club-wide · All terms")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Meetings
// ---------------------------------------------------------------------------------------------------------------

describe("creating a meeting and rotating the code", () => {
  it("a club-wide meeting with check-in opened at once: created, then opened for the length chosen", async () => {
    scriptOverview({ sessions: [] });
    fake.rpc("create_attendance_session").reply(ok([{ id: 9 }]));
    fake.rpc("open_attendance_session").reply(ok([{ check_in_code: "654321" }]));
    const { notify } = renderAttendance();
    fireEvent.click(await screen.findByRole("button", { name: "＋ New meeting" }));
    const form = screen.getByRole("button", { name: "Create meeting" }).closest("form")!;
    fireEvent.change(within(form).getByLabelText("Meeting date and time"), { target: { value: "2026-11-02T18:30" } });
    fireEvent.change(within(form).getByLabelText("Code duration"), { target: { value: "30" } });
    fireEvent.submit(form);
    await waitFor(() => expect(notify.find("Meeting created")).toBeTruthy());
    const created = fake.rpc("create_attendance_session").calls[0].payload as Record<string, unknown>;
    expect(created).toMatchObject({ p_scope: "club", p_subgroup_id: null, p_title: "General Body Meeting" });
    expect(new Date(created.p_starts_at as string).getTime()).toBe(new Date("2026-11-02T18:30").getTime());
    expect(fake.rpc("open_attendance_session").calls[0].payload).toEqual({ p_session_id: 9, p_duration_minutes: 30 });
    expect(fake.rpc("create_attendance_session").calls[0].seq).toBeLessThan(fake.rpc("open_attendance_session").calls[0].seq);
  });

  it("a subgroup rehearsal is named after the group", async () => {
    scriptOverview({ sessions: [] });
    fake.rpc("create_attendance_session").reply(ok([{ id: 9 }]));
    renderAttendance();
    fireEvent.click(await screen.findByRole("button", { name: "＋ New meeting" }));
    const form = screen.getByRole("button", { name: "Create meeting" }).closest("form")!;
    fireEvent.change(within(form).getByLabelText("Audience"), { target: { value: "subgroup:7" } });
    fireEvent.click(within(form).getByLabelText("Open check-in immediately"));
    fireEvent.submit(form);
    await waitFor(() => expect(rpcCount("create_attendance_session")).toBe(1));
    expect(fake.rpc("create_attendance_session").calls[0].payload).toMatchObject({ p_scope: "subgroup", p_subgroup_id: 7, p_title: "Hindustani Vocal rehearsal" });
    expect(rpcCount("open_attendance_session")).toBe(0);
  });

  it("a double submit of the new-meeting form creates one meeting", async () => {
    const slow = deferred();
    scriptOverview({ sessions: [] });
    fake.rpc("create_attendance_session").reply(slow.reply);
    renderAttendance();
    fireEvent.click(await screen.findByRole("button", { name: "＋ New meeting" }));
    const form = screen.getByRole("button", { name: "Create meeting" }).closest("form")!;
    fireEvent.click(within(form).getByLabelText("Open check-in immediately"));
    act(() => { fireEvent.submit(form); fireEvent.submit(form); });
    await waitFor(() => expect(rpcCount("create_attendance_session")).toBe(1));
    await flush();
    expect(rpcCount("create_attendance_session")).toBe(1);
    await act(async () => { slow.resolve(ok([{ id: 9 }])); });
  });

  it("rotating the code shows the new one", async () => {
    scriptOverview({ sessions: [session(3, { status: "open", live: live(4) })] });
    fake.rpc("rotate_attendance_code").reply(ok([{ check_in_code: "999111" }]));
    const { notify } = renderAttendance();
    expect(await screen.findByText("Hidden after reload")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Rotate code" }));
    expect(await screen.findByText("999111")).toBeInTheDocument();
    expect(notify.find("A new code is active")).toBeTruthy();
  });
});

describe("what the screen shows when it cannot load", () => {
  it("says so with a way to try again, and loads when the person does", async () => {
    fake.rpc("get_attendance_overview").replyOnce(fail("boom")).reply(ok({ ...BASE, sessions: [session(1)] }));
    const { notify } = renderAttendance();
    expect(await screen.findByText(/Attendance could not be loaded\./)).toBeInTheDocument();
    expect(notify.find(/Attendance could not be loaded/).tone).toBe("error");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { name: "Attendance" })).toBeInTheDocument();
  });

  it("while the first read is on the way, the screen shows the loading line and nothing else", async () => {
    const slow = deferred();
    fake.rpc("get_attendance_overview").reply(slow.reply);
    renderAttendance();
    const line = await screen.findByText("Loading attendance…");
    expect(line.tagName).toBe("DIV");
    expect(line.className).toBe("inline-loading");
    expect(screen.queryByRole("heading", { name: "Attendance" })).not.toBeInTheDocument();
    await act(async () => { slow.resolve(ok({ ...BASE, sessions: [] })); });
    expect(await screen.findByRole("heading", { name: "Attendance" })).toBeInTheDocument();
    expect(screen.queryByText("Loading attendance…")).not.toBeInTheDocument();
  });

  it("the failed first read is one line in the loading style: the sentence, then Try again", async () => {
    fake.rpc("get_attendance_overview").reply(fail("boom"));
    renderAttendance();
    const line = (await screen.findByText(/Attendance could not be loaded\./)).closest("div")!;
    expect(line.className).toBe("inline-loading");
    expect(line.textContent).toBe("Attendance could not be loaded. Try again");
    expect(within(line).getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("a roster that cannot be read says so in the empty-panel style and reads it again on Try again; while it is read, it says Loading roster…", async () => {
    scriptOverview({ sessions: [session(3, { status: "open", live: live(4, "r1") })] });
    const slow = deferred();
    fake.rpc("get_attendance_roster").replyOnce(slow.reply).replyOnce(fail("boom")).reply(ok(roster(3, "r1")));
    renderAttendance({ tab: "meetings" });
    const loading = await screen.findByText("Loading roster…");
    expect(loading.className).toBe("inline-loading");
    await act(async () => { slow.resolve(fail("boom")); });
    const block = (await screen.findByText(/The roster could not be loaded\./)).closest("div")!;
    expect(block.className).toBe("attendance-empty");
    expect(block.textContent).toBe("The roster could not be loaded. Try again");
    const before = rosterCalls().length;
    fireEvent.click(within(block).getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(rosterCalls().length).toBeGreaterThan(before));
  });

  it("a dropped connection reads the same", async () => {
    fake.rpc("get_attendance_overview").reply(rejects());
    const { notify } = renderAttendance();
    expect(await screen.findByText(/Attendance could not be loaded\./)).toBeInTheDocument();
    expect(notify.find(/Check your connection/).tone).toBe("error");
  });

  it("only the newest answer is used: a slow answer for the old audience does not erase the failure of the new one", async () => {
    const slow = deferred();
    fake.rpc("get_attendance_overview")
      .replyOnce(ok({ ...BASE, list_limit: 100, excuses: [excuse(1)], excuses_total: 150 }))
      .replyOnce(slow.reply)
      .replyOnce(fail("boom"));
    renderAttendance({ tab: "excuses" });
    // "Show more" is still waiting for its answer when the person picks another audience, which then fails to load.
    fireEvent.click(await screen.findByRole("button", { name: "Show more" }));
    await waitFor(() => expect(overviewCalls()).toHaveLength(2));
    fireEvent.change(screen.getByLabelText("Filter attendance by audience"), { target: { value: "club" } });
    expect(await screen.findByText(/Attendance could not be loaded\./)).toBeInTheDocument();
    // The old answer arrives late. It belongs to another view and must not touch this one.
    await act(async () => { slow.resolve(ok({ ...BASE, list_limit: 250, excuses: [excuse(1), excuse(2)], excuses_total: 150 })); });
    expect(screen.getByText(/Attendance could not be loaded\./)).toBeInTheDocument();
    expect(screen.queryByText("Loading attendance…")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------------------------------------------

describe("a member", () => {
  it("sees their own history and no management controls", async () => {
    scriptOverview({ sessions: [session(1, { title: "Opening meeting" })], records: [{ session_id: 1, member_id: "u-me", status: "present", source: "code", note: null, marked_at: null, minutes_late: 0, unexcused_units: 0 }] });
    renderAttendance({ role: "member" });
    expect(await screen.findByText("Meeting attendance")).toBeInTheDocument();
    expect(screen.getByText("Opening meeting")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "＋ New meeting" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Meetings" })).not.toBeInTheDocument();
    expect(rosterCalls()).toHaveLength(0);
  });

  it("checks in with the code typed: spaces dropped, upper case; a refusal is shown on the form", async () => {
    scriptOverview({ sessions: [session(1)] });
    fake.rpc("check_in_attendance").replyOnce(fail("That code has expired")).reply(ok(null));
    const { notify } = renderAttendance({ role: "member" });
    const input = await screen.findByLabelText("Attendance code");
    fireEvent.change(input, { target: { value: "12 34 56" } });
    fireEvent.submit(input.closest("form")!);
    expect(await screen.findByText("That code has expired")).toBeInTheDocument();
    expect(fake.rpc("check_in_attendance").calls[0].payload).toEqual({ p_code: "123456" });
    fireEvent.submit(input.closest("form")!);
    expect(await screen.findByText("You are checked in. Your attendance is confirmed.")).toBeInTheDocument();
    expect(notify.find("Attendance confirmed")).toBeTruthy();
  });

  it("withdraws a waiting form after confirming", async () => {
    scriptOverview({ sessions: [session(1)], excuses: [excuse(4, { member_id: "u-me" })] });
    fake.rpc("withdraw_attendance_excuse").reply(ok(null));
    renderAttendance({ role: "member" });
    fireEvent.click(await screen.findByRole("button", { name: "Withdraw" }));
    expect(rpcCount("withdraw_attendance_excuse")).toBe(0);
    fireEvent.click(within(dialog()).getByRole("button", { name: "Withdraw" }));
    await waitFor(() => expect(rpcCount("withdraw_attendance_excuse")).toBe(1));
    expect(fake.rpc("withdraw_attendance_excuse").calls[0].payload).toEqual({ p_excuse_id: 4 });
  });
});

describe("the absence form: the proof image, and what happens to it when the form is refused", () => {
  const PROOF = (over: { name?: string; type?: string; size?: number } = {}) => {
    const file = new File(["x".repeat(10)], over.name ?? "note from doctor.png", { type: over.type ?? "image/png" });
    if (over.size) Object.defineProperty(file, "size", { value: over.size });
    return file;
  };

  async function fillExcuse(file?: File) {
    scriptOverview({ sessions: [session(1)] });
    const rendered = renderAttendance({ role: "member" });
    fireEvent.click(await screen.findByRole("button", { name: "Submit absence form" }));
    const form = screen.getByRole("button", { name: "Submit form" }).closest("form")!;
    fireEvent.change(within(form).getByLabelText("Meeting"), { target: { value: "1" } });
    fireEvent.change(within(form).getByLabelText(/What happened/), { target: { value: "I was ill and saw a doctor" } });
    if (file) fireEvent.change(within(form).getByLabelText(/Proof image/), { target: { files: [file] } });
    return { ...rendered, form };
  }

  it("uploads the proof under the member's folder, then submits the form with its path", async () => {
    fake.rpc("submit_attendance_excuse").reply(ok(null));
    const { form, notify } = await fillExcuse(PROOF());
    fireEvent.submit(form);
    await waitFor(() => expect(notify.find("Absence form submitted")).toBeTruthy());
    const upload = fake.storage("attendance-excuses", "upload").calls[0];
    expect(upload.args[0]).toMatch(/^u-me\/1\/[0-9a-f-]{36}-note-from-doctor\.png$/);
    expect(fake.rpc("submit_attendance_excuse").calls[0].payload).toMatchObject({ p_session_id: 1, p_reason: "I was ill and saw a doctor", p_proof_path: upload.args[0], p_reason_category: "other", p_notified_at: null });
    expect(fake.storage("attendance-excuses", "remove").count).toBe(0);
  });

  it("when the form is refused, the proof just uploaded is removed again", async () => {
    // Today this is a bare remove(): it does not look at what storage answers. The test pins that the rollback happens.
    fake.rpc("submit_attendance_excuse").reply(fail("You already submitted a form for this meeting"));
    const { form, notify } = await fillExcuse(PROOF());
    fireEvent.submit(form);
    await waitFor(() => expect(notify.find("You already submitted a form for this meeting").tone).toBe("error"));
    expect(fake.storage("attendance-excuses", "remove").calls).toHaveLength(1);
    expect(fake.storage("attendance-excuses", "remove").calls[0].args[0]).toEqual([fake.storage("attendance-excuses", "upload").calls[0].args[0]]);
    expect(screen.getByRole("button", { name: "Submit form" })).toBeInTheDocument();
  });

  it("a form with no proof uploads nothing and removes nothing", async () => {
    fake.rpc("submit_attendance_excuse").reply(fail("You already submitted a form for this meeting"));
    const { form } = await fillExcuse();
    fireEvent.submit(form);
    await waitFor(() => expect(rpcCount("submit_attendance_excuse")).toBe(1));
    expect(fake.rpc("submit_attendance_excuse").calls[0].payload).toMatchObject({ p_proof_path: null });
    expect(fake.storage("*", "upload").count).toBe(0);
    expect(fake.storage("*", "remove").count).toBe(0);
  });

  it("a proof that cannot be uploaded stops the form: nothing is submitted", async () => {
    fake.storage("attendance-excuses", "upload").reply(fail("Bucket not found"));
    const { form, notify } = await fillExcuse(PROOF());
    fireEvent.submit(form);
    await waitFor(() => expect(notify.find("Bucket not found").tone).toBe("error"));
    expect(rpcCount("submit_attendance_excuse")).toBe(0);
  });

  it("a proof over 8 MB, or one that is not an image, is refused before anything is sent", async () => {
    const { form, notify } = await fillExcuse(PROOF({ size: 9 * 1024 * 1024 }));
    fireEvent.submit(form);
    expect(notify.find("Proof images must be smaller than 8 MB").tone).toBe("error");
    fireEvent.change(within(form).getByLabelText(/Proof image/), { target: { files: [PROOF({ name: "notes.pdf", type: "application/pdf" })] } });
    fireEvent.submit(form);
    expect(notify.find("Choose an image as proof").tone).toBe("error");
    expect(fake.storage("*", "upload").count).toBe(0);
    expect(rpcCount("submit_attendance_excuse")).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Toast tone: every failure on this screen that shows database text says "error"
// ---------------------------------------------------------------------------------------------------------------
//
// Replaces the part of tests/toast-call-sites.test.mjs that scanned app/attendance.tsx and
// components/attendance/attendance-corrections.tsx for notify() calls that pass database text. The database's words say
// nothing about whether it failed (the sentence below has none of the usual words of a failure), so the tone has to come
// from the call. The same sentence is made the database's answer to each action and the toast is checked.

const CHEERFUL = "Everything has been saved";
describe("a failure that shows the database's own sentence is announced as an error", () => {
  const cheerful = () => fail(CHEERFUL);
  const toneOfSentence = (notify: ReturnType<typeof notifySpy>) => notify.toasts().filter((toast) => toast.message.includes(CHEERFUL)).map((toast) => toast.tone);

  it("creating a meeting", async () => {
    scriptOverview({ sessions: [] });
    fake.rpc("create_attendance_session").reply(cheerful());
    const { notify } = renderAttendance();
    fireEvent.click(await screen.findByRole("button", { name: "＋ New meeting" }));
    fireEvent.submit(screen.getByRole("button", { name: "Create meeting" }).closest("form")!);
    await waitFor(() => expect(toneOfSentence(notify)).toEqual(["error"]));
  });

  it("opening check-in", async () => {
    scriptOverview({ sessions: [session(5, { status: "draft" })] });
    fake.rpc("get_attendance_roster").reply(ok(roster(5)));
    fake.rpc("open_attendance_session").reply(cheerful());
    const { notify } = renderAttendance({ tab: "meetings" });
    fireEvent.click(await screen.findByRole("button", { name: "Open check-in" }));
    await waitFor(() => expect(toneOfSentence(notify)).toEqual(["error"]));
  });

  it("rotating the code", async () => {
    scriptOverview({ sessions: [session(3, { status: "open", live: live(4) })] });
    fake.rpc("rotate_attendance_code").reply(cheerful());
    const { notify } = renderAttendance();
    fireEvent.click(await screen.findByRole("button", { name: "Rotate code" }));
    await waitFor(() => expect(toneOfSentence(notify)).toEqual(["error"]));
  });

  it("a mark, an approval and closing (the dialogs)", async () => {
    scriptOverview({ sessions: [session(5, { status: "open", live: live(1) })], excuses: [excuse(1)], excuses_pending: 1, excuses_total: 1 });
    fake.rpc("get_attendance_roster").reply(ok(roster(5)));
    fake.rpc("set_attendance_status").reply(cheerful());
    fake.rpc("review_attendance_excuse").reply(cheerful());
    fake.rpc("close_attendance_session").reply(cheerful());
    const { notify } = renderAttendance({ tab: "meetings" });
    fireEvent.change(await screen.findByLabelText("Attendance status for Dev Nair"), { target: { value: "absent" } });
    fireEvent.submit(within(dialog()).getByRole("button", { name: "Save mark" }).closest("form")!);
    await waitFor(() => expect(toneOfSentence(notify)).toEqual(["error"]));
    fireEvent.click(within(dialog()).getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(within(dialog()).getByRole("button", { name: "Close attendance" }));
    await waitFor(() => expect(toneOfSentence(notify)).toEqual(["error", "error"]));
    fireEvent.click(within(dialog()).getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("tab", { name: /Absence forms/ }));
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    fireEvent.submit(within(dialog()).getByRole("button", { name: "Approve" }).closest("form")!);
    await waitFor(() => expect(toneOfSentence(notify)).toEqual(["error", "error", "error"]));
  });

  it("the absence form: a refused upload and a refused form", async () => {
    scriptOverview({ sessions: [session(1)] });
    fake.storage("attendance-excuses", "upload").replyOnce(cheerful());
    fake.rpc("submit_attendance_excuse").reply(cheerful());
    const { notify } = renderAttendance({ role: "member" });
    fireEvent.click(await screen.findByRole("button", { name: "Submit absence form" }));
    const form = screen.getByRole("button", { name: "Submit form" }).closest("form")!;
    fireEvent.change(within(form).getByLabelText("Meeting"), { target: { value: "1" } });
    fireEvent.change(within(form).getByLabelText(/What happened/), { target: { value: "I was ill and saw a doctor" } });
    fireEvent.change(within(form).getByLabelText(/Proof image/), { target: { files: [new File(["x"], "p.png", { type: "image/png" })] } });
    fireEvent.submit(form);
    await waitFor(() => expect(toneOfSentence(notify)).toEqual(["error"]));
    fireEvent.submit(form);
    await waitFor(() => expect(toneOfSentence(notify)).toEqual(["error", "error"]));
  });

  it("the meeting corrections: edit, delete, clear a mark, change the thresholds", async () => {
    scriptOverview({ sessions: [session(5, { status: "draft" })] });
    fake.rpc("get_attendance_roster").reply(ok({ ...roster(5), rows: [{ ...roster(5).rows[0], status: "present" }] }));
    for (const name of ["update_attendance_session", "delete_attendance_session", "clear_attendance_status", "set_attendance_thresholds"]) fake.rpc(name).reply(cheerful());
    const { notify } = renderAttendance({ tab: "meetings" });
    await screen.findByLabelText("Attendance status for Dev Nair");
    // Edit
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.submit(screen.getByRole("heading", { name: "Edit meeting" }).closest('[role="dialog"]')!.querySelector("form")!);
    await waitFor(() => expect(toneOfSentence(notify)).toEqual(["error"]));
    fireEvent.click(within(dialog()).getByRole("button", { name: "Cancel" }));
    // Delete
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(within(dialog()).getByRole("button", { name: "Delete meeting" }));
    await waitFor(() => expect(toneOfSentence(notify)).toHaveLength(2));
    fireEvent.click(within(dialog()).getByRole("button", { name: "Cancel" }));
    // Clear a mark
    fireEvent.click(screen.getByRole("button", { name: "Clear attendance mark for Dev Nair" }));
    fireEvent.click(within(dialog()).getByRole("button", { name: "Clear mark" }));
    await waitFor(() => expect(toneOfSentence(notify)).toHaveLength(3));
    fireEvent.click(within(dialog()).getByRole("button", { name: "Cancel" }));
    // Thresholds
    fireEvent.click(screen.getByRole("tab", { name: "Overview" }));
    fireEvent.click(await screen.findByRole("button", { name: "Change thresholds" }));
    fireEvent.submit(screen.getByRole("heading", { name: "Attendance thresholds" }).closest('[role="dialog"]')!.querySelector("form")!);
    await waitFor(() => expect(toneOfSentence(notify)).toHaveLength(4));
    expect(toneOfSentence(notify)).toEqual(["error", "error", "error", "error"]);
  });

  it("voiding a closed meeting", async () => {
    scriptOverview({ sessions: [session(5, { status: "closed" })] });
    fake.rpc("get_attendance_roster").reply(ok(roster(5)));
    fake.rpc("void_attendance_session").reply(cheerful());
    const { notify } = renderAttendance({ tab: "meetings" });
    fireEvent.click(await screen.findByRole("button", { name: "Void meeting" }));
    fireEvent.change(within(dialog()).getByLabelText("Reason"), { target: { value: "Created twice" } });
    fireEvent.submit(within(dialog()).getByRole("button", { name: "Void meeting" }).closest("form")!);
    await waitFor(() => expect(toneOfSentence(notify)).toEqual(["error"]));
  });

  it("withdrawing an absence form", async () => {
    scriptOverview({ sessions: [session(1)], excuses: [excuse(4, { member_id: "u-me" })] });
    fake.rpc("withdraw_attendance_excuse").reply(cheerful());
    const { notify } = renderAttendance({ role: "member" });
    fireEvent.click(await screen.findByRole("button", { name: "Withdraw" }));
    fireEvent.click(within(dialog()).getByRole("button", { name: "Withdraw" }));
    await waitFor(() => expect(toneOfSentence(notify)).toEqual(["error"]));
  });
});
