// What the attendance screen does when the person acts, one flow at a time: member check-in, creating a meeting and opening
// check-in, rotating the code, the dialogs behind a mark / a decision / a follow-up item / an eligibility change / closing or
// canceling, and the absence form's proof link. attendance.test.tsx pins the reads (poll, roster, queue caps), the single-flight
// guards and the failure tones; this file pins the sentences, the order and what each flow leaves behind on screen, so the
// hooks behind them (use-live-check-in, use-attendance-dialogs, use-absence-form) can move without losing any of it.
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AttendancePage } from "../../features/attendance/components/attendance-page";
import { setCacheOwner } from "../../lib/cache";
import { notifySpy, userOf } from "../support/helpers";
import { deferred, fail, fake, ok, type Call } from "../support/fake-supabase";

const session = (id: number, over: Record<string, unknown> = {}) => ({
  id, scope: "club", subgroup_id: null, subgroup_name: null, title: `Meeting ${id}`, starts_at: "2026-10-01T23:00:00Z", status: "closed",
  opened_at: null, closes_at: null, closed_at: null, canceled_at: null, code_expires_at: null, created_at: "2026-09-01T00:00:00Z",
  counts_toward_metrics: true, live: null, ...over,
});
const live = (checkedIn: number) => ({ roster_count: 10, checked_in_count: checkedIn, version: "v1" });
const BASE = { terms: ["2026-fall", "2026-spring"], term: "2026-fall", view_term: "2026-fall", summary_term: "2026-fall" };
const PROFILES = [{ id: "u-dev", full_name: "Dev Nair", email: "dev@x.test" }];
const excuse = (id: number, over: Record<string, unknown> = {}) => ({
  id, session_id: 1, member_id: "u-dev", reason: "Class conflict this evening", proof_path: null, reason_category: "class_exam", notified_at: null,
  status: "pending", submitted_at: "2026-10-02T00:00:00Z", reviewed_at: null, review_note: null, ...over,
});
const roster = (sessionId: number) => ({
  session_id: sessionId, version: "r1", rows: [{ member_id: "u-dev", full_name: "Dev Nair", email: "dev@x.test", status: null, minutes_late: null, unexcused_units: null }],
});
// A database sentence the screen replaces with its own: the person sees the fallback.
const RAW = 'new row violates check constraint "attendance_check"';

function scriptOverview(over: Record<string, unknown> = {}) {
  fake.rpc("get_attendance_overview").reply((call: Call) => ok({ ...BASE, list_limit: (call.payload as { p_list_limit?: number }).p_list_limit ?? 100, profiles: PROFILES, ...over }));
}

function renderAttendance(options: { role?: "member" | "executive"; tab?: "overview" | "meetings" | "excuses" } = {}) {
  const notify = notifySpy();
  setCacheOwner("u-me");
  const view = render(<AttendancePage user={userOf("u-me")} role={options.role ?? "executive"} groups={[{ id: 7, name: "Hindustani Vocal" }]} initialScope="all" initialTab={options.tab ?? "overview"} />);
  return { notify, ...view };
}
const overviewCalls = () => fake.rpc("get_attendance_overview").calls;
const rosterCalls = () => fake.rpc("get_attendance_roster").calls;
const dialog = () => screen.getByRole("dialog");
const submitIn = (button: string) => fireEvent.submit(within(dialog()).getByRole("button", { name: button }).closest("form")!);
const confirmIn = (button: string) => fireEvent.click(within(dialog()).getByRole("button", { name: button }));

// ---------------------------------------------------------------------------------------------------------------
// A member checks in
// ---------------------------------------------------------------------------------------------------------------

