// What the attendance screen reads and keeps: the last data of each audience and term (shown at once on a later visit),
// which meeting stays selected through a reload, when the roster is read and what its failure looks like, and the parts of the
// poll that attendance.test.tsx leaves open. features/attendance/hooks/use-attendance-data.ts and use-attendance-poll.ts own
// all of it; these tests pin it from the screen so the hooks can move.
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AttendancePage } from "../../features/attendance/components/attendance-page";
import { readCache, setCacheOwner } from "../../lib/cache";
import { advance, notifySpy, userOf } from "../support/helpers";
import { deferred, fail, fake, ok, rejects, type Call } from "../support/fake-supabase";

const session = (id: number, over: Record<string, unknown> = {}) => ({
  id, scope: "club", subgroup_id: null, subgroup_name: null, title: `Meeting ${id}`, starts_at: "2026-10-01T12:00:00Z", status: "closed",
  opened_at: null, closes_at: null, closed_at: null, canceled_at: null, code_expires_at: null, created_at: "2026-09-01T00:00:00Z",
  counts_toward_metrics: true, live: null, ...over,
});
const live = (checkedIn: number, version = "v1") => ({ roster_count: 10, checked_in_count: checkedIn, version });
const BASE = { terms: ["2026-fall", "2026-spring"], term: "2026-fall", view_term: "2026-fall", summary_term: "2026-fall" };
const GROUPS = [{ id: 7, name: "Hindustani Vocal" }];
const overview = (over: Record<string, unknown> = {}) => ({ ...BASE, list_limit: 100, ...over });
const roster = (sessionId: number, name = "Dev Nair", version = "r1") => ({
  session_id: sessionId, version, rows: [{ member_id: `u-${sessionId}`, full_name: name, email: "dev@x.test", status: null, minutes_late: null, unexcused_units: null }],
});
const rosterFor = (call: Call) => (call.payload as { p_session_id: number }).p_session_id;
const pulseOf = (sessions: unknown[]) => ({ sessions, pending_excuses: 0 });
const pulseSession = (id: number, liveNow: ReturnType<typeof live>) => ({ id, status: "open", closes_at: null, code_expires_at: null, live: liveNow, my_record: null });

function renderAttendance(options: { role?: "member" | "executive"; tab?: "overview" | "meetings" | "excuses"; scope?: "all" | "club" | number } = {}) {
  const notify = notifySpy();
  setCacheOwner("u-me");
  const view = render(<AttendancePage user={userOf("u-me")} role={options.role ?? "executive"} groups={GROUPS} initialScope={options.scope ?? "all"} initialTab={options.tab ?? "overview"} />);
  return { notify, ...view };
}
const overviewCalls = () => fake.rpc("get_attendance_overview").calls;
const rosterCalls = () => fake.rpc("get_attendance_roster").calls;
const pulseCalls = () => fake.rpc("get_attendance_pulse").calls;
// Choosing a view writes it to the address (Phase 3.2), and the screen follows the address a moment later: wait for the address, so the
// next step acts on the new view and not on the old one that is about to be replaced.
const inAddress = (key: string, value: string | null) => waitFor(() => expect(new URLSearchParams(window.location.search).get(key)).toBe(value));
async function chooseTerm(value: string) {
  fireEvent.change(screen.getByLabelText("Filter attendance by term"), { target: { value } });
  await inAddress("term", value === "all" ? null : value);
}
/** Selecting a meeting writes ?session= and the screen follows the address a moment later: wait until the list shows it selected. */
async function selectMeeting(name: RegExp) {
  fireEvent.click(await screen.findByRole("button", { name }));
  await waitFor(() => expect(screen.getByRole("button", { name })).toHaveAttribute("aria-current", "true"));
}
async function chooseAudience(value: string) {
  fireEvent.change(screen.getByLabelText("Filter attendance by audience"), { target: { value } });
  await inAddress("scope", value.startsWith("group:") ? `group-${value.slice(6)}` : value);
}

// ---------------------------------------------------------------------------------------------------------------
// What is kept between visits and between views
// ---------------------------------------------------------------------------------------------------------------

