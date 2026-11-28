// What each part of the Attendance screen shows, with data in every state it can be in: the title row and its pickers, the
// check-in card, the summary figures, the live card, the three tabs, the roster, the member's own view and the two forms.
// attendance.test.tsx pins what the screen asks the server and what it does when the person acts (attendance-flows.test.tsx
// the sentences and order of those flows); this file pins the words, numbers, classes and conditions on screen, so every
// component of features/attendance/components can be moved without losing one.
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AttendancePage } from "../../features/attendance/components/attendance-page";
import { setCacheOwner } from "../../lib/cache";
import { notifySpy, userOf } from "../support/helpers";
import { deferred, fake, ok, type Call } from "../support/fake-supabase";

const session = (id: number, over: Record<string, unknown> = {}) => ({
  id, scope: "club", subgroup_id: null, subgroup_name: null, title: `Meeting ${id}`, starts_at: "2026-10-01T12:00:00Z", status: "closed",
  opened_at: null, closes_at: null, closed_at: null, canceled_at: null, code_expires_at: null, created_at: "2026-09-01T00:00:00Z",
  counts_toward_metrics: true, live: null, ...over,
});
const live = (checkedIn: number, roster = 10) => ({ roster_count: roster, checked_in_count: checkedIn, version: "v1" });
const BASE = { terms: ["2026-fall", "2026-spring"], term: "2026-fall", view_term: "2026-fall", summary_term: "2026-fall" };
const PROFILES = [
  { id: "u-dev", full_name: "Dev Nair", email: "dev@x.test" },
  { id: "u-asha", full_name: "Asha Rao", email: "asha@x.test" },
];
const GROUPS = [{ id: 7, name: "Hindustani Vocal" }];
const excuse = (id: number, over: Record<string, unknown> = {}) => ({
  id, session_id: 1, member_id: "u-dev", reason: "Class conflict this evening", proof_path: null, reason_category: "class_exam", notified_at: null,
  status: "pending", submitted_at: "2026-10-02T12:00:00Z", reviewed_at: null, review_note: null, ...over,
});
const record = (sessionId: number, status: string, over: Record<string, unknown> = {}) => ({
  session_id: sessionId, member_id: "u-me", status, source: "code", note: null, marked_at: null, minutes_late: 0, unexcused_units: 0, ...over,
});

function scriptOverview(over: Record<string, unknown> = {}) {
  fake.rpc("get_attendance_overview").reply((call: Call) => ok({ ...BASE, list_limit: (call.payload as { p_list_limit?: number }).p_list_limit ?? 100, profiles: PROFILES, ...over }));
}
function renderAttendance(options: { role?: "member" | "executive"; tab?: "overview" | "meetings" | "excuses"; scope?: "all" | "club" | number } = {}) {
  const notify = notifySpy();
  setCacheOwner("u-me");
  const view = render(<AttendancePage user={userOf("u-me")} role={options.role ?? "executive"} groups={GROUPS} initialScope={options.scope ?? "all"} initialTab={options.tab ?? "overview"} />);
  return { notify, ...view };
}
const dialog = () => screen.getByRole("dialog");
/** The figure under a label in the summary rows: its text and the class that tints it. */
const stat = (label: string) => { const box = screen.getByText(label, { selector: "small" }).parentElement!; return { value: box.querySelector("strong")!.textContent, tone: box.className }; };
const optionTexts = (select: HTMLElement) => within(select).getAllByRole("option").map((option) => option.textContent);

// ---------------------------------------------------------------------------------------------------------------
// The title row, the check-in card
// ---------------------------------------------------------------------------------------------------------------

describe("the title row", () => {
  it("offers every audience and every term the server found, in words", async () => {
    scriptOverview({ sessions: [] });
    renderAttendance();
    const audience = await screen.findByLabelText("Filter attendance by audience");
    expect(optionTexts(audience)).toEqual(["All activity", "Club-wide meetings", "Hindustani Vocal rehearsals"]);
    expect(audience).toHaveValue("all");
    expect(optionTexts(screen.getByLabelText("Filter attendance by term"))).toEqual(["All terms", "Fall 2026", "Spring 2026"]);
    expect(screen.getByRole("heading", { name: "Attendance" })).toBeInTheDocument();
  });

  it("an audience that is not one of the person's groups is still offered while it is in view, by the meeting's own group name", async () => {
    scriptOverview({ sessions: [session(1, { scope: "subgroup", subgroup_id: 99, subgroup_name: "Carnatic Violin" })] });
    renderAttendance({ scope: 99 });
    const audience = await screen.findByLabelText("Filter attendance by audience");
    expect(optionTexts(audience)).toEqual(["All activity", "Club-wide meetings", "Hindustani Vocal rehearsals", "Carnatic Violin rehearsals"]);
    expect(audience).toHaveValue("group:99");
  });

  it("choosing a group sends its number; choosing a term sends its key", async () => {
    scriptOverview({ sessions: [] });
    renderAttendance();
    fireEvent.change(await screen.findByLabelText("Filter attendance by audience"), { target: { value: "group:7" } });
    await waitFor(() => expect(fake.rpc("get_attendance_overview").calls.at(-1)!.payload).toMatchObject({ p_scope: "subgroup", p_subgroup_id: 7 }));
    fireEvent.change(await screen.findByLabelText("Filter attendance by term"), { target: { value: "2026-spring" } });
    await waitFor(() => expect(fake.rpc("get_attendance_overview").calls.at(-1)!.payload).toMatchObject({ p_term_key: "2026-spring" }));
  });

  it("only an executive gets the New meeting button", async () => {
    scriptOverview({ sessions: [] });
    const { unmount } = renderAttendance();
    expect(await screen.findByRole("button", { name: "＋ New meeting" })).toBeInTheDocument();
    unmount();
    renderAttendance({ role: "member" });
    await screen.findByLabelText("Attendance code");
    expect(screen.queryByRole("button", { name: "＋ New meeting" })).not.toBeInTheDocument();
  });
});

