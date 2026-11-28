// Phase 3.3 on the Attendance screen: an executive opens one member's attendance summary from the roster or from the list of members
// needing attention (counts, rate, eligibility, every meeting with its mark, for the meetings in view); a member's own page shows the
// same figures with the rate added. The overview sends an executive no marks, so the dialog reads that one member's marks when it
// opens (attendance_records and attendance_eligibility, which an executive may select).
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AttendancePage } from "../../features/attendance/components/attendance-page";
import type { ClubRole } from "../../features/attendance/model";
import { setCacheOwner } from "../../lib/cache";
import { expectNoSeriousViolations } from "../support/a11y";
import { focusedName, keyboardUser, tabOrder } from "../support/keyboard";
import { notifySpy, userOf } from "../support/helpers";
import { deferred, fail, fake, ok, type Call } from "../support/fake-supabase";

const session = (id: number, over: Record<string, unknown> = {}) => ({
  id, scope: "club", subgroup_id: null, subgroup_name: null, title: `Meeting ${id}`, starts_at: "2026-10-01T23:00:00Z", status: "closed",
  opened_at: null, closes_at: null, closed_at: null, canceled_at: null, code_expires_at: null, created_at: "2026-09-01T00:00:00Z",
  counts_toward_metrics: true, live: null, ...over,
});
const BASE = { terms: ["2026-fall"], term: "2026-fall", view_term: "2026-fall", summary_term: "2026-fall" };
const PROFILES = [{ id: "u-dev", full_name: "Dev Nair", email: "dev@x.test" }, { id: "u-asha", full_name: "Asha Rao", email: "asha@x.test" }];
const SESSIONS = [session(1), session(2), session(3), session(4, { status: "draft" })];
const mark = (session_id: number, status: string, over: Record<string, unknown> = {}) => ({ session_id, status, minutes_late: 0, unexcused_units: 0, marked_at: "2026-10-01T23:30:00Z", ...over });
const DEV_MARKS = [mark(1, "present"), mark(2, "tardy", { minutes_late: 12 }), mark(3, "absent", { unexcused_units: 1 })];
const rosterOf = (sessionId: number) => ({
  session_id: sessionId, version: "r1",
  rows: [
    { member_id: "u-dev", full_name: "Dev Nair", email: "dev@x.test", status: "present", minutes_late: null, unexcused_units: null },
    { member_id: "u-asha", full_name: "Asha Rao", email: "asha@x.test", status: null, minutes_late: null, unexcused_units: null },
  ],
});
const FLAGGED = [{ member_id: "u-dev", present: 1, absent: 3, excused: 0, tardy: 0, club_units: 3, subgroup_units: 0, eligibility: null }];

function script(over: Record<string, unknown> = {}) {
  fake.rpc("get_attendance_overview").reply((call: Call) => ok({ ...BASE, list_limit: (call.payload as { p_list_limit?: number }).p_list_limit ?? 100, profiles: PROFILES, sessions: SESSIONS, ...over }));
  fake.rpc("get_attendance_roster").reply((call: Call) => ok(rosterOf((call.payload as { p_session_id: number }).p_session_id)));
}
function render_(options: { role?: ClubRole; tab?: "overview" | "meetings" | "excuses" } = {}) {
  const notify = notifySpy();
  setCacheOwner("u-me");
  const role: ClubRole = options.role ?? "executive";
  const view = render(<AttendancePage user={userOf("u-me")} role={role} groups={[{ id: 7, name: "Hindustani Vocal" }]} initialScope="all" initialTab={options.tab ?? "meetings"} />);
  return { notify, ...view };
}
const nameButton = (name: string) => screen.findByRole("button", { name: `Attendance summary for ${name}` });
const dialog = () => screen.getByRole("dialog");
const recordReads = () => fake.from("attendance_records", "select").calls;

