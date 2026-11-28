// Phase 3.2 on the Attendance screen: the audience, the term and the selected meeting are in the address (?scope= ?term= ?session=), so
// a reload keeps them, a link opens them and Back and Forward move through them. A value that is not valid is ignored (the screen
// opens in its usual view and the address is not rewritten); the shell's ?page= and every other parameter are left alone; the tab is
// not in the address (the shell keys the page by its ?tab=, so writing it would remount the page).
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AttendancePage } from "../../features/attendance/components/attendance-page";
import type { ClubRole } from "../../features/attendance/model";
import { parseScope, parseTerm, serializeScope } from "../../features/attendance/url-state";
import { setCacheOwner } from "../../lib/cache";
import { notifySpy, userOf } from "../support/helpers";
import { fake, ok, type Call } from "../support/fake-supabase";

const session = (id: number, over: Record<string, unknown> = {}) => ({
  id, scope: "club", subgroup_id: null, subgroup_name: null, title: `Meeting ${id}`, starts_at: "2026-10-01T23:00:00Z", status: "closed",
  opened_at: null, closes_at: null, closed_at: null, canceled_at: null, code_expires_at: null, created_at: "2026-09-01T00:00:00Z",
  counts_toward_metrics: true, live: null, ...over,
});
const live = { roster_count: 4, checked_in_count: 1, version: "v1" };
const BASE = { terms: ["2026-fall", "2026-spring"], term: "2026-fall", view_term: "2026-fall", summary_term: "2026-fall", profiles: [] };
const GROUPS = [{ id: 7, name: "Hindustani Vocal" }];
type Payload = { p_scope: string; p_subgroup_id: number | null; p_term_key: string | null; p_list_limit?: number };
const payloadOf = (call: Call) => call.payload as Payload;
const overviewCalls = () => fake.rpc("get_attendance_overview").calls;
const lastView = () => payloadOf(overviewCalls().at(-1)!);
const query = () => new URLSearchParams(window.location.search);
const roster = (sessionId: number) => ({ session_id: sessionId, version: "r1", rows: [{ member_id: "u-dev", full_name: "Dev Nair", email: "dev@x.test", status: "present", minutes_late: null, unexcused_units: null }] });

/** Every view answers with the meetings given for it (by the scope asked for); the roster of any meeting answers too. */
function script(meetings: (scope: string) => unknown[] = () => [session(1), session(2), session(3)], over: Record<string, unknown> = {}) {
  fake.rpc("get_attendance_overview").reply((call: Call) => ok({ ...BASE, list_limit: payloadOf(call).p_list_limit ?? 100, sessions: meetings(payloadOf(call).p_scope), ...over }));
  fake.rpc("get_attendance_roster").reply((call: Call) => ok(roster((call.payload as { p_session_id: number }).p_session_id)));
}
function renderAt(search: string, options: { role?: ClubRole; tab?: "overview" | "meetings" | "excuses"; scope?: "all" | "club" | number; groups?: typeof GROUPS } = {}) {
  window.history.replaceState({}, "", `/${search}`);
  const notify = notifySpy();
  setCacheOwner("u-me");
  const role: ClubRole = options.role ?? "executive";
  const view = render(<AttendancePage user={userOf("u-me")} role={role} groups={options.groups ?? GROUPS} initialScope={options.scope ?? "all"} initialTab={options.tab ?? "overview"} />);
  return { notify, ...view };
}
const audience = () => screen.getByLabelText("Filter attendance by audience") as HTMLSelectElement;
const term = () => screen.getByLabelText("Filter attendance by term") as HTMLSelectElement;
const tabSelected = (name: string) => screen.getByRole("tab", { name: new RegExp(`^${name}`) }).getAttribute("aria-selected") === "true";
const selectedMeeting = () => within(screen.getByRole("complementary", { name: "Meetings" })).getAllByRole("button").find((button) => button.getAttribute("aria-current") === "true");
/** How many entries the history holds: a choice that Back can undo adds one, a choice that replaces the entry adds none. */
const entries = () => window.history.length;
/** Back or Forward in the browser, and the moment its popstate has been handled. */
async function travel(direction: "back" | "forward") {
  await act(async () => { if (direction === "back") window.history.back(); else window.history.forward(); await new Promise((resolve) => setTimeout(resolve, 20)); });
}

