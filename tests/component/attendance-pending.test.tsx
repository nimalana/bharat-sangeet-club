// Phase 3.1 (P2-11) on the Attendance screen: every button that sends a change is off while its request runs, and a second press (a
// double click, Enter twice, a submit that lands before the page has drawn the disabled button) sends ONE request. Each test holds
// the answer back (a deferred reply), presses twice, and counts what reached the server.
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AttendancePage } from "../../features/attendance/components/attendance-page";
import { setCacheOwner } from "../../lib/cache";
import { notifySpy, userOf } from "../support/helpers";
import { deferred, fake, ok, type Call } from "../support/fake-supabase";

const session = (id: number, over: Record<string, unknown> = {}) => ({
  id, scope: "club", subgroup_id: null, subgroup_name: null, title: `Meeting ${id}`, starts_at: "2026-10-01T23:00:00Z", status: "closed",
  opened_at: null, closes_at: null, closed_at: null, canceled_at: null, code_expires_at: null, created_at: "2026-09-01T00:00:00Z",
  counts_toward_metrics: true, live: null, ...over,
});
const live = { roster_count: 4, checked_in_count: 1, version: "v1" };
const BASE = { terms: ["2026-fall"], term: "2026-fall", view_term: "2026-fall", summary_term: "2026-fall" };
const PROFILES = [{ id: "u-dev", full_name: "Dev Nair", email: "dev@x.test" }];
const excuse = (id: number, over: Record<string, unknown> = {}) => ({
  id, session_id: 1, member_id: "u-dev", reason: "Class conflict this evening", proof_path: null, reason_category: "class_exam", notified_at: null,
  status: "pending", submitted_at: "2026-10-02T00:00:00Z", reviewed_at: null, review_note: null, ...over,
});
const roster = (sessionId: number) => ({
  session_id: sessionId, version: "r1",
  rows: [{ member_id: "u-dev", full_name: "Dev Nair", email: "dev@x.test", status: "absent", minutes_late: null, unexcused_units: 1 }],
});

function scriptOverview(over: Record<string, unknown> = {}) {
  fake.rpc("get_attendance_overview").reply((call: Call) => ok({ ...BASE, list_limit: (call.payload as { p_list_limit?: number }).p_list_limit ?? 100, profiles: PROFILES, ...over }));
}
function renderAttendance(options: { role?: "member" | "executive"; tab?: "overview" | "meetings" | "excuses" } = {}) {
  const notify = notifySpy();
  setCacheOwner("u-me");
  const view = render(<AttendancePage user={userOf("u-me")} role={options.role ?? "executive"} groups={[{ id: 7, name: "Hindustani Vocal" }]} initialScope="all" initialTab={options.tab ?? "overview"} />);
  return { notify, ...view };
}
const dialog = () => screen.getByRole("dialog");
const count = (name: string) => fake.rpc(name).count;
/** Presses the same control twice before the answer comes. */
const clickTwice = (element: HTMLElement) => { fireEvent.click(element); fireEvent.click(element); };
/** Submits the same form twice: what a double press of Enter does when the first submit has not drawn the disabled button yet. */
const submitTwice = (form: HTMLFormElement) => { fireEvent.submit(form); fireEvent.submit(form); };
const formOf = (button: HTMLElement) => button.closest("form")!;

async function finish(slow: ReturnType<typeof deferred>, answer = ok(null)) {
  await act(async () => { slow.resolve(answer); });
}