describe("the last data of each audience and term", () => {
  const MEETING_TITLE = (view: string) => `Meeting of ${view}`;
  const byTerm = (call: Call) => {
    const term = (call.payload as { p_term_key: string | null }).p_term_key;
    return ok(overview({ sessions: [session(1, { title: MEETING_TITLE(term ?? "all") })] }));
  };

  it("is written to the cache under the audience and the term, after every good read", async () => {
    fake.rpc("get_attendance_overview").reply(byTerm);
    renderAttendance({ tab: "meetings" });
    await screen.findByRole("button", { name: /Meeting of all/ });
    await waitFor(() => expect(readCache<{ sessions: Array<{ title: string }> }>("u-me", "attendance2:all:all")?.sessions[0].title).toBe("Meeting of all"));
    await chooseTerm("2026-spring");
    // A new term brings the Overview tab back; the meetings are one tab away.
    fireEvent.click(await screen.findByRole("tab", { name: "Meetings" }));
    await screen.findByRole("button", { name: /Meeting of 2026-spring/ });
    expect(readCache<{ sessions: Array<{ title: string }> }>("u-me", "attendance2:all:2026-spring")?.sessions[0].title).toBe("Meeting of 2026-spring");
    // The first view's copy is not touched by the second.
    expect(readCache<{ sessions: Array<{ title: string }> }>("u-me", "attendance2:all:all")?.sessions[0].title).toBe("Meeting of all");
  });

  it("is shown at once when the screen is opened again, and replaced when the new read arrives", async () => {
    fake.rpc("get_attendance_overview").reply(byTerm);
    const first = renderAttendance({ tab: "meetings" });
    await screen.findByRole("button", { name: /Meeting of all/ });
    await waitFor(() => expect(readCache("u-me", "attendance2:all:all")).toBeTruthy());
    first.unmount();
    const slow = deferred();
    fake.rpc("get_attendance_overview").reply(slow.reply);
    renderAttendance({ tab: "meetings" });
    expect(screen.queryByText("Loading attendance…")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Meeting of all/ })).toBeInTheDocument();
    await act(async () => { slow.resolve(ok(overview({ sessions: [session(1, { title: "Meeting renamed" })] }))); });
    expect(await screen.findByRole("button", { name: /Meeting renamed/ })).toBeInTheDocument();
  });

  it("belongs to its audience: another audience opened later starts with the loading line, not with this one's meetings", async () => {
    fake.rpc("get_attendance_overview").reply(byTerm);
    const first = renderAttendance({ tab: "meetings" });
    await screen.findByRole("button", { name: /Meeting of all/ });
    await waitFor(() => expect(readCache("u-me", "attendance2:all:all")).toBeTruthy());
    first.unmount();
    fake.rpc("get_attendance_overview").reply(deferred().reply);
    renderAttendance({ tab: "meetings", scope: "club" });
    expect(await screen.findByText("Loading attendance…")).toBeInTheDocument();
    expect(screen.queryByText(/Meeting of all/)).not.toBeInTheDocument();
  });

  it("belongs to its term: a term not read yet shows the loading line, not the term before it", async () => {
    fake.rpc("get_attendance_overview").replyOnce(byTerm).reply(deferred().reply);
    renderAttendance({ tab: "meetings" });
    await screen.findByRole("button", { name: /Meeting of all/ });
    await chooseTerm("2026-spring");
    expect(await screen.findByText("Loading attendance…")).toBeInTheDocument();
    expect(screen.queryByText(/Meeting of all/)).not.toBeInTheDocument();
  });

  it("a term seen on an earlier visit shows from the cache while it is read again", async () => {
    fake.rpc("get_attendance_overview").reply(byTerm);
    const first = renderAttendance({ tab: "meetings" });
    await screen.findByRole("button", { name: /Meeting of all/ });
    await chooseTerm("2026-spring");
    fireEvent.click(await screen.findByRole("tab", { name: "Meetings" }));
    await screen.findByRole("button", { name: /Meeting of 2026-spring/ });
    await waitFor(() => expect(readCache("u-me", "attendance2:all:2026-spring")).toBeTruthy());
    first.unmount();
    window.history.replaceState({}, "", "/");   // leaving the page and coming back: the shell's address has no term in it
    // Second visit: the first view is up at once; the spring term is in the cache but not in this visit.
    fake.rpc("get_attendance_overview").reply(deferred().reply);
    renderAttendance({ tab: "meetings" });
    await screen.findByRole("button", { name: /Meeting of all/ });
    await chooseTerm("2026-spring");
    expect(screen.queryByText("Loading attendance…")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Meetings" }));
    expect(screen.getByRole("button", { name: /Meeting of 2026-spring/ })).toBeInTheDocument();
  });
});