describe("what the address says", () => {
  it("opens the view it names: audience, term, meeting and the Meetings tab", async () => {
    script();
    renderAt("?page=attendance&scope=group-7&term=2026-spring&session=2");
    await screen.findByRole("tab", { name: "Meetings" });
    expect(lastView()).toEqual({ p_scope: "subgroup", p_subgroup_id: 7, p_term_key: "2026-spring", p_list_limit: 100 });
    expect(audience().value).toBe("group:7");
    expect(term().value).toBe("2026-spring");
    // A meeting in the address, and a person who can manage: the Meetings tab, with that meeting selected and its roster read.
    expect(tabSelected("Meetings")).toBe(true);
    expect(selectedMeeting()).toHaveTextContent("Meeting 2");
    await waitFor(() => expect(fake.rpc("get_attendance_roster").calls.at(-1)?.payload).toEqual({ p_session_id: 2 }));
    // Opening a link writes nothing: the address is what it was.
    expect(window.location.search).toBe("?page=attendance&scope=group-7&term=2026-spring&session=2");
  });

  it("opens the Meetings tab for a meeting in the address, but not over a tab the shell asked for, nor over one the person chose", async () => {
    script();
    const first = renderAt("?page=attendance&session=2");
    await screen.findByRole("tab", { name: "Meetings" });
    expect(tabSelected("Meetings")).toBe(true);
    // The person goes to the Overview: it stays, although the address still names a meeting.
    fireEvent.click(screen.getByRole("tab", { name: "Overview" }));
    expect(tabSelected("Overview")).toBe(true);
    first.unmount();
    renderAt("?page=attendance&session=2", { tab: "excuses" });
    await screen.findByRole("tab", { name: "Meetings" });
    expect(tabSelected("Absence forms")).toBe(true);
  });

  it.each([
    ["scope=banana", "scope"], ["scope=group-0", "scope"], ["scope=group-07", "scope"], ["scope=group-x", "scope"], ["scope=GROUP-7", "scope"], ["scope=group-", "scope"], ["scope=", "scope"],
    ["term=2026", "term"], ["term=2026-winter", "term"], ["term=fall-2026", "term"], ["term=%20", "term"],
    ["session=abc", "session"], ["session=0", "session"], ["session=-3", "session"], ["session=1.5", "session"], ["session=02", "session"],
  ])("a bad value (%s) is ignored: the usual view opens and the address is not rewritten", async (bad) => {
    script();
    renderAt(`?page=attendance&${bad}`);
    await screen.findByRole("tab", { name: "Overview" });
    expect(lastView()).toEqual({ p_scope: "all", p_subgroup_id: null, p_term_key: null, p_list_limit: 100 });
    expect(audience().value).toBe("all");
    expect(term().value).toBe("all");
    expect(tabSelected("Overview")).toBe(true);
    expect(window.location.search).toBe(`?page=attendance&${bad}`);
  });

  it("a meeting that this view does not have opens the first one; a group the person cannot see opens the starting audience", async () => {
    script();
    renderAt("?page=attendance&session=99&scope=group-42", { tab: "meetings" });
    await screen.findByRole("tab", { name: "Meetings" });
    expect(lastView()).toMatchObject({ p_scope: "all", p_subgroup_id: null });
    await waitFor(() => expect(selectedMeeting()).toHaveTextContent("Meeting 1"));
    expect(audience().value).toBe("all");
  });

  it("starts at the audience the page was opened for when the address has none, and the address wins when it has one", async () => {
    script();
    const first = renderAt("?page=attendance", { scope: 7 });
    await screen.findByRole("tab", { name: "Overview" });
    expect(lastView()).toMatchObject({ p_scope: "subgroup", p_subgroup_id: 7 });
    expect(audience().value).toBe("group:7");
    first.unmount();
    renderAt("?page=attendance&scope=club", { scope: 7 });
    await screen.findByRole("tab", { name: "Overview" });
    expect(lastView()).toMatchObject({ p_scope: "club", p_subgroup_id: null });
  });

  it("a member with a link to a meeting sees the member view (the meeting is theirs to read, not to manage)", async () => {
    script(() => [session(1), session(2)]);
    renderAt("?page=attendance&session=2", { role: "member" });
    expect(await screen.findByLabelText("Attendance code")).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Meetings" })).not.toBeInTheDocument();
    expect(screen.getByText("Meeting attendance")).toBeInTheDocument();
  });
});