describe("a double press sends one request", () => {
  it("a member's check-in", async () => {
    const slow = deferred();
    scriptOverview({ sessions: [session(1)] });
    fake.rpc("check_in_attendance").reply(slow.reply);
    renderAttendance({ role: "member" });
    const input = await screen.findByLabelText("Attendance code");
    fireEvent.change(input, { target: { value: "123456" } });
    submitTwice(formOf(input));
    expect(await screen.findByRole("button", { name: "Checking…" })).toHaveAttribute("aria-busy", "true");
    await finish(slow);
    expect(count("check_in_attendance")).toBe(1);
  });

  it("rotating the code", async () => {
    const slow = deferred();
    scriptOverview({ sessions: [session(3, { status: "open", live })] });
    fake.rpc("rotate_attendance_code").reply(slow.reply);
    renderAttendance();
    const rotate = await screen.findByRole("button", { name: "Rotate code" });
    clickTwice(rotate);
    await waitFor(() => expect(rotate).toBeDisabled());
    expect(rotate).toHaveAttribute("aria-busy", "true");
    // The other two buttons are off, but only the one that was pressed is busy.
    expect(screen.getByRole("button", { name: "Close attendance" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Close attendance" })).not.toHaveAttribute("aria-busy");
    await finish(slow, ok([{ check_in_code: "654321" }]));
    expect(count("rotate_attendance_code")).toBe(1);
  });

  it("opening check-in on a draft", async () => {
    const slow = deferred();
    scriptOverview({ sessions: [session(5, { status: "draft" })] });
    fake.rpc("get_attendance_roster").reply(ok({ session_id: 5, version: "r1", rows: [] }));
    fake.rpc("open_attendance_session").reply(slow.reply);
    renderAttendance({ tab: "meetings" });
    const open = await screen.findByRole("button", { name: "Open check-in" });
    clickTwice(open);
    await waitFor(() => expect(open).toBeDisabled());
    expect(open).toHaveAttribute("aria-busy", "true");
    await finish(slow, ok([{ check_in_code: "123456" }]));
    expect(count("open_attendance_session")).toBe(1);
  });

  it("the absence form", async () => {
    const slow = deferred();
    scriptOverview({ sessions: [session(1)] });
    fake.rpc("submit_attendance_excuse").reply(slow.reply);
    renderAttendance({ role: "member" });
    fireEvent.click(await screen.findByRole("button", { name: "Submit absence form" }));
    fireEvent.change(within(dialog()).getByLabelText("Meeting"), { target: { value: "1" } });
    fireEvent.change(within(dialog()).getByLabelText(/What happened/), { target: { value: "I was ill and saw a doctor" } });
    submitTwice(formOf(within(dialog()).getByRole("button", { name: "Submit form" })));
    await screen.findByRole("button", { name: "Submitting…" });
    await finish(slow);
    expect(count("submit_attendance_excuse")).toBe(1);
  });

  it("a mark, from the picker through its dialog", async () => {
    const slow = deferred();
    scriptOverview({ sessions: [session(5, { status: "draft" })] });
    fake.rpc("get_attendance_roster").reply(ok(roster(5)));
    fake.rpc("set_attendance_status").reply(slow.reply);
    renderAttendance({ tab: "meetings" });
    fireEvent.change(await screen.findByLabelText("Attendance status for Dev Nair"), { target: { value: "present" } });
    submitTwice(formOf(within(dialog()).getByRole("button", { name: "Save mark" })));
    await screen.findByRole("button", { name: "Working…" });
    await finish(slow);
    expect(count("set_attendance_status")).toBe(1);
  });

  it("closing and canceling check-in", async () => {
    const slow = deferred();
    scriptOverview({ sessions: [session(3, { status: "open", live })] });
    fake.rpc("close_attendance_session").reply(slow.reply);
    fake.rpc("cancel_attendance_session").reply(slow.reply);
    renderAttendance();
    fireEvent.click(await screen.findByRole("button", { name: "Close attendance" }));
    clickTwice(within(dialog()).getByRole("button", { name: "Close attendance" }));
    await screen.findByRole("button", { name: "Working…" });
    await finish(slow);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(count("close_attendance_session")).toBe(1);
  });

  it("canceling a meeting", async () => {
    const slow = deferred();
    scriptOverview({ sessions: [session(3, { status: "open", live })] });
    fake.rpc("cancel_attendance_session").reply(slow.reply);
    renderAttendance();
    fireEvent.click(await screen.findByRole("button", { name: "Cancel meeting" }));
    clickTwice(within(dialog()).getByRole("button", { name: "Cancel meeting" }));
    await screen.findByRole("button", { name: "Working…" });
    await finish(slow);
    expect(count("cancel_attendance_session")).toBe(1);
  });

  it("deciding an absence form", async () => {
    const slow = deferred();
    scriptOverview({ sessions: [session(1)], excuses: [excuse(1)], excuses_pending: 1, excuses_total: 1 });
    fake.rpc("review_attendance_excuse").reply(slow.reply);
    renderAttendance({ tab: "excuses" });
    fireEvent.click(await screen.findByRole("button", { name: "Approve" }));
    submitTwice(formOf(within(dialog()).getByRole("button", { name: "Approve" })));
    await screen.findByRole("button", { name: "Working…" });
    await finish(slow);
    expect(count("review_attendance_excuse")).toBe(1);
  });

  it("changing a member's eligibility, and completing a follow-up item", async () => {
    const slow = deferred();
    scriptOverview({
      sessions: [session(1)],
      flagged: [{ member_id: "u-dev", present: 1, absent: 3, excused: 0, tardy: 0, club_units: 3, subgroup_units: 0, eligibility: null }],
      remediations: [{ id: 2, session_id: 1, member_id: "u-dev", assignment: "Write a short reflection", due_at: null, status: "pending", note: null }],
      remediations_pending: 1,
    });
    fake.rpc("set_attendance_eligibility").reply(slow.reply);
    fake.rpc("set_attendance_remediation").reply(slow.reply);
    renderAttendance();
    fireEvent.click(await screen.findByRole("button", { name: "Restrict" }));
    fireEvent.change(within(dialog()).getByLabelText("Reason for restricting performance eligibility"), { target: { value: "Three unexcused absences" } });
    submitTwice(formOf(within(dialog()).getByRole("button", { name: "Restrict" })));
    await screen.findByRole("button", { name: "Working…" });
    await finish(slow);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(count("set_attendance_eligibility")).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: "Mark complete" }));
    submitTwice(formOf(within(dialog()).getByRole("button", { name: "Mark complete" })));
    await waitFor(() => expect(count("set_attendance_remediation")).toBe(1));
    expect(count("set_attendance_remediation")).toBe(1);
  });
});