describe("opening a member's summary", () => {
  it("from the roster: the name is a button; the dialog is named by the member, says which view, and reads that member's marks", async () => {
    script();
    fake.from("attendance_records", "select").reply(ok(DEV_MARKS));
    fake.from("attendance_eligibility", "select").reply(ok({ term_key: "2026-fall", status: "under_review", reason: "Three unexcused absences" }));
    render_();
    const opener = await nameButton("Dev Nair");
    opener.focus();
    fireEvent.click(opener);
    const box = within(await screen.findByRole("dialog", { name: "Dev Nair" }));
    // The overview sent no marks, so this member's were asked for, for the meetings of this view.
    await waitFor(() => expect(recordReads()).toHaveLength(1));
    expect(recordReads()[0].uses("eq")).toEqual([["member_id", "u-dev"]]);
    expect(recordReads()[0].uses("in")).toEqual([["session_id", [1, 2, 3, 4]]]);
    expect(fake.from("attendance_eligibility", "select").calls[0].uses("eq")).toEqual([["member_id", "u-dev"], ["term_key", "2026-fall"]]);
    // The figures: one present, one tardy, no excused, one absent; 2 of 3 counted marks attended.
    const stat = (label: string) => box.getByText(label, { selector: "small" }).nextElementSibling;
    await waitFor(() => expect(stat("Present")).toHaveTextContent("1"));
    expect(stat("Tardy")).toHaveTextContent("1");
    expect(stat("Excused")).toHaveTextContent("0");
    expect(stat("Absent")).toHaveTextContent("1");
    expect(stat("Rate")).toHaveTextContent("67%");
    // Eligibility, and every meeting that has begun with its mark (the draft is not listed).
    expect(box.getByText(/Performance eligibility · Fall 2026:/).parentElement).toHaveTextContent("under review (Three unexcused absences)");
    const history = within(dialog().querySelector(".member-history") as HTMLElement);
    expect(history.getAllByRole("article").map((row) => row.textContent)).toEqual([
      expect.stringContaining("Meeting 1"), expect.stringContaining("Meeting 2"), expect.stringContaining("Meeting 3"),
    ]);
    expect(history.getByText("present")).toBeInTheDocument();
    expect(history.getByText("tardy · 12m")).toBeInTheDocument();
    expect(history.getByText("absent")).toBeInTheDocument();
    expect(dialog()).toHaveAccessibleDescription("dev@x.test · All activity · All terms");
    // Close returns the focus to the name that opened it.
    fireEvent.click(box.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(document.activeElement).toBe(opener);
  });

  it("from the list of members needing attention on the Overview", async () => {
    script({ flagged: FLAGGED });
    fake.from("attendance_records", "select").reply(ok(DEV_MARKS));
    fake.from("attendance_eligibility", "select").reply(ok(null));
    render_({ tab: "overview" });
    fireEvent.click(await nameButton("Dev Nair"));
    const box = within(await screen.findByRole("dialog", { name: "Dev Nair" }));
    expect(await box.findByText("Meeting 1")).toBeInTheDocument();
    // No eligibility row means eligible.
    expect(box.getByText(/Performance eligibility/).parentElement).toHaveTextContent("eligible");
  });

  it("names nothing about a member the page does not know: another member's summary reads that member", async () => {
    script();
    fake.from("attendance_records", "select").reply(ok([]));
    fake.from("attendance_eligibility", "select").reply(ok(null));
    render_();
    fireEvent.click(await nameButton("Asha Rao"));
    await screen.findByRole("dialog", { name: "Asha Rao" });
    await waitFor(() => expect(recordReads()[0].uses("eq")).toEqual([["member_id", "u-asha"]]));
    // No marks: the meetings are listed with their own status, and the rate says there is none yet rather than 100%.
    const box = within(dialog());
    expect(await box.findByText("None yet")).toBeInTheDocument();
    expect(within(dialog().querySelector(".member-history") as HTMLElement).getAllByText("closed")).toHaveLength(3);
  });

  it("shows rows while the marks are read, and an error with Try again when they cannot be", async () => {
    script();
    const slow = deferred();
    fake.from("attendance_records", "select").replyOnce(slow.reply).replyOnce(fail("permission denied for table attendance_records")).reply(ok(DEV_MARKS));
    fake.from("attendance_eligibility", "select").reply(ok(null));
    render_();
    fireEvent.click(await nameButton("Dev Nair"));
    const box = within(await screen.findByRole("dialog", { name: "Dev Nair" }));
    expect(dialog().querySelectorAll(".skeleton-row").length).toBeGreaterThan(0);
    expect(box.getByRole("status")).toHaveTextContent("Loading attendance summary…");
    expect(box.queryByText("Present")).not.toBeInTheDocument();
    await act(async () => { slow.resolve(fail("boom")); });
    // A failed read is an alert with Try again, not an empty summary.
    const alert = await box.findByRole("alert");
    expect(alert).toHaveTextContent("The attendance summary could not be loaded.");
    expect(box.queryByText("Present")).not.toBeInTheDocument();
    fireEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    // (the second scripted answer is an error too: it says so again; the third is good)
    const again = await box.findByRole("alert");
    fireEvent.click(within(again).getByRole("button", { name: "Try again" }));
    expect(await box.findByText("Present", { selector: "small" })).toBeInTheDocument();
    expect(box.queryByRole("alert")).not.toBeInTheDocument();
    expect(recordReads()).toHaveLength(3);
  });

  it("each opening reads afresh: a mark changed in between is not hidden behind an earlier summary", async () => {
    script();
    fake.from("attendance_records", "select").replyOnce(ok([mark(1, "present")])).reply(ok([mark(1, "absent")]));
    fake.from("attendance_eligibility", "select").reply(ok(null));
    render_();
    fireEvent.click(await nameButton("Dev Nair"));
    await within(await screen.findByRole("dialog", { name: "Dev Nair" })).findByText("Present", { selector: "small" });
    fireEvent.click(within(dialog()).getByRole("button", { name: "Close" }));
    fireEvent.click(await nameButton("Dev Nair"));
    // The second opening starts from rows again (not from the first answer), and then shows the new marks.
    expect(dialog().querySelectorAll(".skeleton-row").length).toBeGreaterThan(0);
    const box = within(dialog());
    await waitFor(() => expect(box.getByText("Absent", { selector: "small" }).nextElementSibling).toHaveTextContent("1"));
    expect(recordReads()).toHaveLength(2);
  });

  it("another view (Back, a link) closes it: its meetings are of the view that was left", async () => {
    script();
    fake.from("attendance_records", "select").reply(ok(DEV_MARKS));
    fake.from("attendance_eligibility", "select").reply(ok(null));
    render_();
    fireEvent.click(await nameButton("Dev Nair"));
    await screen.findByRole("dialog", { name: "Dev Nair" });
    await act(async () => { window.history.pushState({}, "", "/?page=attendance&scope=club"); window.dispatchEvent(new PopStateEvent("popstate")); });
    await waitFor(() => expect(fake.rpc("get_attendance_overview").calls.at(-1)?.payload).toMatchObject({ p_scope: "club" }));
    await screen.findByRole("tab", { name: "Meetings" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("the keyboard", () => {
  it("Enter on the name opens it, Tab stays inside, Escape closes it and the focus goes back to the name", async () => {
    script();
    fake.from("attendance_records", "select").reply(ok(DEV_MARKS));
    fake.from("attendance_eligibility", "select").reply(ok(null));
    render_();
    const user = keyboardUser();
    const opener = await nameButton("Dev Nair");
    opener.focus();
    await user.keyboard("{Enter}");
    await screen.findByRole("dialog", { name: "Dev Nair" });
    await within(dialog()).findByText("Present", { selector: "small" });
    expect(focusedName()).toBe("Close the attendance summary");
    // The trap wraps over the two controls the dialog has.
    expect(await tabOrder(user, 3)).toEqual(["Close", "Close the attendance summary", "Close"]);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(document.activeElement).toBe(opener);
  });
});

describe("a member's own page", () => {
  it("has the member's figures with the rate added, and no name is a button (a member has no summary of others)", async () => {
    script({ records: [mark(1, "present", { member_id: "u-me" }), mark(2, "absent", { member_id: "u-me" }), mark(3, "present", { member_id: "u-me" })], profiles: [] });
    render_({ role: "member", tab: "overview" });
    const rate = await screen.findByText("Attendance rate", { selector: "small" });
    expect(rate.nextElementSibling).toHaveTextContent("67%");
    expect(screen.getByText("Present", { selector: "small" }).nextElementSibling).toHaveTextContent("2");
    expect(screen.queryByRole("button", { name: /Attendance summary for/ })).not.toBeInTheDocument();
    const history = screen.getByText("Meeting attendance").closest(".attendance-panel") as HTMLElement;
    expect(within(history).getAllByRole("article")).toHaveLength(3);
  });

  it("says there is no rate yet instead of 100% when no counted meeting has a mark", async () => {
    script({ records: [], profiles: [], sessions: [session(1, { status: "open" })] });
    render_({ role: "member", tab: "overview" });
    const rate = await screen.findByText("Attendance rate", { selector: "small" });
    expect(rate.nextElementSibling).toHaveTextContent("None yet");
  });
});

describe("the summary passes axe", () => {
  it("while it reads, when it cannot read, and with the summary", async () => {
    script();
    const slow = deferred();
    fake.from("attendance_records", "select").replyOnce(slow.reply).replyOnce(ok(DEV_MARKS));
    fake.from("attendance_eligibility", "select").reply(ok({ term_key: "2026-fall", status: "restricted", reason: "Too many absences" }));
    const view = render_();
    fireEvent.click(await nameButton("Dev Nair"));
    await screen.findByRole("dialog", { name: "Dev Nair" });
    await expectNoSeriousViolations(view.container);
    await act(async () => { slow.resolve(fail("boom")); });
    await within(dialog()).findByRole("alert");
    await expectNoSeriousViolations(view.container);
    fireEvent.click(within(dialog()).getByRole("button", { name: "Try again" }));
    await within(dialog()).findByText("Present", { selector: "small" });
    await expectNoSeriousViolations(view.container);
  });

  it("the member's page with the rate", async () => {
    script({ records: [mark(1, "present", { member_id: "u-me" })], profiles: [] });
    const view = render_({ role: "member", tab: "overview" });
    await screen.findByText("Attendance rate", { selector: "small" });
    await expectNoSeriousViolations(view.container);
  });
});