describe("what a choice writes", () => {
  it("the audience is written as scope=, leaves ?page= and every other parameter alone, and never writes ?tab=", async () => {
    script();
    renderAt("?page=attendance&keep=1#top");
    await screen.findByRole("tab", { name: "Overview" });
    const before = entries();
    fireEvent.change(audience(), { target: { value: "club" } });
    await waitFor(() => expect(query().get("scope")).toBe("club"));
    expect(entries()).toBe(before + 1);
    expect(query().get("page")).toBe("attendance");
    expect(query().get("keep")).toBe("1");
    expect(window.location.hash).toBe("#top");
    fireEvent.change(audience(), { target: { value: "group:7" } });
    await waitFor(() => expect(query().get("scope")).toBe("group-7"));
    fireEvent.click(await screen.findByRole("tab", { name: "Meetings" }));
    fireEvent.click(await screen.findByRole("button", { name: /Meeting 2/ }));
    await waitFor(() => expect(query().get("session")).toBe("2"));
    // The shell keys this page by ?tab=: a write of it would remount the screen.
    expect(query().has("tab")).toBe(false);
    expect(query().get("page")).toBe("attendance");
  });

  it("the term is written as term=, and 'All terms' takes it out again", async () => {
    script();
    renderAt("?page=attendance");
    await screen.findByRole("tab", { name: "Overview" });
    const before = entries();
    fireEvent.change(term(), { target: { value: "2026-spring" } });
    await waitFor(() => expect(query().get("term")).toBe("2026-spring"));
    expect(entries()).toBe(before + 1);
    await waitFor(() => expect(lastView().p_term_key).toBe("2026-spring"));
    await screen.findByRole("tab", { name: "Overview" });
    fireEvent.change(term(), { target: { value: "all" } });
    await waitFor(() => expect(query().has("term")).toBe(false));
    expect(window.location.search).toBe("?page=attendance");
  });

  it("the meeting is written as session=, and Back and Forward move between the meetings chosen", async () => {
    script();
    renderAt("?page=attendance", { tab: "meetings" });
    await screen.findByRole("button", { name: /Meeting 3/ });
    expect(selectedMeeting()).toHaveTextContent("Meeting 1");
    const before = entries();
    fireEvent.click(screen.getByRole("button", { name: /Meeting 2/ }));
    await waitFor(() => expect(selectedMeeting()).toHaveTextContent("Meeting 2"));
    expect(entries()).toBe(before + 1);
    fireEvent.click(screen.getByRole("button", { name: /Meeting 3/ }));
    await waitFor(() => expect(selectedMeeting()).toHaveTextContent("Meeting 3"));
    expect(query().get("session")).toBe("3");
    await travel("back");
    await waitFor(() => expect(selectedMeeting()).toHaveTextContent("Meeting 2"));
    await waitFor(() => expect(fake.rpc("get_attendance_roster").calls.at(-1)?.payload).toEqual({ p_session_id: 2 }));
    await travel("back");
    await waitFor(() => expect(selectedMeeting()).toHaveTextContent("Meeting 1"));
    expect(query().has("session")).toBe(false);
    expect(query().get("page")).toBe("attendance");
    await travel("forward");
    await waitFor(() => expect(selectedMeeting()).toHaveTextContent("Meeting 2"));
  });

  it("Back returns to the audience and term before, and reads that view again", async () => {
    script();
    renderAt("?page=attendance");
    await screen.findByRole("tab", { name: "Overview" });
    fireEvent.change(audience(), { target: { value: "club" } });
    await waitFor(() => expect(lastView().p_scope).toBe("club"));
    await screen.findByRole("tab", { name: "Overview" });
    fireEvent.change(term(), { target: { value: "2026-spring" } });
    await waitFor(() => expect(lastView()).toMatchObject({ p_scope: "club", p_term_key: "2026-spring" }));
    await screen.findByRole("tab", { name: "Overview" });
    await travel("back");
    await waitFor(() => expect(term().value).toBe("all"));
    expect(audience().value).toBe("club");
    await travel("back");
    await waitFor(() => expect(audience().value).toBe("all"));
    expect(query().has("scope")).toBe(false);
    expect(window.location.search).toBe("?page=attendance");
  });

  it("an audience chosen on a page opened for a group is written even when it is the usual one, so Back returns to the group", async () => {
    script();
    renderAt("?page=attendance", { scope: 7 });
    await screen.findByRole("tab", { name: "Overview" });
    fireEvent.change(audience(), { target: { value: "all" } });
    await waitFor(() => expect(query().get("scope")).toBe("all"));
    await waitFor(() => expect(lastView().p_scope).toBe("all"));
    await travel("back");
    await waitFor(() => expect(audience().value).toBe("group:7"));
  });
});