describe("a double press in the corrections of a meeting sends one request", () => {
  async function openMeetings(status: "draft" | "closed") {
    scriptOverview({ sessions: [session(5, { status })] });
    fake.rpc("get_attendance_roster").reply(ok(roster(5)));
    renderAttendance({ tab: "meetings" });
  }

  it("edit, by the button and by the form", async () => {
    const slow = deferred();
    fake.rpc("update_attendance_session").reply(slow.reply);
    await openMeetings("draft");
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    submitTwice(formOf(within(dialog()).getByRole("button", { name: "Save changes" })));
    const save = await screen.findByRole("button", { name: "Saving…" });
    expect(save).toBeDisabled();
    clickTwice(save);
    await finish(slow);
    expect(count("update_attendance_session")).toBe(1);
  });

  it("delete", async () => {
    const slow = deferred();
    fake.rpc("delete_attendance_session").reply(slow.reply);
    await openMeetings("draft");
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
    clickTwice(within(dialog()).getByRole("button", { name: "Delete meeting" }));
    await screen.findByRole("button", { name: "Working…" });
    await finish(slow);
    expect(count("delete_attendance_session")).toBe(1);
  });

  it("void", async () => {
    const slow = deferred();
    fake.rpc("void_attendance_session").reply(slow.reply);
    await openMeetings("closed");
    fireEvent.click(await screen.findByRole("button", { name: "Void meeting" }));
    fireEvent.change(within(dialog()).getByLabelText("Reason"), { target: { value: "Created twice" } });
    submitTwice(formOf(within(dialog()).getByRole("button", { name: "Void meeting" })));
    await screen.findByRole("button", { name: "Working…" });
    await finish(slow);
    expect(count("void_attendance_session")).toBe(1);
  });

  it("clear a mark", async () => {
    const slow = deferred();
    fake.rpc("clear_attendance_status").reply(slow.reply);
    await openMeetings("closed");
    fireEvent.click(await screen.findByRole("button", { name: "Clear attendance mark for Dev Nair" }));
    clickTwice(within(dialog()).getByRole("button", { name: "Clear mark" }));
    await screen.findByRole("button", { name: "Working…" });
    await finish(slow);
    expect(count("clear_attendance_status")).toBe(1);
  });

  it("the policy levels", async () => {
    const slow = deferred();
    scriptOverview({ sessions: [session(1)] });
    fake.rpc("set_attendance_thresholds").reply(slow.reply);
    renderAttendance();
    fireEvent.click(await screen.findByRole("button", { name: "Change thresholds" }));
    fireEvent.change(within(dialog()).getByLabelText("Review at"), { target: { value: "5" } });
    submitTwice(formOf(within(dialog()).getByRole("button", { name: "Save thresholds" })));
    await screen.findByRole("button", { name: "Saving…" });
    await finish(slow);
    expect(count("set_attendance_thresholds")).toBe(1);
  });

  it("withdrawing an absence form", async () => {
    const slow = deferred();
    scriptOverview({ sessions: [session(1)], excuses: [excuse(4, { member_id: "u-me" })] });
    fake.rpc("withdraw_attendance_excuse").reply(slow.reply);
    renderAttendance({ role: "member" });
    fireEvent.click(await screen.findByRole("button", { name: "Withdraw" }));
    clickTwice(within(dialog()).getByRole("button", { name: "Withdraw" }));
    await screen.findByRole("button", { name: "Working…" });
    await finish(slow);
    expect(count("withdraw_attendance_excuse")).toBe(1);
  });
});