describe("the check-in card", () => {
  it("asks for 6 to 8 characters, and while a check-in is on its way the button says so and is off", async () => {
    const slow = deferred();
    scriptOverview({ sessions: [session(1)] });
    fake.rpc("check_in_attendance").reply(slow.reply);
    renderAttendance({ role: "member" });
    const input = await screen.findByLabelText("Attendance code");
    expect(input).toHaveAttribute("minlength", "6");
    expect(input).toHaveAttribute("maxlength", "8");
    expect(input).toBeRequired();
    fireEvent.change(input, { target: { value: "123456" } });
    fireEvent.submit(input.closest("form")!);
    expect(await screen.findByRole("button", { name: "Checking…" })).toBeDisabled();
    await act(async () => { slow.resolve(ok(null)); });
    expect(await screen.findByRole("button", { name: "Check in" })).toBeEnabled();
  });
});

// ---------------------------------------------------------------------------------------------------------------
// An executive's overview
// ---------------------------------------------------------------------------------------------------------------

const flagged = (over: Record<string, unknown>) => ({ member_id: "u-dev", present: 1, absent: 3, excused: 0, tardy: 0, club_units: 3, subgroup_units: 0, eligibility: null, ...over });

describe("the summary figures", () => {
  it("count the closed meetings that count, the attendance rate, and the members at the warning and review levels", async () => {
    scriptOverview({
      sessions: [session(1), session(2), session(3, { counts_toward_metrics: false }), session(4, { status: "open", live: live(2) }), session(5, { status: "draft" })],
      attended_total: 30, absent_total: 10,
      flagged: [flagged({}), flagged({ member_id: "u-asha", club_units: 2, present: 3, absent: 2 }), flagged({ member_id: "u-new", club_units: 2, subgroup_units: 1, present: 2, absent: 2 })],
    });
    renderAttendance();
    await screen.findByText("Closed meetings");
    expect(stat("Closed meetings").value).toBe("2");
    expect(stat("Attendance rate").value).toBe("75%");
    // Two at the warning level (2 units), one at the review level (3).
    expect(stat("At policy limit")).toEqual({ value: "2", tone: "warning" });
    expect(stat("Needs review")).toEqual({ value: "1", tone: "critical" });
    expect(stat("Closed meetings").tone).toBe("");
  });

  it("an executive's view with no marks yet reads 100%", async () => {
    scriptOverview({ sessions: [] });
    renderAttendance();
    await screen.findByText("Attendance rate");
    expect(stat("Attendance rate").value).toBe("100%");
    expect(stat("Closed meetings").value).toBe("0");
  });
});

