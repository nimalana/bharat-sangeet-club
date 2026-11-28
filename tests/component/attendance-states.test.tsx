// Phase 3.1 and 3.4 on the Attendance screen, the parts that are not a dialog: what a failed or slow read shows, the tabs, the check-in
// card's box and its spoken answer, the meeting list, the proof link. attendance.test.tsx pins the old sentences these keep.
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AttendancePage } from "../../features/attendance/components/attendance-page";
import { CheckInCard } from "../../features/attendance/components/check-in-card";
import { setCacheOwner } from "../../lib/cache";
import { keyboardUser } from "../support/keyboard";
import { notifySpy, userOf } from "../support/helpers";
import { deferred, fail, fake, ok, type Call } from "../support/fake-supabase";

const session = (id: number, over: Record<string, unknown> = {}) => ({
  id, scope: "club", subgroup_id: null, subgroup_name: null, title: `Meeting ${id}`, starts_at: "2026-10-01T23:00:00Z", status: "closed",
  opened_at: null, closes_at: null, closed_at: null, canceled_at: null, code_expires_at: null, created_at: "2026-09-01T00:00:00Z",
  counts_toward_metrics: true, live: null, ...over,
});
const BASE = { terms: ["2026-fall", "2026-spring"], term: "2026-fall", view_term: "2026-fall", summary_term: "2026-fall" };
const PROFILES = [{ id: "u-dev", full_name: "Dev Nair", email: "dev@x.test" }];
const excuse = (id: number, over: Record<string, unknown> = {}) => ({
  id, session_id: 1, member_id: "u-dev", reason: "Class conflict this evening", proof_path: null, reason_category: "class_exam", notified_at: null,
  status: "pending", submitted_at: "2026-10-02T00:00:00Z", reviewed_at: null, review_note: null, ...over,
});
const roster = (sessionId: number) => ({
  session_id: sessionId, version: "r1",
  rows: [{ member_id: "u-dev", full_name: "Dev Nair", email: "dev@x.test", status: null, minutes_late: null, unexcused_units: null }],
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

// ---------------------------------------------------------------------------------------------------------------
// A read that fails
// ---------------------------------------------------------------------------------------------------------------

describe("a view that cannot be read", () => {
  it("keeps the title and the pickers on screen, says so as an alert, and another audience can still be chosen", async () => {
    fake.rpc("get_attendance_overview").replyOnce(fail("boom")).reply(ok({ ...BASE, sessions: [session(1, { title: "Opening" })] }));
    renderAttendance();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Attendance could not be loaded.");
    expect(screen.getByRole("heading", { name: "Attendance" })).toBeInTheDocument();
    // Not an empty page: nothing says "no meetings" for a read that did not answer.
    expect(screen.queryByText("No meetings yet.")).not.toBeInTheDocument();
    // (The term picker has only "All terms" until a read has answered, so the audience is what can be changed.)
    fireEvent.change(screen.getByLabelText("Filter attendance by audience"), { target: { value: "club" } });
    expect(await screen.findByLabelText("Attendance code")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(fake.rpc("get_attendance_overview").calls.at(-1)?.payload).toMatchObject({ p_scope: "club" });
  });

  it("Try again shows the rows while it reads, and a double press reads once", async () => {
    const slow = deferred();
    fake.rpc("get_attendance_overview").replyOnce(fail("boom")).replyOnce(slow.reply);
    renderAttendance();
    const retry = await within(await screen.findByRole("alert")).findByRole("button", { name: "Try again" });
    fireEvent.click(retry);
    fireEvent.click(retry);
    expect(await screen.findByText("Loading attendance…")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await act(async () => { slow.resolve(ok({ ...BASE, sessions: [] })); });
    await screen.findByLabelText("Attendance code");
    expect(fake.rpc("get_attendance_overview").count).toBe(2);
  });
});

describe("a refresh that fails while the page shows data", () => {
  it("keeps what is on screen, says it may be out of date as an alert, and Try again reads again and clears it", async () => {
    fake.rpc("get_attendance_overview")
      .replyOnce(ok({ ...BASE, list_limit: 100, profiles: PROFILES, sessions: [session(1)], excuses: [excuse(1)], excuses_total: 150, excuses_pending: 1 }))
      .replyOnce(fail("boom"))
      .reply(ok({ ...BASE, list_limit: 250, profiles: PROFILES, sessions: [session(1)], excuses: [excuse(1), excuse(2)], excuses_total: 150, excuses_pending: 2 }));
    renderAttendance({ tab: "excuses" });
    fireEvent.click(await screen.findByRole("button", { name: "Show more" }));
    const banner = await screen.findByRole("alert");
    expect(banner).toHaveTextContent("Attendance could not be refreshed. What you see may be out of date.");
    // The page is still there, with the form it was showing.
    expect(screen.getByText("Class conflict this evening")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Attendance" })).toBeInTheDocument();
    fireEvent.click(within(banner).getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getAllByText("Class conflict this evening")).toHaveLength(2));
  });
});

describe("the roster that cannot be read", () => {
  it("says so as an alert; Try again shows the loading rows at once, so a double press reads once", async () => {
    const slow = deferred();
    scriptOverview({ sessions: [session(1)] });
    fake.rpc("get_attendance_roster").replyOnce(fail("boom")).replyOnce(slow.reply);
    renderAttendance({ tab: "meetings" });
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("The roster could not be loaded.");
    const retry = within(alert).getByRole("button", { name: "Try again" });
    fireEvent.click(retry);
    fireEvent.click(retry);
    expect(await screen.findByText("Loading roster…")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await act(async () => { slow.resolve(ok(roster(1))); });
    await screen.findByLabelText("Attendance status for Dev Nair");
    expect(fake.rpc("get_attendance_roster").count).toBe(2);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// The tabs
// ---------------------------------------------------------------------------------------------------------------

describe("the tabs of an executive", () => {
  async function open() {
    scriptOverview({ sessions: [session(1)], excuses: [excuse(1)], excuses_pending: 1, excuses_total: 1 });
    fake.rpc("get_attendance_roster").reply(ok(roster(1)));
    renderAttendance();
    return screen.findByRole("tablist", { name: "Attendance sections" });
  }

  it("are a tablist named for its purpose: only the open tab is a tab stop, and its panel is named after it", async () => {
    const list = await open();
    const tabs = within(list).getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent?.trim())).toEqual(["Overview", "Meetings", "Absence forms (1)"]);
    expect(tabs.map((tab) => tab.tabIndex)).toEqual([0, -1, -1]);
    expect(tabs.map((tab) => tab.getAttribute("aria-selected"))).toEqual(["true", "false", "false"]);
    const panel = screen.getByRole("tabpanel");
    expect(panel).toHaveAccessibleName("Overview");
    for (const tab of tabs) expect(tab).toHaveAttribute("aria-controls", panel.id);
  });

  it("move with the arrow keys, Home and End, and each one opens its panel and takes the focus", async () => {
    const list = await open();
    const user = keyboardUser();
    const overview = within(list).getByRole("tab", { name: "Overview" });
    overview.focus();
    await user.keyboard("{ArrowRight}");
    expect(within(list).getByRole("tab", { name: "Meetings" })).toHaveFocus();
    expect(screen.getByRole("tabpanel")).toHaveAccessibleName("Meetings");
    expect(within(list).getByRole("tab", { name: "Meetings" }).tabIndex).toBe(0);
    expect(overview.tabIndex).toBe(-1);
    await user.keyboard("{End}");
    expect(within(list).getByRole("tab", { name: /Absence forms/ })).toHaveFocus();
    expect(await screen.findByText("PRIVATE REVIEW QUEUE")).toBeInTheDocument();
    await user.keyboard("{ArrowRight}");
    expect(overview).toHaveFocus();
    await user.keyboard("{ArrowLeft}");
    expect(within(list).getByRole("tab", { name: /Absence forms/ })).toHaveFocus();
    await user.keyboard("{Home}");
    expect(overview).toHaveFocus();
    expect(screen.getByRole("tabpanel")).toHaveAccessibleName("Overview");
  });

  it("Tab leaves the tablist for the panel instead of walking through the other tabs", async () => {
    const list = await open();
    const user = keyboardUser();
    within(list).getByRole("tab", { name: "Overview" }).focus();
    await user.tab();
    expect(screen.getByRole("tabpanel").contains(document.activeElement)).toBe(true);
  });
});

describe("the meetings list", () => {
  it("marks the selected meeting for a screen reader, and the list is named", async () => {
    scriptOverview({ sessions: [session(1, { title: "Opening" }), session(2, { title: "Rehearsal" })] });
    fake.rpc("get_attendance_roster").reply(ok(roster(1)));
    renderAttendance({ tab: "meetings" });
    const list = await screen.findByRole("complementary", { name: "Meetings" });
    const [first, second] = within(list).getAllByRole("button");
    expect(first).toHaveAttribute("aria-current", "true");
    expect(second).not.toHaveAttribute("aria-current");
    fireEvent.click(second);
    await waitFor(() => expect(second).toHaveAttribute("aria-current", "true"));
    expect(first).not.toHaveAttribute("aria-current");
  });
});

// ---------------------------------------------------------------------------------------------------------------
// The check-in card
// ---------------------------------------------------------------------------------------------------------------

describe("the check-in box", () => {
  it("has a label of its own, wants digits, and points at the sentence under the heading", async () => {
    scriptOverview({ sessions: [session(1)] });
    renderAttendance({ role: "member" });
    const input = await screen.findByLabelText("Attendance code");
    expect(input.tagName).toBe("INPUT");
    expect(document.querySelector('label[for="attendance-code"]')).toHaveTextContent("Attendance code");
    expect(input).toHaveAttribute("inputmode", "numeric");
    expect(input).toHaveAttribute("autocomplete", "one-time-code");
    expect(input).toHaveAccessibleDescription(expect.stringContaining("Use the code shown by an executive while check-in is open."));
  });

  it("says the answer from one live region that is in the page before there is an answer", async () => {
    scriptOverview({ sessions: [session(1)] });
    fake.rpc("check_in_attendance").replyOnce(fail("That code has expired")).reply(ok(null));
    renderAttendance({ role: "member" });
    const input = (await screen.findByLabelText("Attendance code")) as HTMLInputElement;
    const region = document.getElementById("attendance-code-result")!;
    expect(region).toHaveAttribute("role", "status");
    expect(region).toHaveTextContent("");
    expect(region).toHaveClass("sr-only");
    expect(input).not.toHaveAttribute("aria-invalid");
    fireEvent.change(input, { target: { value: "123456" } });
    fireEvent.submit(input.closest("form")!);
    await screen.findByText("That code has expired");
    // The same element that was there before: a message put into an existing live region is spoken, a region that arrives with its text may not be.
    expect(document.getElementById("attendance-code-result")).toBe(region);
    expect(region).toHaveClass("attendance-feedback", "error");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription(expect.stringContaining("That code has expired"));
    fireEvent.submit(input.closest("form")!);
    await screen.findByText("You are checked in. Your attendance is confirmed.");
    expect(document.getElementById("attendance-code-result")).toBe(region);
    expect(region).toHaveClass("attendance-feedback", "success");
    expect(input).not.toHaveAttribute("aria-invalid");
  });

  it("gives the focus to the box when the button that was pressed turned itself off and the browser dropped the focus", () => {
    const send = () => {};
    const { rerender } = render(<CheckInCard code="123456" onCodeChange={() => {}} saving feedback="" onSubmit={send} />);
    // What Firefox and Safari do to a focused button that becomes disabled: nothing is focused any more.
    (document.activeElement as HTMLElement | null)?.blur();
    expect(document.activeElement).toBe(document.body);
    rerender(<CheckInCard code="123456" onCodeChange={() => {}} saving={false} feedback="That code has expired" onSubmit={send} />);
    expect(screen.getByLabelText("Attendance code")).toHaveFocus();
  });

  it("leaves the focus alone when it is still somewhere on the page", () => {
    const send = () => {};
    const { rerender } = render(<div><button type="button">Elsewhere</button><CheckInCard code="123456" onCodeChange={() => {}} saving feedback="" onSubmit={send} /></div>);
    screen.getByRole("button", { name: "Elsewhere" }).focus();
    rerender(<div><button type="button">Elsewhere</button><CheckInCard code="123456" onCodeChange={() => {}} saving={false} feedback="" onSubmit={send} /></div>);
    expect(screen.getByRole("button", { name: "Elsewhere" })).toHaveFocus();
  });
});

// ---------------------------------------------------------------------------------------------------------------
// The proof link
// ---------------------------------------------------------------------------------------------------------------

describe("View proof", () => {
  it("is busy while the link is made, and a second press waits: one link, one new tab", async () => {
    const slow = deferred();
    scriptOverview({ sessions: [session(1)], excuses: [excuse(1, { proof_path: "u-dev/1/proof.png" })], excuses_pending: 1, excuses_total: 1 });
    fake.storage("attendance-excuses", "createSignedUrl").reply(slow.reply);
    renderAttendance({ tab: "excuses" });
    const button = await screen.findByRole("button", { name: "View proof" });
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(button).toHaveAttribute("aria-busy", "true"));
    expect(button).toBeDisabled();
    await act(async () => { slow.resolve(ok({ signedUrl: "https://files.example/proof.png" })); });
    await waitFor(() => expect(window.open).toHaveBeenCalledTimes(1));
    expect(fake.storage("attendance-excuses", "createSignedUrl").count).toBe(1);
    expect(button).not.toHaveAttribute("aria-busy");
  });
});