describe("the meeting that is selected", () => {
  it("stays selected through a reload that still lists it; the roster of the same meeting is read again", async () => {
    fake.rpc("get_attendance_overview").reply(ok(overview({ sessions: [session(1, { status: "draft" }), session(2, { status: "draft" })] })));
    fake.rpc("get_attendance_roster").reply((call: Call) => ok(roster(rosterFor(call))));
    fake.rpc("set_attendance_status").reply(ok(null));
    renderAttendance({ tab: "meetings" });
    await selectMeeting(/Meeting 2/);
    fireEvent.change(await screen.findByLabelText("Attendance status for Dev Nair"), { target: { value: "present" } });
    fireEvent.submit(within(screen.getByRole("dialog")).getByRole("button", { name: "Save mark" }).closest("form")!);
    await waitFor(() => expect(overviewCalls()).toHaveLength(2));
    await waitFor(() => expect(rosterCalls().length).toBeGreaterThanOrEqual(3));
    expect(rosterCalls().map(rosterFor).slice(1)).toEqual([2, 2]);
    expect(screen.getByRole("button", { name: /Meeting 2/ })).toHaveClass("active");
  });

  it("moves to the first meeting when the reload no longer lists it", async () => {
    fake.rpc("get_attendance_overview")
      .replyOnce(ok(overview({ sessions: [session(1, { status: "draft" }), session(2, { status: "draft" })] })))
      .reply(ok(overview({ sessions: [session(1, { status: "draft" })] })));
    fake.rpc("get_attendance_roster").reply((call: Call) => ok(roster(rosterFor(call))));
    fake.rpc("set_attendance_status").reply(ok(null));
    renderAttendance({ tab: "meetings" });
    await selectMeeting(/Meeting 2/);
    fireEvent.change(await screen.findByLabelText("Attendance status for Dev Nair"), { target: { value: "present" } });
    fireEvent.submit(within(screen.getByRole("dialog")).getByRole("button", { name: "Save mark" }).closest("form")!);
    await waitFor(() => expect(screen.queryByRole("button", { name: /Meeting 2/ })).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: /Meeting 1/ })).toHaveClass("active");
    // The roster of the meeting it moved to is read; wait for it so no read is left running when the test ends.
    await waitFor(() => expect(rosterCalls().map(rosterFor).at(-1)).toBe(1));
    await screen.findByText("Dev Nair", { selector: "b" });
  });
});

// ---------------------------------------------------------------------------------------------------------------
// The roster
// ---------------------------------------------------------------------------------------------------------------