describe("a change the pickers did not make (Back, a link) is still a new view", () => {
  const forms = Array.from({ length: 3 }, (_, i) => ({ id: i + 1, session_id: 1, member_id: "u-dev", reason: "Class conflict this evening", proof_path: null, reason_category: "other", notified_at: null, status: "pending", submitted_at: "2026-10-02T00:00:00Z", reviewed_at: null, review_note: null }));
  /** What the browser does for Back to an entry or a link: the address changes and popstate is fired. */
  const arriveAt = async (search: string) => {
    await act(async () => { window.history.pushState({}, "", `/${search}`); window.dispatchEvent(new PopStateEvent("popstate")); });
  };

  it("starts again at the first page of the review queues", async () => {
    script(() => [session(1)], { excuses: forms, excuses_total: 150, excuses_pending: 150 });
    renderAt("?page=attendance", { tab: "excuses" });
    fireEvent.click(await screen.findByRole("button", { name: "Show more" }));
    await waitFor(() => expect(lastView().p_list_limit).toBe(250));
    await arriveAt("?page=attendance&scope=club");
    await waitFor(() => expect(lastView().p_scope).toBe("club"));
    expect(lastView().p_list_limit).toBe(100);
  });

  it("never shows the code of one meeting on the card of another", async () => {
    // The open meeting is 3 in one view and 4 in the other; the code rotated here belongs to 3.
    script((scope) => [session(scope === "club" ? 4 : 3, { status: "open", live })]);
    fake.rpc("rotate_attendance_code").reply(ok([{ check_in_code: "999111" }]));
    renderAt("?page=attendance");
    fireEvent.click(await screen.findByRole("button", { name: "Rotate code" }));
    expect(await screen.findByText("999111")).toBeInTheDocument();
    await arriveAt("?page=attendance&scope=club");
    await waitFor(() => expect(lastView().p_scope).toBe("club"));
    expect(await screen.findByText("Hidden after reload")).toBeInTheDocument();
    expect(screen.queryByText("999111")).not.toBeInTheDocument();
    // And back in the first view the code is still the one rotated there.
    await arriveAt("?page=attendance");
    expect(await screen.findByText("999111")).toBeInTheDocument();
  });
});

describe("the address parts", () => {
  it("scope: all, club and group-N; nothing else", () => {
    expect(["all", "club", "group-7", "group-1234"].map(parseScope)).toEqual(["all", "club", 7, 1234]);
    for (const bad of ["", "ALL", "groups-7", "group-0", "group-07", "group--1", "group-1.5", "group-7x", "group-99999999999999999999", "7"]) expect(parseScope(bad)).toBeUndefined();
    expect([serializeScope("all"), serializeScope("club"), serializeScope(7), serializeScope(null)]).toEqual(["all", "club", "group-7", ""]);
  });

  it("term: all, or a year with spring or fall", () => {
    expect(["all", "2026-fall", "2025-spring"].map(parseTerm)).toEqual(["all", "2026-fall", "2025-spring"]);
    for (const bad of ["", "2026", "2026-winter", "26-fall", "2026-Fall", "2026-fall ", "x2026-fall", "2026-fall-1"]) expect(parseTerm(bad)).toBeUndefined();
  });
});