describe("a member checks in", () => {
  it("a check-in that works empties the box, says so in the success style, and reads the overview again", async () => {
    scriptOverview({ sessions: [session(1)] });
    fake.rpc("check_in_attendance").reply(ok(null));
    renderAttendance({ role: "member" });
    const input = (await screen.findByLabelText("Attendance code")) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "123456" } });
    fireEvent.submit(input.closest("form")!);
    const message = await screen.findByText("You are checked in. Your attendance is confirmed.");
    expect(message).toHaveClass("attendance-feedback", "success");
    expect(message).toHaveAttribute("role", "status");
    expect(input.value).toBe("");
    await waitFor(() => expect(overviewCalls()).toHaveLength(2));
  });

  it("a refusal keeps what was typed, shows the database's sentence in the error style, and reads nothing again", async () => {
    scriptOverview({ sessions: [session(1)] });
    fake.rpc("check_in_attendance").reply(fail("That code has expired"));
    const { notify } = renderAttendance({ role: "member" });
    const input = (await screen.findByLabelText("Attendance code")) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "123456" } });
    fireEvent.submit(input.closest("form")!);
    expect(await screen.findByText("That code has expired")).toHaveClass("attendance-feedback", "error");
    expect(input.value).toBe("123456");
    expect(notify.toasts()).toEqual([]);
    expect(overviewCalls()).toHaveLength(1);
  });

  it("a new check-in starts without the last message, and a new audience or term forgets it", async () => {
    const slow = deferred();
    scriptOverview({ sessions: [session(1)] });
    fake.rpc("check_in_attendance").replyOnce(fail("That code has expired")).reply(slow.reply);
    renderAttendance({ role: "member" });
    const input = (await screen.findByLabelText("Attendance code")) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "123456" } });
    fireEvent.submit(input.closest("form")!);
    await screen.findByText("That code has expired");
    // The next check-in clears it at once, while the answer is still on the way.
    fireEvent.submit(input.closest("form")!);
    await waitFor(() => expect(fake.rpc("check_in_attendance").count).toBe(2));
    expect(screen.queryByText("That code has expired")).not.toBeInTheDocument();
    await act(async () => { slow.resolve(fail("That code has expired")); });
    await screen.findByText("That code has expired");
    fireEvent.change(screen.getByLabelText("Filter attendance by term"), { target: { value: "2026-spring" } });
    // The screen shows the loading line while the other term is read; the message must not come back with the form.
    await screen.findByLabelText("Attendance code");
    expect(screen.queryByText("That code has expired")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Opening check-in, creating a meeting, rotating the code
// ---------------------------------------------------------------------------------------------------------------

describe("opening check-in on a meeting that has not opened", () => {
  async function onDraftMeeting() {
    scriptOverview({ sessions: [session(5, { status: "draft" })] });
    fake.rpc("get_attendance_roster").reply(ok(roster(5)));
    const rendered = renderAttendance({ tab: "meetings" });
    await screen.findByLabelText("Attendance status for Dev Nair");
    return rendered;
  }

  it("a refusal is said on the check-in card and as an error, with the database's sentence after 'Could not open check-in:'", async () => {
    fake.rpc("open_attendance_session").reply(fail("Check-in cannot open before the meeting"));
    const { notify } = await onDraftMeeting();
    fireEvent.click(screen.getByRole("button", { name: "Open check-in" }));
    const text = "Could not open check-in: Check-in cannot open before the meeting";
    await waitFor(() => expect(notify.find(text).tone).toBe("error"));
    expect(screen.getByText(text, { selector: "p.attendance-feedback" })).toHaveClass("error");
    // Nothing opened, so nothing is read again.
    expect(rosterCalls()).toHaveLength(1);
    expect(overviewCalls()).toHaveLength(1);
  });

  it("an answer with no code says so on the card, and the overview and the roster are read again", async () => {
    fake.rpc("open_attendance_session").reply(ok([{}]));
    await onDraftMeeting();
    fireEvent.click(screen.getByRole("button", { name: "Open check-in" }));
    expect(await screen.findByText("Check-in opened, but no sign-in code was returned. Refresh and try again.", { selector: "p.attendance-feedback" })).toBeInTheDocument();
    await waitFor(() => expect(overviewCalls()).toHaveLength(2));
    expect(rosterCalls()).toHaveLength(2);
  });

  it("an answer with a code is opened for an hour, and the overview is read again", async () => {
    fake.rpc("open_attendance_session").reply(ok([{ check_in_code: "123456" }]));
    await onDraftMeeting();
    fireEvent.click(screen.getByRole("button", { name: "Open check-in" }));
    await waitFor(() => expect(overviewCalls()).toHaveLength(2));
    expect(fake.rpc("open_attendance_session").calls[0].payload).toEqual({ p_session_id: 5, p_duration_minutes: 60 });
  });
});

describe("creating a meeting", () => {
  async function openForm() {
    fireEvent.click(await screen.findByRole("button", { name: "＋ New meeting" }));
    return screen.getByRole("button", { name: "Create meeting" }).closest("form")!;
  }

  it("with check-in opened at once, the form closes, the Meetings tab shows, and the toasts come in that order", async () => {
    scriptOverview({ sessions: [session(9, { status: "open", live: live(0) })] });
    fake.rpc("create_attendance_session").reply(ok([{ id: 9 }]));
    fake.rpc("open_attendance_session").reply(ok([{ check_in_code: "654321" }]));
    fake.rpc("get_attendance_roster").reply(ok(roster(9)));
    const { notify } = renderAttendance();
    fireEvent.submit(await openForm());
    await waitFor(() => expect(notify.find("Meeting created")).toBeTruthy());
    expect(notify.messages()).toEqual(["Check-in is open", "Meeting created"]);
    expect(screen.queryByRole("button", { name: "Create meeting" })).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Meetings" })).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByText("654321")).toBeInTheDocument();
    expect(screen.getByText("Share this with members")).toBeInTheDocument();
  });

  it("without it, the form closes and the overview is read again; nothing is opened", async () => {
    scriptOverview({ sessions: [] });
    fake.rpc("create_attendance_session").reply(ok([{ id: 9 }]));
    const { notify } = renderAttendance();
    const form = await openForm();
    fireEvent.click(within(form).getByLabelText("Open check-in immediately"));
    fireEvent.submit(form);
    await waitFor(() => expect(notify.find("Meeting created")).toBeTruthy());
    expect(screen.queryByRole("button", { name: "Create meeting" })).not.toBeInTheDocument();
    await waitFor(() => expect(overviewCalls()).toHaveLength(2));
    expect(fake.rpc("open_attendance_session").count).toBe(0);
    expect(screen.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true");
  });

  it("a refusal keeps the form open, says the fallback sentence as an error, and opens and reads nothing", async () => {
    scriptOverview({ sessions: [] });
    fake.rpc("create_attendance_session").reply(fail(RAW));
    const { notify } = renderAttendance();
    fireEvent.submit(await openForm());
    await waitFor(() => expect(notify.find("The meeting could not be created.").tone).toBe("error"));
    expect(screen.getByRole("button", { name: "Create meeting" })).toBeInTheDocument();
    expect(fake.rpc("open_attendance_session").count).toBe(0);
    expect(overviewCalls()).toHaveLength(1);
  });

  it("when the meeting is created but check-in cannot open, the person is told both, and the form closes", async () => {
    scriptOverview({ sessions: [] });
    fake.rpc("create_attendance_session").reply(ok([{ id: 9 }]));
    fake.rpc("open_attendance_session").reply(fail("Check-in cannot open yet"));
    const { notify } = renderAttendance();
    fireEvent.submit(await openForm());
    await waitFor(() => expect(notify.find("Meeting created")).toBeTruthy());
    expect(notify.find("Could not open check-in: Check-in cannot open yet").tone).toBe("error");
    expect(screen.queryByRole("button", { name: "Create meeting" })).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true");
  });
});

describe("rotating the code", () => {
  it("reads the overview again; a refusal says the fallback sentence and keeps the code on screen", async () => {
    scriptOverview({ sessions: [session(3, { status: "open", live: live(4) })] });
    fake.rpc("rotate_attendance_code").replyOnce(ok([{ check_in_code: "999111" }])).reply(fail(RAW));
    const { notify } = renderAttendance();
    fireEvent.click(await screen.findByRole("button", { name: "Rotate code" }));
    expect(await screen.findByText("999111")).toBeInTheDocument();
    await waitFor(() => expect(overviewCalls()).toHaveLength(2));
    fireEvent.click(screen.getByRole("button", { name: "Rotate code" }));
    await waitFor(() => expect(notify.find("The code could not be changed.").tone).toBe("error"));
    expect(screen.getByText("999111")).toBeInTheDocument();
    expect(overviewCalls()).toHaveLength(2);
  });

  it("a new audience forgets the code shown on this device", async () => {
    scriptOverview({ sessions: [session(3, { status: "open", live: live(4) })] });
    fake.rpc("rotate_attendance_code").reply(ok([{ check_in_code: "999111" }]));
    renderAttendance();
    fireEvent.click(await screen.findByRole("button", { name: "Rotate code" }));
    await screen.findByText("999111");
    fireEvent.change(screen.getByLabelText("Filter attendance by audience"), { target: { value: "club" } });
    expect(await screen.findByText("Hidden after reload")).toBeInTheDocument();
    expect(screen.queryByText("999111")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------------------------------------------
// The dialogs
// ---------------------------------------------------------------------------------------------------------------

describe("deciding an absence form", () => {
  const withForm = () => {
    scriptOverview({ sessions: [session(1)], excuses: [excuse(4)], excuses_pending: 1, excuses_total: 1 });
    fake.rpc("review_attendance_excuse").reply(ok(null));
    return renderAttendance({ tab: "excuses" });
  };

  it("approving sends the note, closes the dialog, says 'Absence form approved' as a success, and reads the overview again", async () => {
    const { notify } = withForm();
    fireEvent.click(await screen.findByRole("button", { name: "Approve" }));
    expect(within(dialog()).getByText("Approve this absence form?")).toBeInTheDocument();
    fireEvent.change(within(dialog()).getByLabelText("Approval note (optional)"), { target: { value: "Thanks for telling us" } });
    submitIn("Approve");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(fake.rpc("review_attendance_excuse").calls[0].payload).toEqual({ p_excuse_id: 4, p_decision: "approved", p_note: "Thanks for telling us" });
    expect(notify.find("Absence form approved").tone).toBe("success");
    await waitFor(() => expect(overviewCalls()).toHaveLength(2));
  });

  it("denying needs a reason; it is sent with the decision, and the sentence says denied", async () => {
    const { notify } = withForm();
    fireEvent.click(await screen.findByRole("button", { name: "Deny" }));
    expect(within(dialog()).getByText("Deny this absence form?")).toBeInTheDocument();
    fireEvent.change(within(dialog()).getByLabelText("Why is this being denied?"), { target: { value: "No proof was given" } });
    submitIn("Deny form");
    await waitFor(() => expect(notify.find("Absence form denied")).toBeTruthy());
    expect(fake.rpc("review_attendance_excuse").calls[0].payload).toEqual({ p_excuse_id: 4, p_decision: "denied", p_note: "No proof was given" });
  });

  it("a refusal says the fallback sentence as an error and keeps the dialog", async () => {
    scriptOverview({ sessions: [session(1)], excuses: [excuse(4)], excuses_pending: 1, excuses_total: 1 });
    fake.rpc("review_attendance_excuse").reply(fail(RAW));
    const { notify } = renderAttendance({ tab: "excuses" });
    fireEvent.click(await screen.findByRole("button", { name: "Approve" }));
    submitIn("Approve");
    await waitFor(() => expect(notify.find("The form could not be reviewed.").tone).toBe("error"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});

describe("completing a follow-up item", () => {
  const item = { id: 2, session_id: 1, member_id: "u-dev", assignment: "Write a short reflection", due_at: "2026-11-01T00:00:00Z", status: "pending", note: null };
  const withItem = () => {
    scriptOverview({ sessions: [session(1)], remediations: [item], remediations_pending: 1 });
    return renderAttendance();
  };

  it("sends the instruction as edited, keeps the due date, marks it complete and says so as a success", async () => {
    fake.rpc("set_attendance_remediation").reply(ok(null));
    const { notify } = withItem();
    fireEvent.click(await screen.findByRole("button", { name: "Mark complete" }));
    expect(within(dialog()).getByLabelText("Remediation instruction")).toHaveValue("Write a short reflection");
    fireEvent.change(within(dialog()).getByLabelText("Remediation instruction"), { target: { value: "Write two pages" } });
    submitIn("Mark complete");
    await waitFor(() => expect(notify.find("Remediation updated").tone).toBe("success"));
    expect(fake.rpc("set_attendance_remediation").calls[0].payload).toEqual({ p_remediation_id: 2, p_status: "complete", p_assignment: "Write two pages", p_due_at: "2026-11-01T00:00:00Z", p_note: null });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("a refusal says the fallback sentence", async () => {
    fake.rpc("set_attendance_remediation").reply(fail(RAW));
    const { notify } = withItem();
    fireEvent.click(await screen.findByRole("button", { name: "Mark complete" }));
    submitIn("Mark complete");
    await waitFor(() => expect(notify.find("The follow-up could not be updated.").tone).toBe("error"));
  });
});

describe("changing a member's eligibility", () => {
  const flagged = (eligibility: string | null) => ({
    flagged: [{ member_id: "u-dev", present: 1, absent: 3, excused: 0, tardy: 0, club_units: 3, subgroup_units: 0, eligibility }],
  });

  it("restricting needs a reason, which is sent with the term in view; the sentence says 'Eligibility updated'", async () => {
    scriptOverview(flagged(null));
    fake.rpc("set_attendance_eligibility").reply(ok(null));
    const { notify } = renderAttendance();
    fireEvent.click(await screen.findByRole("button", { name: "Restrict" }));
    expect(within(dialog()).getByText("Restrict Dev Nair?")).toBeInTheDocument();
    fireEvent.change(within(dialog()).getByLabelText("Reason for restricting performance eligibility"), { target: { value: "Three unexcused absences" } });
    submitIn("Restrict");
    await waitFor(() => expect(notify.find("Eligibility updated").tone).toBe("success"));
    expect(fake.rpc("set_attendance_eligibility").calls[0].payload).toEqual({ p_term_key: "2026-fall", p_member_id: "u-dev", p_status: "restricted", p_reason: "Three unexcused absences" });
  });

  it("Review puts them under review with an optional note", async () => {
    scriptOverview(flagged(null));
    fake.rpc("set_attendance_eligibility").reply(ok(null));
    renderAttendance();
    fireEvent.click(await screen.findByRole("button", { name: "Review" }));
    fireEvent.change(within(dialog()).getByLabelText("Eligibility note (optional)"), { target: { value: "Talk to them first" } });
    submitIn("Mark under review");
    await waitFor(() => expect(fake.rpc("set_attendance_eligibility").count).toBe(1));
    expect(fake.rpc("set_attendance_eligibility").calls[0].payload).toEqual({ p_term_key: "2026-fall", p_member_id: "u-dev", p_status: "under_review", p_reason: "Talk to them first" });
  });

  it("a restricted member is offered Reinstate instead, and a refusal says the fallback sentence", async () => {
    scriptOverview(flagged("restricted"));
    fake.rpc("set_attendance_eligibility").reply(fail(RAW));
    const { notify } = renderAttendance();
    expect(await screen.findByRole("button", { name: "Reinstate" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Restrict" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reinstate" }));
    submitIn("Reinstate");
    await waitFor(() => expect(notify.find("Eligibility could not be updated.").tone).toBe("error"));
    expect(fake.rpc("set_attendance_eligibility").calls[0].payload).toMatchObject({ p_status: "reinstated", p_reason: "" });
  });
});

describe("a mark", () => {
  it("is said as 'Attendance updated' in the success style; a refusal says the fallback sentence", async () => {
    scriptOverview({ sessions: [session(5, { status: "draft" })] });
    fake.rpc("get_attendance_roster").reply(ok(roster(5)));
    fake.rpc("set_attendance_status").replyOnce(fail(RAW)).reply(ok(null));
    const { notify } = renderAttendance({ tab: "meetings" });
    fireEvent.change(await screen.findByLabelText("Attendance status for Dev Nair"), { target: { value: "present" } });
    submitIn("Save mark");
    await waitFor(() => expect(notify.find("The mark could not be saved.").tone).toBe("error"));
    submitIn("Save mark");
    await waitFor(() => expect(notify.find("Attendance updated").tone).toBe("success"));
  });
});

describe("closing and canceling check-in", () => {
  const open = () => scriptOverview({ sessions: [session(3, { status: "open", live: live(4) })] });

  it("closing says 'Attendance closed' as a success, and forgets the code shown on this device", async () => {
    open();
    fake.rpc("rotate_attendance_code").reply(ok([{ check_in_code: "999111" }]));
    fake.rpc("close_attendance_session").reply(ok(null));
    const { notify } = renderAttendance();
    fireEvent.click(await screen.findByRole("button", { name: "Rotate code" }));
    await screen.findByText("999111");
    fireEvent.click(screen.getByRole("button", { name: "Close attendance" }));
    confirmIn("Close attendance");
    await waitFor(() => expect(notify.find("Attendance closed").tone).toBe("success"));
    expect(await screen.findByText("Hidden after reload")).toBeInTheDocument();
    expect(screen.queryByText("999111")).not.toBeInTheDocument();
  });

  it("canceling says 'Meeting canceled'", async () => {
    open();
    fake.rpc("cancel_attendance_session").reply(ok(null));
    const { notify } = renderAttendance();
    fireEvent.click(await screen.findByRole("button", { name: "Cancel meeting" }));
    confirmIn("Cancel meeting");
    await waitFor(() => expect(notify.find("Meeting canceled").tone).toBe("success"));
  });

  it("a refusal says the fallback sentence, keeps the code and keeps the dialog", async () => {
    open();
    fake.rpc("rotate_attendance_code").reply(ok([{ check_in_code: "999111" }]));
    fake.rpc("close_attendance_session").reply(fail(RAW));
    fake.rpc("cancel_attendance_session").reply(fail(RAW));
    const { notify } = renderAttendance();
    fireEvent.click(await screen.findByRole("button", { name: "Rotate code" }));
    await screen.findByText("999111");
    fireEvent.click(screen.getByRole("button", { name: "Close attendance" }));
    confirmIn("Close attendance");
    await waitFor(() => expect(notify.find("Attendance could not be closed.").tone).toBe("error"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("999111")).toBeInTheDocument();
    confirmIn("Cancel");
    fireEvent.click(screen.getByRole("button", { name: "Cancel meeting" }));
    confirmIn("Cancel meeting");
    await waitFor(() => expect(notify.find("The meeting could not be canceled.").tone).toBe("error"));
  });
});

// ---------------------------------------------------------------------------------------------------------------
// The absence form and its proof
// ---------------------------------------------------------------------------------------------------------------

describe("the absence form", () => {
  async function fill() {
    scriptOverview({ sessions: [session(1)] });
    fake.rpc("submit_attendance_excuse").reply(ok(null));
    const rendered = renderAttendance({ role: "member" });
    fireEvent.click(await screen.findByRole("button", { name: "Submit absence form" }));
    const form = screen.getByRole("button", { name: "Submit form" }).closest("form")!;
    fireEvent.change(within(form).getByLabelText("Meeting"), { target: { value: "1" } });
    fireEvent.change(within(form).getByLabelText(/What happened/), { target: { value: "I was ill and saw a doctor" } });
    return { ...rendered, form };
  }

  it("the reason category and 'I notified an executive' are sent; the notified time is when it was sent", async () => {
    const { form, notify } = await fill();
    fireEvent.change(within(form).getByLabelText("Reason category"), { target: { value: "illness" } });
    fireEvent.click(within(form).getByLabelText("I notified an executive"));
    const before = Date.now();
    fireEvent.submit(form);
    await waitFor(() => expect(notify.find("Absence form submitted")).toBeTruthy());
    const sent = fake.rpc("submit_attendance_excuse").calls[0].payload as { p_reason_category: string; p_notified_at: string };
    expect(sent.p_reason_category).toBe("illness");
    expect(new Date(sent.p_notified_at).getTime()).toBeGreaterThanOrEqual(before);
    expect(new Date(sent.p_notified_at).getTime()).toBeLessThanOrEqual(Date.now());
  });

  it("without it no time is sent; once sent the form closes and the overview is read again", async () => {
    const { form, notify } = await fill();
    fireEvent.submit(form);
    await waitFor(() => expect(notify.find("Absence form submitted")).toBeTruthy());
    expect(fake.rpc("submit_attendance_excuse").calls[0].payload).toMatchObject({ p_notified_at: null });
    expect(screen.queryByRole("button", { name: "Submit form" })).not.toBeInTheDocument();
    await waitFor(() => expect(overviewCalls()).toHaveLength(2));
  });

  it("a refusal is shown as the database said it, and the form stays open to try again", async () => {
    const { form, notify } = await fill();
    fake.rpc("submit_attendance_excuse").reply(fail("You already submitted a form for this meeting"));
    fireEvent.submit(form);
    await waitFor(() => expect(notify.find("You already submitted a form for this meeting").tone).toBe("error"));
    expect(screen.getByRole("button", { name: "Submit form" })).toBeInTheDocument();
    expect(overviewCalls()).toHaveLength(1);
  });
});

describe("the proof of an absence form", () => {
  const withProof = () => {
    scriptOverview({ sessions: [session(1)], excuses: [excuse(4, { proof_path: "u-dev/1/abc-note.png" })], excuses_pending: 1, excuses_total: 1 });
    return renderAttendance({ tab: "excuses" });
  };

  it("opens in a new tab through a link signed for 5 minutes, with no opener", async () => {
    withProof();
    fireEvent.click(await screen.findByRole("button", { name: "View proof" }));
    await waitFor(() => expect(window.open).toHaveBeenCalledWith("https://files.test/attendance-excuses/u-dev/1/abc-note.png?signed", "_blank", "noopener,noreferrer"));
    expect(fake.storage("attendance-excuses", "createSignedUrl").calls[0].args).toEqual(["u-dev/1/abc-note.png", 300]);
  });

  it("a link that cannot be made says so as an error and opens nothing", async () => {
    fake.storage("attendance-excuses", "createSignedUrl").reply(fail("Object not found"));
    const { notify } = withProof();
    fireEvent.click(await screen.findByRole("button", { name: "View proof" }));
    await waitFor(() => expect(notify.find("Proof could not be opened").tone).toBe("error"));
    expect(window.open).not.toHaveBeenCalled();
  });

  it("a form with no proof has no button for it", async () => {
    scriptOverview({ sessions: [session(1)], excuses: [excuse(4)], excuses_pending: 1, excuses_total: 1 });
    renderAttendance({ tab: "excuses" });
    await screen.findByText("Class conflict this evening");
    expect(screen.queryByRole("button", { name: "View proof" })).not.toBeInTheDocument();
    await act(async () => {});
  });
});