describe("the overview tab", () => {
  it("lists the flagged members worst first, with their rate, unexcused units and eligibility, and the level each is at", async () => {
    scriptOverview({
      sessions: [session(1)],
      flagged: [
        flagged({ member_id: "u-asha", club_units: 2.25, present: 3, absent: 2, eligibility: "under_review" }),
        flagged({}),
      ],
    });
    renderAttendance();
    await screen.findByText("Members needing attention");
    const cards = document.querySelectorAll(".attendance-flags article");
    expect(cards).toHaveLength(2);
    // Dev has 3 units against Asha's 2: the worse one is first, whatever order the server sent.
    expect(cards[0]).toHaveClass("critical");
    expect(cards[0]).toHaveTextContent("Dev Nair");
    expect(cards[0]).toHaveTextContent("dev@x.test");
    expect(cards[0]).toHaveTextContent("25% attendance");
    expect(cards[0]).toHaveTextContent("3 unexcused");
    expect(cards[0].querySelector("i")).toHaveTextContent("eligible");
    expect(cards[1]).toHaveClass("warning");
    expect(cards[1]).toHaveTextContent("Asha Rao");
    expect(cards[1]).toHaveTextContent("60% attendance");
    // Units are shown to one decimal.
    expect(cards[1]).toHaveTextContent("2.3 unexcused");
    expect(cards[1].querySelector("i")).toHaveTextContent("under review");
  });

  it("says which levels are in force, from the policy settings when the server sends them", async () => {
    scriptOverview({ sessions: [session(1)], settings: { warning_absences: 3, critical_absences: 5 } });
    renderAttendance();
    expect(await screen.findByText(/At 3 · Review over 4 unexcused units/)).toBeInTheDocument();
  });

  it("with no settings the levels are 2 and 3, and with no flagged member the panel says so", async () => {
    scriptOverview({ sessions: [session(1)] });
    renderAttendance();
    expect(await screen.findByText(/At 2 · Review over 2 unexcused units/)).toBeInTheDocument();
    expect(screen.getByText("No members are currently flagged in this view.")).toBeInTheDocument();
  });

  it("lists only the open follow-up items, each under the member's name with its meeting and instruction", async () => {
    scriptOverview({
      sessions: [session(1, { title: "Opening meeting" })],
      remediations: [
        { id: 2, session_id: 1, member_id: "u-dev", assignment: "Write a short reflection", due_at: null, status: "pending", note: null },
        { id: 3, session_id: 1, member_id: "u-asha", assignment: "Already done", due_at: null, status: "complete", note: null },
        { id: 4, session_id: 77, member_id: "u-asha", assignment: "Attend the next one", due_at: null, status: "pending", note: null },
      ],
      remediations_pending: 2,
    });
    renderAttendance();
    await screen.findByText("Open follow-up");
    const items = document.querySelectorAll(".remediation-list article");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("Dev Nair");
    expect(items[0]).toHaveTextContent("Opening meeting · Write a short reflection");
    // A meeting the screen does not list is called just "Meeting".
    expect(items[1]).toHaveTextContent("Asha Rao");
    expect(items[1]).toHaveTextContent("Meeting · Attend the next one");
    expect(screen.queryByText(/Already done/)).not.toBeInTheDocument();
    expect(screen.getByText(/^2 pending ·/)).toBeInTheDocument();
  });

  it("with none open it says so", async () => {
    scriptOverview({ sessions: [session(1)] });
    renderAttendance();
    expect(await screen.findByText("No open remediation items.")).toBeInTheDocument();
  });
});