describe("when the roster is read", () => {
  it("a member is never shown the roster, whatever tab the screen was opened on", async () => {
    fake.rpc("get_attendance_overview").reply(ok(overview({ sessions: [session(1)] })));
    renderAttendance({ role: "member", tab: "meetings" });
    await screen.findByText("Meeting attendance");
    expect(rosterCalls()).toHaveLength(0);
  });

  it("an executive on the Overview tab does not read it", async () => {
    fake.rpc("get_attendance_overview").reply(ok(overview({ sessions: [session(1)] })));
    renderAttendance();
    await screen.findByText("Closed meetings");
    expect(rosterCalls()).toHaveLength(0);
  });

  it("is read when the Meetings tab is chosen, for the meeting that is selected", async () => {
    fake.rpc("get_attendance_overview").reply(ok(overview({ sessions: [session(1), session(2)] })));
    fake.rpc("get_attendance_roster").reply((call: Call) => ok(roster(rosterFor(call))));
    renderAttendance();
    await screen.findByText("Closed meetings");
    fireEvent.click(screen.getByRole("tab", { name: "Meetings" }));
    await waitFor(() => expect(rosterCalls()).toHaveLength(1));
    expect(rosterCalls()[0].payload).toEqual({ p_session_id: 1 });
    fireEvent.click(screen.getByRole("button", { name: /Meeting 2/ }));
    await waitFor(() => expect(rosterCalls()).toHaveLength(2));
    expect(rosterCalls()[1].payload).toEqual({ p_session_id: 2 });
  });

  it("only the newest answer is used: a late answer for the meeting before does not replace this meeting's roster", async () => {
    const slow = deferred();
    fake.rpc("get_attendance_overview").reply(ok(overview({ sessions: [session(1), session(2)] })));
    fake.rpc("get_attendance_roster").replyOnce(slow.reply).reply((call: Call) => ok(roster(rosterFor(call), "Second Member")));
    renderAttendance({ tab: "meetings" });
    await selectMeeting(/Meeting 2/);
    expect(await screen.findByText("Second Member", { selector: "b" })).toBeInTheDocument();
    await act(async () => { slow.resolve(ok(roster(1, "First Member"))); });
    expect(screen.getByText("Second Member", { selector: "b" })).toBeInTheDocument();
    expect(screen.queryByText("First Member", { selector: "b" })).not.toBeInTheDocument();
    expect(screen.queryByText("Loading roster…")).not.toBeInTheDocument();
  });

  it("a failure says so as an error toast; a dropped connection says that instead", async () => {
    fake.rpc("get_attendance_overview").reply(ok(overview({ sessions: [session(1)] })));
    fake.rpc("get_attendance_roster").replyOnce(fail("boom")).replyOnce(rejects()).reply(ok(roster(1)));
    const { notify } = renderAttendance({ tab: "meetings" });
    await waitFor(() => expect(notify.find("The roster could not be loaded. Try again in a moment.").tone).toBe("error"));
    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
    await waitFor(() => expect(notify.find("The roster could not be loaded. Check your connection and try again.").tone).toBe("error"));
  });

  it("the failure of one meeting's roster is not shown on the next: choosing another meeting reads it afresh", async () => {
    const slow = deferred();
    fake.rpc("get_attendance_overview").reply(ok(overview({ sessions: [session(1), session(2)] })));
    fake.rpc("get_attendance_roster").replyOnce(fail("boom")).reply(slow.reply);
    renderAttendance({ tab: "meetings" });
    expect(await screen.findByText(/The roster could not be loaded\./)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Meeting 2/ }));
    expect(await screen.findByText("Loading roster…")).toBeInTheDocument();
    expect(screen.queryByText(/The roster could not be loaded\./)).not.toBeInTheDocument();
    await act(async () => { slow.resolve(ok(roster(2))); });
  });
});

describe("the cap of the review queues", () => {
  it("raised by Show more, it stays raised for the reads that follow, until the audience or the term changes", async () => {
    const form = { id: 1, session_id: 1, member_id: "u-dev", reason: "Class conflict this evening", proof_path: null, reason_category: "other", notified_at: null, status: "pending", submitted_at: "2026-10-02T00:00:00Z", reviewed_at: null, review_note: null };
    fake.rpc("get_attendance_overview").reply((call: Call) => ok(overview({ sessions: [session(1)], excuses: [form], excuses_pending: 1, excuses_total: 150, list_limit: (call.payload as { p_list_limit: number }).p_list_limit })));
    fake.rpc("review_attendance_excuse").reply(ok(null));
    renderAttendance({ tab: "excuses" });
    fireEvent.click(await screen.findByRole("button", { name: "Show more" }));
    await waitFor(() => expect(overviewCalls()).toHaveLength(2));
    // An approval reads the overview again: it asks for the larger list, not the first page.
    fireEvent.click(await screen.findByRole("button", { name: "Approve" }));
    fireEvent.submit(within(screen.getByRole("dialog")).getByRole("button", { name: "Approve" }).closest("form")!);
    await waitFor(() => expect(overviewCalls()).toHaveLength(3));
    expect(overviewCalls().map((call) => (call.payload as { p_list_limit: number }).p_list_limit)).toEqual([100, 250, 250]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// The poll
// ---------------------------------------------------------------------------------------------------------------

describe("the poll, in the parts the other tests leave open", () => {
  const openMeeting = (over: Record<string, unknown> = {}) => fake.rpc("get_attendance_overview").reply(ok(overview({ sessions: [session(3, { status: "open", live: live(4) })], ...over })));

  it("a dropped connection is reported with its own sentence, once", async () => {
    vi.useFakeTimers();
    openMeeting();
    fake.rpc("get_attendance_pulse").reply(rejects());
    const { notify } = renderAttendance();
    await advance(1);
    await advance(31_000);
    const shown = notify.toasts().filter((toast) => /could not be refreshed/.test(toast.message));
    expect(shown).toEqual([{ message: "Attendance could not be refreshed. Check your connection and try again.", tone: "error" }]);
    expect(pulseCalls().length).toBeGreaterThanOrEqual(3);
  });

  it("when it asks for the overview again on the Meetings tab, it reads the selected meeting's roster again too", async () => {
    vi.useFakeTimers();
    openMeeting();
    fake.rpc("get_attendance_roster").reply(ok(roster(3)));
    fake.rpc("get_attendance_pulse").reply(ok(pulseOf([])));
    renderAttendance({ tab: "meetings" });
    await advance(1);
    expect(rosterCalls()).toHaveLength(1);
    await advance(10_100);
    expect(overviewCalls()).toHaveLength(2);
    expect(rosterCalls()).toHaveLength(2);
  });

  it("on the Overview tab it does not read a roster again, even when the open meeting's marks moved", async () => {
    vi.useFakeTimers();
    openMeeting({ sessions: [session(3, { status: "open", live: live(4, "r1") })] });
    fake.rpc("get_attendance_roster").reply(ok(roster(3, "Dev Nair", "r1")));
    fake.rpc("get_attendance_pulse").reply(ok(pulseOf([pulseSession(3, live(5, "r2"))])));
    renderAttendance({ tab: "meetings" });
    await advance(1);
    expect(rosterCalls()).toHaveLength(1);
    fireEvent.click(screen.getByRole("tab", { name: "Overview" }));
    await advance(21_000);
    expect(pulseCalls().length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("5 of 10 checked in")).toBeInTheDocument();
    expect(rosterCalls()).toHaveLength(1);
  });

  it("a failed poll is reported again after any good read of the overview in between, not only after a good poll", async () => {
    vi.useFakeTimers();
    openMeeting();
    fake.rpc("get_attendance_pulse").reply(fail("boom"));
    const { notify } = renderAttendance();
    await advance(1);
    await advance(11_000);
    const refreshFailures = () => notify.toasts().filter((toast) => /could not be refreshed/.test(toast.message)).length;
    expect(refreshFailures()).toBe(1);
    await advance(20_000);
    expect(refreshFailures()).toBe(1);
    // A good read of another term, then the next poll fails again: the person hears of it again.
    fireEvent.change(screen.getByLabelText("Filter attendance by term"), { target: { value: "2026-spring" } });   // (a frozen clock: no waitFor)
    await advance(1);
    await advance(1);
    await advance(11_000);
    expect(refreshFailures()).toBe(2);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------------------------------------------

describe("the page around the parts", () => {
  it("a new audience or a new term brings the Overview tab back", async () => {
    fake.rpc("get_attendance_overview").reply(ok(overview({ sessions: [session(1)] })));
    fake.rpc("get_attendance_roster").reply(ok(roster(1)));
    renderAttendance({ tab: "meetings" });
    await screen.findByRole("button", { name: /Meeting 1/ });
    expect(screen.getByRole("tab", { name: "Meetings" })).toHaveAttribute("aria-selected", "true");
    await chooseAudience("club");
    await waitFor(() => expect(screen.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true"));
    fireEvent.click(screen.getByRole("tab", { name: "Meetings" }));
    await screen.findByRole("button", { name: /Meeting 1/ });
    await chooseTerm("2026-spring");
    await waitFor(() => expect(screen.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true"));
  });

  it("names a member by name, else by email, else 'Member'", async () => {
    const form = (id: number, member: string) => ({ id, session_id: 1, member_id: member, reason: `Reason ${id}`, proof_path: null, reason_category: "other", notified_at: null, status: "approved", submitted_at: "2026-10-02T00:00:00Z", reviewed_at: null, review_note: null });
    fake.rpc("get_attendance_overview").reply(ok(overview({
      sessions: [session(1)],
      profiles: [{ id: "u-named", full_name: "Dev Nair", email: "dev@x.test" }, { id: "u-mail", full_name: null, email: "mail@x.test" }],
      excuses: [form(1, "u-named"), form(2, "u-mail"), form(3, "u-nobody")],
    })));
    renderAttendance({ tab: "excuses" });
    await screen.findByText("Reason 1");
    const headings = [...document.querySelectorAll(".excuse-list article h3")].map((heading) => heading.textContent);
    expect(headings).toEqual(["Dev Nair", "mail@x.test", "Member"]);
  });
});