describe("the live card", () => {
  it("shows the count checked in, and the three actions", async () => {
    scriptOverview({ sessions: [session(4, { title: "Rehearsal tonight", status: "open", live: live(4, 12) })] });
    renderAttendance();
    expect(await screen.findByText("LIVE NOW")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Rehearsal tonight" })).toBeInTheDocument();
    expect(screen.getByText("4 of 12 checked in")).toBeInTheDocument();
    expect(screen.getByText("CHECK-IN CODE")).toBeInTheDocument();
    expect(screen.getByText("Rotate the code to display a new one")).toBeInTheDocument();
    for (const name of ["Rotate code", "Close attendance", "Cancel meeting"]) expect(screen.getByRole("button", { name })).toBeEnabled();
  });

  it("a meeting with no count yet reads 0 of 0, and there is no card when nothing is open", async () => {
    scriptOverview({ sessions: [session(4, { status: "open", live: null })] });
    const { unmount } = renderAttendance();
    expect(await screen.findByText("0 of 0 checked in")).toBeInTheDocument();
    unmount();
    scriptOverview({ sessions: [session(4)] });
    renderAttendance();
    await screen.findByText("Closed meetings");
    expect(screen.queryByText("LIVE NOW")).not.toBeInTheDocument();
  });

  it("while a request is on its way, the three actions are off", async () => {
    const slow = deferred();
    scriptOverview({ sessions: [session(4, { status: "open", live: live(4) })] });
    fake.rpc("rotate_attendance_code").reply(slow.reply);
    renderAttendance();
    fireEvent.click(await screen.findByRole("button", { name: "Rotate code" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Close attendance" })).toBeDisabled());
    expect(screen.getByRole("button", { name: "Rotate code" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel meeting" })).toBeDisabled();
    await act(async () => { slow.resolve(ok([{ check_in_code: "111222" }])); });
    await waitFor(() => expect(screen.getByRole("button", { name: "Rotate code" })).toBeEnabled());
  });

  it("closing asks 'Close check-in?' in the plain style, canceling asks in the danger style", async () => {
    scriptOverview({ sessions: [session(4, { status: "open", live: live(4) })] });
    renderAttendance();
    fireEvent.click(await screen.findByRole("button", { name: "Close attendance" }));
    expect(within(dialog()).getByText("Everyone still missing is marked absent.")).toBeInTheDocument();
    const closeClass = within(dialog()).getByRole("button", { name: "Close attendance" }).className;
    fireEvent.click(within(dialog()).getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel meeting" }));
    const cancelClass = within(dialog()).getByRole("button", { name: "Cancel meeting" }).className;
    expect(cancelClass).toContain("#8b2832");
    expect(closeClass).not.toContain("#8b2832");
  });
});

describe("the tabs", () => {
  it("say how many absence forms wait, and switch what is shown", async () => {
    scriptOverview({ sessions: [session(1)], excuses: [excuse(4)], excuses_pending: 3, excuses_total: 1 });
    fake.rpc("get_attendance_roster").reply(ok({ session_id: 1, version: "r1", rows: [] }));
    renderAttendance();
    const forms = await screen.findByRole("tab", { name: "Absence forms (3)" });
    expect(screen.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(screen.getByRole("tab", { name: "Meetings" }));
    expect(screen.getByRole("tab", { name: "Meetings" })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByText("Members needing attention")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Meeting 1/ })).toBeInTheDocument();
    fireEvent.click(forms);
    expect(await screen.findByText("Class conflict this evening")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Overview" }));
    expect(await screen.findByText("Members needing attention")).toBeInTheDocument();
  });

  it("with none waiting the label has no number", async () => {
    scriptOverview({ sessions: [session(1)] });
    renderAttendance();
    expect(await screen.findByRole("tab", { name: "Absence forms" })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------------------------------------------
// The Meetings tab and the roster
// ---------------------------------------------------------------------------------------------------------------

const rosterOf = (sessionId: number, rows: Array<Record<string, unknown>>) => ({ session_id: sessionId, version: "r1", rows });
const rosterRow = (id: string, name: string | null, status: string | null, over: Record<string, unknown> = {}) => ({
  member_id: id, full_name: name, email: `${id}@x.test`, status, minutes_late: null, unexcused_units: null, ...over,
});

describe("the meetings list", () => {
  it("says there are none, and asks to choose one", async () => {
    scriptOverview({ sessions: [] });
    renderAttendance({ tab: "meetings" });
    expect(await screen.findByText("No meetings yet.")).toBeInTheDocument();
    expect(screen.getByText("Choose a meeting to view its roster.")).toBeInTheDocument();
  });

  it("lists each meeting with its status, audience and time; the first is selected and a click selects another", async () => {
    scriptOverview({
      sessions: [
        session(1, { title: "Opening meeting", status: "closed" }),
        session(2, { title: "Vocal rehearsal", status: "draft", scope: "subgroup", subgroup_id: 7, subgroup_name: "Hindustani Vocal" }),
      ],
    });
    fake.rpc("get_attendance_roster").reply(ok(rosterOf(1, [])));
    renderAttendance({ tab: "meetings" });
    const first = await screen.findByRole("button", { name: /Opening meeting/ });
    expect(first).toHaveClass("active");
    expect(first).toHaveTextContent("closed");
    expect(first).toHaveTextContent(/Club-wide · Oct 1, 2026, \d+:00 [AP]M/);
    const second = screen.getByRole("button", { name: /Vocal rehearsal/ });
    expect(second).not.toHaveClass("active");
    expect(second).toHaveTextContent("draft");
    expect(second).toHaveTextContent("Hindustani Vocal rehearsal");
    fireEvent.click(second);
    await waitFor(() => expect(second).toHaveClass("active"));
    expect(first).not.toHaveClass("active");
    expect(document.querySelector(".attendance-panel-heading .eyebrow")).toHaveTextContent("DRAFT");
    expect(screen.getByRole("heading", { name: "Vocal rehearsal" })).toBeInTheDocument();
  });

  it("a draft offers Open check-in, an open meeting offers Close, a closed one neither", async () => {
    scriptOverview({ sessions: [session(1, { status: "draft" }), session(2, { status: "open", live: live(1) }), session(3, { status: "closed" })] });
    fake.rpc("get_attendance_roster").reply((call: Call) => ok(rosterOf((call.payload as { p_session_id: number }).p_session_id, [])));
    renderAttendance({ tab: "meetings" });
    expect(await screen.findByRole("button", { name: "Open check-in" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Close" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Meeting 2/ }));
    expect(await screen.findByRole("button", { name: "Close" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open check-in" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Meeting 3/ }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Close" })).not.toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Open check-in" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Void meeting" })).toBeInTheDocument();
  });

  it("the correction forms start fresh for each meeting: what was typed to void one is not carried to the next", async () => {
    scriptOverview({ sessions: [session(1), session(2)] });
    fake.rpc("get_attendance_roster").reply((call: Call) => ok(rosterOf((call.payload as { p_session_id: number }).p_session_id, [])));
    renderAttendance({ tab: "meetings" });
    fireEvent.click(await screen.findByRole("button", { name: "Void meeting" }));
    fireEvent.change(within(dialog()).getByLabelText("Reason"), { target: { value: "Created twice" } });
    fireEvent.click(within(dialog()).getByRole("button", { name: "Keep meeting" }));
    fireEvent.click(screen.getByRole("button", { name: /Meeting 2/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Meeting 2/ })).toHaveClass("active"));
    fireEvent.click(screen.getByRole("button", { name: "Void meeting" }));
    expect(within(dialog()).getByLabelText("Reason")).toHaveValue("");
  });
});

describe("the roster", () => {
  async function openRoster(rows: Array<Record<string, unknown>>, over: Record<string, unknown> = {}) {
    scriptOverview({ sessions: [session(5, { status: "closed", ...over })] });
    fake.rpc("get_attendance_roster").reply(ok(rosterOf(5, rows)));
    renderAttendance({ tab: "meetings" });
    await waitFor(() => expect(document.querySelector(".attendance-roster-row")).not.toBeNull());
  }
  const rowOf = (name: string) => screen.getByText(name, { selector: "b" }).closest(".attendance-roster-row") as HTMLElement;

  it("says what each mark costs: minutes and units for tardy, one unit for absent, remediation for excused, nothing otherwise", async () => {
    await openRoster([
      rosterRow("u-1", "Tara Late", "tardy", { minutes_late: 25, unexcused_units: 1.5 }),
      rosterRow("u-2", "Abe Absent", "absent"),
      rosterRow("u-3", "Eli Excused", "excused"),
      rosterRow("u-4", "Pia Present", "present"),
      rosterRow("u-5", "Nia Nomark", null),
    ]);
    expect(within(rowOf("Tara Late")).getByText("25 min late · 1.5 unexcused")).toBeInTheDocument();
    expect(within(rowOf("Abe Absent")).getByText("1 unexcused")).toBeInTheDocument();
    expect(within(rowOf("Eli Excused")).getByText("Remediation required")).toBeInTheDocument();
    expect(within(rowOf("Pia Present")).getByText("-")).toBeInTheDocument();
    expect(within(rowOf("Nia Nomark")).getByText("-")).toBeInTheDocument();
  });

  it("shows each status in its own badge, the person's mark in the picker, and a pending one that cannot be picked", async () => {
    await openRoster([rosterRow("u-1", "Tara Late", "tardy"), rosterRow("u-5", "Nia Nomark", null)]);
    expect(rowOf("Tara Late").querySelector(".attendance-status")).toHaveClass("tardy");
    expect(rowOf("Nia Nomark").querySelector(".attendance-status")).toHaveClass("pending");
    expect(rowOf("Nia Nomark").querySelector(".attendance-status")).toHaveTextContent("pending");
    expect(screen.getByLabelText("Attendance status for Tara Late")).toHaveValue("tardy");
    const none = screen.getByLabelText("Attendance status for Nia Nomark");
    expect(none).toHaveValue("pending");
    expect(within(none).getByRole("option", { name: "Pending" })).toBeDisabled();
    expect(optionTexts(none)).toEqual(["Pending", "Present", "Tardy", "Absent", "Excused"]);
  });

  it("offers Clear only for a member who has a mark, and not on a meeting that was canceled", async () => {
    await openRoster([rosterRow("u-1", "Pia Present", "present"), rosterRow("u-5", "Nia Nomark", null)]);
    expect(screen.getByRole("button", { name: "Clear attendance mark for Pia Present" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Clear attendance mark for Nia Nomark" })).not.toBeInTheDocument();
  });

  it("a canceled meeting has no Clear at all", async () => {
    await openRoster([rosterRow("u-1", "Pia Present", "present")], { status: "canceled" });
    expect(screen.queryByRole("button", { name: /Clear attendance mark/ })).not.toBeInTheDocument();
  });

  it("names a member by name, else by email, and calls one with neither 'Member'", async () => {
    await openRoster([rosterRow("u-1", null, "present"), rosterRow("u-2", "Pia Present", "present", { email: null })]);
    expect(screen.getByLabelText("Attendance status for u-1@x.test")).toBeInTheDocument();
    expect(screen.getByText("Pia Present", { selector: "b" })).toBeInTheDocument();
    expect(screen.getByLabelText("Attendance status for Pia Present")).toBeInTheDocument();
  });

  it("never shows another meeting's roster while this one's is on its way", async () => {
    const slow = deferred();
    scriptOverview({ sessions: [session(1), session(2)] });
    fake.rpc("get_attendance_roster").replyOnce(ok(rosterOf(1, [rosterRow("u-1", "Pia Present", "present")]))).reply(slow.reply);
    renderAttendance({ tab: "meetings" });
    await screen.findByText("Pia Present", { selector: "b" });
    fireEvent.click(screen.getByRole("button", { name: /Meeting 2/ }));
    expect(await screen.findByText("Loading roster…")).toBeInTheDocument();
    expect(screen.queryByText("Pia Present", { selector: "b" })).not.toBeInTheDocument();
    await act(async () => { slow.resolve(ok(rosterOf(2, [rosterRow("u-2", "Tara Late", "present")]))); });
    expect(await screen.findByText("Tara Late", { selector: "b" })).toBeInTheDocument();
  });

  it("while a change is on its way the pickers are off", async () => {
    const slow = deferred();
    scriptOverview({ sessions: [session(5, { status: "draft" })] });
    fake.rpc("get_attendance_roster").reply(ok(rosterOf(5, [rosterRow("u-1", "Pia Present", null)])));
    fake.rpc("set_attendance_status").reply(slow.reply);
    renderAttendance({ tab: "meetings" });
    fireEvent.change(await screen.findByLabelText("Attendance status for Pia Present"), { target: { value: "present" } });
    fireEvent.submit(within(dialog()).getByRole("button", { name: "Save mark" }).closest("form")!);
    await waitFor(() => expect(screen.getByLabelText("Attendance status for Pia Present")).toBeDisabled());
    await act(async () => { slow.resolve(ok(null)); });
    await waitFor(() => expect(screen.getByLabelText("Attendance status for Pia Present")).toBeEnabled());
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Absence forms (executive)
// ---------------------------------------------------------------------------------------------------------------

describe("the absence forms tab", () => {
  it("shows each form with who, which meeting and when, the category, the reason and whether an executive was told", async () => {
    scriptOverview({
      sessions: [session(1, { title: "Opening meeting" })],
      excuses: [
        excuse(4, { reason_category: "illness", notified_at: "2026-10-01T10:00:00Z" }),
        excuse(5, { member_id: "u-asha", status: "approved", reviewed_at: "2026-10-03T12:00:00Z", review_note: "Fine, thank you", reason: "Family event" }),
        excuse(6, { session_id: 77, reason: "Lost the bus" }),
      ],
      excuses_pending: 2, excuses_total: 3,
    });
    renderAttendance({ tab: "excuses" });
    await screen.findByText("Class conflict this evening");
    const items = document.querySelectorAll(".excuse-list article");
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent("pending");
    expect(items[0]).toHaveTextContent("Dev Nair");
    expect(items[0]).toHaveTextContent(/Opening meeting · Oct 1, 2026, \d+:00 [AP]M · Illness/);
    expect(items[0]).toHaveTextContent(/Executive notified Oct 1, 2026, \d+:00 [AP]M/);
    expect(items[1]).toHaveTextContent("approved");
    expect(items[1]).toHaveTextContent("Asha Rao");
    expect(items[1]).toHaveTextContent("Class or exam conflict");
    expect(items[1]).toHaveTextContent("No notification time recorded");
    expect(items[1]).toHaveTextContent("Executive note: Fine, thank you");
    // A meeting the screen does not list reads "Meeting" where the time would be.
    expect(items[2]).toHaveTextContent("· Meeting ·");
    expect(screen.getByText(/^2 awaiting review ·/)).toBeInTheDocument();
  });

  it("only a waiting form can be approved or denied; only one with proof has a View proof button", async () => {
    scriptOverview({
      sessions: [session(1)],
      excuses: [excuse(4, { proof_path: "u-dev/1/a.png" }), excuse(5, { status: "denied", member_id: "u-asha" })],
      excuses_pending: 1, excuses_total: 2,
    });
    renderAttendance({ tab: "excuses" });
    await screen.findAllByText("Class conflict this evening");
    const items = document.querySelectorAll(".excuse-list article");
    expect(within(items[0] as HTMLElement).getByRole("button", { name: "Approve" })).toBeInTheDocument();
    expect(within(items[0] as HTMLElement).getByRole("button", { name: "Deny" })).toBeInTheDocument();
    expect(within(items[0] as HTMLElement).getByRole("button", { name: "View proof" })).toBeInTheDocument();
    expect(within(items[1] as HTMLElement).queryByRole("button")).not.toBeInTheDocument();
  });

  it("with none it says so", async () => {
    scriptOverview({ sessions: [session(1)] });
    renderAttendance({ tab: "excuses" });
    expect(await screen.findByText("No absence forms have been submitted.")).toBeInTheDocument();
  });
});

describe("Show more", () => {
  it("while the larger list is read, the button says Loading… and is off", async () => {
    const slow = deferred();
    fake.rpc("get_attendance_overview").replyOnce((call: Call) => ok({ ...BASE, profiles: PROFILES, sessions: [session(1)], excuses: [excuse(4)], excuses_pending: 1, excuses_total: 150, list_limit: (call.payload as { p_list_limit: number }).p_list_limit }))
      .reply(slow.reply);
    renderAttendance({ tab: "excuses" });
    fireEvent.click(await screen.findByRole("button", { name: "Show more" }));
    const busy = await screen.findByRole("button", { name: "Loading…" });
    expect(busy).toBeDisabled();
    await act(async () => { slow.resolve(ok({ ...BASE, profiles: PROFILES, sessions: [session(1)], excuses: [excuse(4)], excuses_pending: 1, excuses_total: 150, list_limit: 250 })); });
    await waitFor(() => expect(screen.queryByRole("button", { name: "Loading…" })).not.toBeInTheDocument());
  });
});

// ---------------------------------------------------------------------------------------------------------------
// A member
// ---------------------------------------------------------------------------------------------------------------

describe("what a member sees", () => {
  it("counts their marks, tinting Absent from two", async () => {
    scriptOverview({ sessions: [session(1), session(2), session(3), session(4)], records: [record(1, "present"), record(2, "tardy", { minutes_late: 5 }), record(3, "absent"), record(4, "absent")] });
    renderAttendance({ role: "member" });
    await screen.findByText("Meeting attendance");
    expect(stat("Present")).toEqual({ value: "1", tone: "" });
    expect(stat("Excused").value).toBe("0");
    expect(stat("Tardy").value).toBe("1");
    expect(stat("Absent")).toEqual({ value: "2", tone: "warning" });
  });

  it("one absence is not tinted", async () => {
    scriptOverview({ sessions: [session(1)], records: [record(1, "absent")] });
    renderAttendance({ role: "member" });
    await screen.findByText("Meeting attendance");
    expect(stat("Absent")).toEqual({ value: "1", tone: "" });
  });

  it("lists the meetings that are not drafts, each with the member's mark (and minutes late), else the meeting's own status", async () => {
    scriptOverview({
      sessions: [session(1, { title: "Opening" }), session(2, { title: "Rehearsal" }), session(3, { title: "Not yet", status: "draft" }), session(4, { title: "Next week", status: "open", live: live(1) })],
      records: [record(1, "present"), record(2, "tardy", { minutes_late: 25 })],
    });
    renderAttendance({ role: "member" });
    await screen.findByText("Meeting attendance");
    const items = document.querySelectorAll(".member-history article");
    expect(items).toHaveLength(3);
    expect(items[0].querySelector(".attendance-status")).toHaveClass("present");
    expect(items[0].querySelector(".attendance-status")).toHaveTextContent("present");
    expect(items[1].querySelector(".attendance-status")).toHaveTextContent("tardy · 25m");
    expect(items[2].querySelector(".attendance-status")).toHaveTextContent("open");
    expect(screen.queryByText("Not yet")).not.toBeInTheDocument();
  });

  it("says when there is no meeting to list", async () => {
    scriptOverview({ sessions: [] });
    renderAttendance({ role: "member" });
    expect(await screen.findByText("No meetings are available for this view.")).toBeInTheDocument();
  });

  it("tells them when they are under review or restricted, with the reason; an eligible member sees no notice", async () => {
    scriptOverview({ sessions: [session(1)], eligibility: [{ term_key: "2026-fall", member_id: "u-me", status: "under_review", reason: "Too many absences" }] });
    const { unmount } = renderAttendance({ role: "member" });
    const notice = await screen.findByText("Performance eligibility: under review");
    expect(notice.closest(".attendance-eligibility-notice")).toHaveClass("under_review");
    expect(screen.getByText("Too many absences")).toBeInTheDocument();
    unmount();
    scriptOverview({ sessions: [session(1)], eligibility: [{ term_key: "2026-fall", member_id: "u-me", status: "eligible", reason: null }] });
    renderAttendance({ role: "member" });
    await screen.findByText("Meeting attendance");
    expect(screen.queryByText(/Performance eligibility/)).not.toBeInTheDocument();
  });

  it("can submit an absence form while some meeting is not canceled, and not otherwise", async () => {
    scriptOverview({ sessions: [session(1, { status: "canceled" })] });
    const { unmount } = renderAttendance({ role: "member" });
    expect(await screen.findByRole("button", { name: "Submit absence form" })).toBeDisabled();
    unmount();
    scriptOverview({ sessions: [session(1, { status: "canceled" }), session(2)] });
    renderAttendance({ role: "member" });
    await waitFor(() => expect(screen.getByRole("button", { name: "Submit absence form" })).toBeEnabled());
  });

  it("lists their forms with the meeting and the day sent, and lets them withdraw only their own waiting one", async () => {
    scriptOverview({
      sessions: [session(1, { title: "Opening" })],
      excuses: [excuse(4, { member_id: "u-me" }), excuse(5, { member_id: "u-me", status: "approved" }), excuse(6, { member_id: "u-other" })],
    });
    renderAttendance({ role: "member" });
    await screen.findByText("ABSENCE SUPPORT");
    const forms = document.querySelectorAll(".member-excuses article");
    expect(forms).toHaveLength(3);
    expect(forms[0]).toHaveTextContent("Opening");
    expect(forms[0]).toHaveTextContent("Oct 2, 2026");
    expect(within(forms[0] as HTMLElement).getByRole("button", { name: "Withdraw" })).toBeInTheDocument();
    expect(within(forms[1] as HTMLElement).queryByRole("button")).not.toBeInTheDocument();
    expect(within(forms[2] as HTMLElement).queryByRole("button")).not.toBeInTheDocument();
  });

  it("lists their follow-up items with their status", async () => {
    scriptOverview({
      sessions: [session(1)],
      remediations: [{ id: 2, session_id: 1, member_id: "u-me", assignment: "Write a short reflection", due_at: null, status: "pending", note: null }],
    });
    const { unmount } = renderAttendance({ role: "member" });
    expect(await screen.findByRole("heading", { name: "Remediation" })).toBeInTheDocument();
    expect(screen.getByText("Write a short reflection")).toBeInTheDocument();
    expect(screen.getByText("pending", { selector: "b" })).toHaveClass("pending");
    unmount();
    scriptOverview({ sessions: [session(1)] });
    renderAttendance({ role: "member" });
    await screen.findByText("Meeting attendance");
    expect(screen.queryByRole("heading", { name: "Remediation" })).not.toBeInTheDocument();
  });

  it("the view panel says which audience and term the history is for", async () => {
    scriptOverview({ sessions: [session(1)] });
    renderAttendance({ role: "member", scope: "club" });
    expect(await screen.findByText("Club-wide · All terms")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------------------------------------------
// The two forms
// ---------------------------------------------------------------------------------------------------------------

describe("the new meeting form", () => {
  async function open(scope?: "all" | "club" | number) {
    scriptOverview({ sessions: [] });
    renderAttendance({ scope });
    fireEvent.click(await screen.findByRole("button", { name: "＋ New meeting" }));
    return screen.getByRole("button", { name: "Create meeting" }).closest("form")!;
  }

  it("starts as a club-wide meeting for an hour with check-in opened at once, and offers each group", async () => {
    const form = await open();
    expect(within(form).getByLabelText("Audience")).toHaveValue("club");
    expect(optionTexts(within(form).getByLabelText("Audience"))).toEqual(["Club-wide · General Body Meeting", "Hindustani Vocal · Subgroup rehearsal"]);
    expect(within(form).getByLabelText("Code duration")).toHaveValue("60");
    expect(optionTexts(within(form).getByLabelText("Code duration"))).toEqual(["15 minutes", "30 minutes", "1 hour", "2 hours"]);
    expect(within(form).getByLabelText("Open check-in immediately")).toBeChecked();
    expect((within(form).getByLabelText("Meeting date and time") as HTMLInputElement).value).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d$/);
  });

  it("with a group in view it starts as that group's rehearsal", async () => {
    const form = await open(7);
    expect(within(form).getByLabelText("Audience")).toHaveValue("subgroup:7");
  });

  it("with a group the person does not belong to in view it starts club-wide", async () => {
    const form = await open(99);
    expect(within(form).getByLabelText("Audience")).toHaveValue("club");
  });

  it("the × closes it, and while the meeting is created the button says so and is off", async () => {
    const slow = deferred();
    fake.rpc("create_attendance_session").reply(slow.reply);
    const form = await open();
    fireEvent.click(within(form).getByLabelText("Open check-in immediately"));
    fireEvent.submit(form);
    expect(await screen.findByRole("button", { name: "Creating…" })).toBeDisabled();
    await act(async () => { slow.resolve(ok([{ id: 9 }])); });
    await waitFor(() => expect(screen.queryByRole("button", { name: /Creating…|Create meeting/ })).not.toBeInTheDocument());
    fireEvent.click(await screen.findByRole("button", { name: "＋ New meeting" }));
    fireEvent.click(screen.getByRole("button", { name: "Close the new meeting form" }));
    expect(screen.queryByRole("button", { name: "Create meeting" })).not.toBeInTheDocument();
    expect(fake.rpc("create_attendance_session").count).toBe(1);
  });
});

describe("the absence form", () => {
  async function open(sessions: unknown[]) {
    scriptOverview({ sessions });
    renderAttendance({ role: "member" });
    fireEvent.click(await screen.findByRole("button", { name: "Submit absence form" }));
    return screen.getByRole("button", { name: "Submit form" }).closest("form")!;
  }

  it("lists the meetings that were not canceled, asks for a reason of at least 10 characters, and offers every category", async () => {
    const form = await open([session(1, { title: "Opening" }), session(2, { title: "Called off", status: "canceled" }), session(3, { title: "Rehearsal" })]);
    expect(optionTexts(within(form).getByLabelText("Meeting")).map((text) => text?.split(" · ")[0])).toEqual(["Choose a meeting", "Opening", "Rehearsal"]);
    expect(within(form).getByLabelText("Meeting")).toHaveValue("");
    expect(within(form).getByLabelText(/What happened/)).toHaveAttribute("minlength", "10");
    expect(within(form).getByLabelText(/What happened/)).toHaveAttribute("maxlength", "3000");
    expect(optionTexts(within(form).getByLabelText("Reason category"))).toEqual(["Class or exam conflict", "Family emergency", "Illness", "Other club meeting or event", "Other"]);
    expect(within(form).getByLabelText("Reason category")).toHaveValue("other");
    expect(within(form).getByLabelText("I notified an executive")).not.toBeChecked();
  });

  it("the × closes it; while it is sent the button says so and is off", async () => {
    const slow = deferred();
    fake.rpc("submit_attendance_excuse").reply(slow.reply);
    await open([session(1)]);
    fireEvent.click(within(dialog()).getByRole("button", { name: "Close the absence form" }));
    expect(screen.queryByRole("button", { name: "Submit form" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Submit absence form" }));
    const again = screen.getByRole("button", { name: "Submit form" }).closest("form")!;
    fireEvent.change(within(again).getByLabelText("Meeting"), { target: { value: "1" } });
    fireEvent.change(within(again).getByLabelText(/What happened/), { target: { value: "I was ill and saw a doctor" } });
    fireEvent.submit(again);
    expect(await screen.findByRole("button", { name: "Submitting…" })).toBeDisabled();
    await act(async () => { slow.resolve(ok(null)); });
    await waitFor(() => expect(screen.queryByRole("button", { name: "Submitting…" })).not.toBeInTheDocument());
  });
});
