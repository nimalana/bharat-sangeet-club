// Group people, the recordings workspace and the screens that delete stored files, run for real against the fake client.
//
// Replaces tests/people-recordings-wiring.test.mjs (every test in it read component source) and the recordings test of
// tests/refresh-wiring.test.mjs. What each old assertion protected, and where it is checked now:
//
//  people-recordings-wiring "group people: Decline asks first, and one change runs at a time":
//    Decline opens a confirmation and sends nothing until it is confirmed
//      -> "Decline asks first ...".
//    one change runs at a time (a second click before the next render must not start a second change)
//      -> "a double click on Approve sends one change", and the settings form shares the guard
//         -> "saving the settings waits for a change that is still running".
//    (Dropped: `doesNotMatch(/if \(busyKey\) return false;/)`: it only said how the guard was written.)
//  people-recordings-wiring "the notation list drops stale reloads and keeps what is shown when a reload fails (frontend-7)":
//    -> "the notation list ..." (older reload arriving last is dropped; a failed reload keeps the notes and says so)
//    -> "the roster ..." for the group people list (same rule).
//  people-recordings-wiring "no storage remove([...]) call outside the helper": the rule was that no screen may take an
//    empty answer from storage for a successful delete. Checked by what each screen does now:
//    club archive manager, library item, recording and notation deletes -> "deleting a stored file: an empty answer is
//    not a success" groups; the studio's clean-up and the archive upload's clean-up -> their own groups below;
//    finance's -> finance.test.tsx; the attendance excuse upload -> attendance.test.tsx (that one still uses a bare
//    remove on purpose; the test pins what it does).
//  people-recordings-wiring "the recording and resource screens delete files through the helper and show its sentence":
//    -> the same groups: the sentence on screen is the helper's (refused / storage error), and the row is only deleted
//       after the file is confirmed gone.
//  people-recordings-wiring "the recording studio never removes the take of a recording that was saved":
//    -> "the recording studio ..." group (take removed only when no row points at it; notation file likewise).
//  refresh-wiring "the recordings list drops stale search responses and keeps rows when a load fails":
//    -> "the recordings list ..." group.
//  archive-sharing (last test) "the manager uses the guard, and the old advice is gone from the source":
//    -> "lowering a shared recording to Executives only is refused" and "deleting a recording that a group plays".
//
// Dropped on purpose: nothing that checked behaviour. The text-style `doesNotMatch` lines are dropped (see above).

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ClubArchiveManager } from "../../features/recordings/components/club-archive-manager";
import type { ClubArchiveItem } from "../../lib/db";
import { RecordingWorkspace } from "../../features/recordings/components/recording-workspace";
import { NoteActions, RecordingManageBar, type ManagedNote, type ManagedRecording } from "../../features/recordings/components/recording-manage";
import { ResourceActions, type ManagedResource } from "../../features/resources/components/resource-actions";
import { GroupPeople } from "../../features/groups/components/group-people";
import { setCacheOwner } from "../../lib/cache";
import { FILE_NOT_DELETED } from "../../lib/storage-remove";
import { advance, flush, notifySpy, userOf } from "../support/helpers";
import { deferred, fail, fake, ok, rejects } from "../support/fake-supabase";
import { openPortal } from "../support/portal";
import { routeUploadsToFakeClient } from "./content-uploads";

// Uploads go through XMLHttpRequest (Phase 3.1): the scripted answers of `fake.storage(bucket, "upload")` still decide them.
beforeEach(() => { routeUploadsToFakeClient(); });

// The waveform player draws on a canvas that jsdom does not have. Only this third-party library is replaced.
vi.mock("wavesurfer.js", () => ({
  default: { create: () => ({ on() {}, destroy() {}, getDuration: () => 0, getCurrentTime: () => 0, setTime() {}, setPlaybackRate() {}, playPause() {} }) },
}));

// The drone player of the studio schedules sound on a clock jsdom does not have. Only this library is replaced.
vi.mock("tone", () => ({
  start: async () => {},
  Transport: { clear() {}, stop() {}, start() {}, scheduleRepeat: () => 1 },
  Synth: class { volume = { value: 0 }; toDestination() { return this; } triggerAttackRelease() {} triggerRelease() {} dispose() {} },
}));

// ---------------------------------------------------------------------------------------------------------------
// Group people
// ---------------------------------------------------------------------------------------------------------------

const GROUP = { id: 7, name: "Hindustani Vocal", description: "Weekly practice", enrollment_mode: "approval" as const, archived_at: null };
const person = (id: string, name: string, status = "active", membership_role = "member") =>
  ({ member_id: id, full_name: name, email: `${id}@x.test`, status, membership_role, joined_at: "2026-01-01T00:00:00Z", status_updated_at: "2026-01-01T00:00:00Z" });

function renderPeople(options: { role?: "member" | "executive" | "admin"; myRole?: "member" | "leader" | "manager" | null; isMember?: boolean } = {}) {
  const notify = notifySpy();
  const onGroupChanged = vi.fn();
  const onLeft = vi.fn();
  render(<GroupPeople user={userOf("u-me")} role={options.role ?? "executive"} group={GROUP} myRole={options.myRole ?? null} isMember={options.isMember ?? false} onGroupChanged={onGroupChanged} onLeft={onLeft} />);
  return { notify, onGroupChanged, onLeft };
}
const reviews = () => fake.rpc("review_subgroup_request").calls;

describe("group people: asking first, and one change at a time", () => {
  it("Decline asks first: nothing is sent until the person confirms", async () => {
    fake.rpc("list_subgroup_roster").reply(ok([person("u-dev", "Dev Nair", "pending")]));
    fake.rpc("review_subgroup_request").reply(ok(null));
    const { notify, onGroupChanged } = renderPeople();
    fireEvent.click(await screen.findByRole("button", { name: "Decline" }));
    expect(within(screen.getByRole("dialog")).getByText("Decline this request?")).toBeInTheDocument();
    expect(reviews()).toHaveLength(0);
    // Cancel changes nothing.
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(reviews()).toHaveLength(0);
    // Confirm sends the decision, reloads the roster and tells the group page.
    fireEvent.click(screen.getByRole("button", { name: "Decline" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Decline request" }));
    await waitFor(() => expect(onGroupChanged).toHaveBeenCalled());
    expect(reviews()).toHaveLength(1);
    expect(reviews()[0].payload).toEqual({ p_subgroup_id: 7, p_member_id: "u-dev", p_decision: "decline" });
    expect(notify.find("Request from Dev Nair declined").tone).not.toBe("error");
    expect(fake.rpc("list_subgroup_roster").count).toBe(2);
  });

  it("Approve and Waitlist act at once (a person who asked to join is not made to confirm)", async () => {
    fake.rpc("list_subgroup_roster").reply(ok([person("u-dev", "Dev Nair", "pending")]));
    fake.rpc("review_subgroup_request").reply(ok(null));
    renderPeople();
    fireEvent.click(await screen.findByRole("button", { name: "Waitlist" }));
    await waitFor(() => expect(reviews()).toHaveLength(1));
    expect(reviews()[0].payload).toMatchObject({ p_decision: "waitlist" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("a double click on Approve sends one change", async () => {
    const slow = deferred();
    fake.rpc("list_subgroup_roster").reply(ok([person("u-dev", "Dev Nair", "pending")]));
    fake.rpc("review_subgroup_request").reply(slow.reply);
    renderPeople();
    const approve = await screen.findByRole("button", { name: "Approve" });
    // Both clicks land before React has drawn the disabled button: only the guard can stop the second.
    act(() => { approve.click(); approve.click(); });
    await waitFor(() => expect(reviews()).toHaveLength(1));
    await flush();
    expect(reviews()).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Approving…" })).toBeDisabled();
    await act(async () => { slow.resolve(ok(null)); });
    await waitFor(() => expect(screen.queryByRole("button", { name: "Approving…" })).not.toBeInTheDocument());
    expect(reviews()).toHaveLength(1);
  });

  it("saving the settings waits for a change that is still running", async () => {
    const slow = deferred();
    fake.rpc("list_subgroup_roster").reply(ok([person("u-dev", "Dev Nair", "pending")]));
    fake.rpc("review_subgroup_request").reply(slow.reply);
    fake.rpc("update_subgroup").reply(ok(null));
    const { notify, onGroupChanged } = renderPeople();
    fireEvent.click(await screen.findByRole("button", { name: "Approve" }));
    await waitFor(() => expect(reviews()).toHaveLength(1));
    fireEvent.click(screen.getByRole("button", { name: "Group settings" }));
    const form = () => within(screen.getByRole("dialog")).getByRole("button", { name: "Save" }).closest("form")!;
    fireEvent.submit(form());
    await flush();
    expect(fake.rpc("update_subgroup").count).toBe(0);
    // Once the running change is done, the same form saves.
    await act(async () => { slow.resolve(ok(null)); });
    await waitFor(() => expect(onGroupChanged).toHaveBeenCalledTimes(1));
    fireEvent.submit(form());
    await waitFor(() => expect(fake.rpc("update_subgroup").count).toBe(1));
    expect(fake.rpc("update_subgroup").calls[0].payload).toEqual({ p_subgroup_id: 7, p_name: "Hindustani Vocal", p_description: "Weekly practice" });
    await waitFor(() => expect(notify.find("Group settings saved").tone).toBeUndefined());
  });

  it("a double submit of the settings form sends one save", async () => {
    const slow = deferred();
    fake.rpc("list_subgroup_roster").reply(ok([]));
    fake.rpc("update_subgroup").reply(slow.reply);
    renderPeople();
    fireEvent.click(await screen.findByRole("button", { name: "Group settings" }));
    const form = within(screen.getByRole("dialog")).getByRole("button", { name: "Save" }).closest("form")!;
    act(() => { fireEvent.submit(form); fireEvent.submit(form); });
    await waitFor(() => expect(fake.rpc("update_subgroup").count).toBe(1));
    await flush();
    expect(fake.rpc("update_subgroup").count).toBe(1);
    await act(async () => { slow.resolve(ok(null)); });
  });

  it("a failed review still reloads the roster (someone else has usually reviewed it already) and says it failed", async () => {
    fake.rpc("list_subgroup_roster").replyOnce(ok([person("u-dev", "Dev Nair", "pending")])).reply(ok([person("u-dev", "Dev Nair", "active")]));
    fake.rpc("review_subgroup_request").reply(fail("This request was already reviewed"));
    const { notify, onGroupChanged } = renderPeople();
    fireEvent.click(await screen.findByRole("button", { name: "Approve" }));
    await waitFor(() => expect(fake.rpc("list_subgroup_roster").count).toBe(2));
    expect(notify.find("This request was already reviewed").tone).toBe("error");
    expect(onGroupChanged).not.toHaveBeenCalled();
    expect(await screen.findByText("1 member")).toBeInTheDocument();
  });
});

describe("group people: the settings and who may change what", () => {
  it("an executive can change how members join: the name is saved first, then the mode, and only when it changed", async () => {
    fake.rpc("list_subgroup_roster").reply(ok([]));
    fake.rpc("update_subgroup").reply(ok(null));
    fake.rpc("set_subgroup_enrollment_mode").reply(ok(null));
    renderPeople();
    fireEvent.click(await screen.findByRole("button", { name: "Group settings" }));
    fireEvent.change(screen.getByLabelText("How members join"), { target: { value: "invite" } });
    fireEvent.submit(screen.getByLabelText("Name").closest("form")!);
    await waitFor(() => expect(fake.rpc("set_subgroup_enrollment_mode").count).toBe(1));
    expect(fake.rpc("set_subgroup_enrollment_mode").calls[0].payload).toEqual({ p_subgroup_id: 7, p_mode: "invite" });
    expect(fake.rpc("update_subgroup").calls[0].seq).toBeLessThan(fake.rpc("set_subgroup_enrollment_mode").calls[0].seq);
  });

  it("a group manager who is an ordinary member sees the mode but cannot change it, and saving never asks for the change", async () => {
    fake.rpc("list_subgroup_roster").reply(ok([]));
    fake.rpc("update_subgroup").reply(ok(null));
    renderPeople({ role: "member", myRole: "manager", isMember: true });
    fireEvent.click(await screen.findByRole("button", { name: "Group settings" }));
    expect(screen.queryByLabelText("How members join")).not.toBeInTheDocument();
    expect(screen.getByText(/Only executives can change this/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "＋ Add member" })).not.toBeInTheDocument();
    fireEvent.submit(screen.getByLabelText("Name").closest("form")!);
    await waitFor(() => expect(fake.rpc("update_subgroup").count).toBe(1));
    await flush();
    expect(fake.rpc("set_subgroup_enrollment_mode").count).toBe(0);
  });

  it("an ordinary member of the group sees neither the requests nor the settings", async () => {
    fake.rpc("list_subgroup_roster").reply(ok([person("u-dev", "Dev Nair", "pending"), person("u-me", "Asha Rao")]));
    renderPeople({ role: "member", myRole: "member", isMember: true });
    await screen.findByText("Asha Rao (you)");
    expect(screen.queryByText(/Requests to join/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Group settings" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();
  });
});

describe("the roster: only the newest load may replace it", () => {
  it("of two overlapping loads, the older answer arriving last is dropped", async () => {
    const older = deferred();
    fake.rpc("list_subgroup_roster")
      .replyOnce(fail("Network is down"))
      .replyOnce(older.reply)
      .reply(ok([person("u-new", "Fresh Member")]));
    renderPeople();
    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
    await waitFor(() => expect(fake.rpc("list_subgroup_roster").count).toBe(2));
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Fresh Member")).toBeInTheDocument();
    await act(async () => { older.resolve(ok([person("u-old", "Stale Member")])); });
    expect(screen.queryByText("Stale Member")).not.toBeInTheDocument();
    expect(screen.getByText("Fresh Member")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------------------------------------------
// The recordings list
// ---------------------------------------------------------------------------------------------------------------

const GROUPS = [{ id: 7, name: "Hindustani Vocal", description: "" }];
const MEMBERSHIPS = [{ subgroup_id: 7, status: "active" }];
const rec = (id: number, title: string, over: Record<string, unknown> = {}) => ({
  id, title, description: "", subgroup_id: 7, uploaded_by: "u-me", storage_path: `u-me/take-${id}.mp3`, mime_type: "audio/mpeg", media_kind: "audio",
  status: "published", audience: "subgroup", recording_kind: "practice", event_date: null, raga: null, tala: null, sruthi: null, tempo: null,
  duration_seconds: 95, created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z", published_at: "2026-10-01T00:00:00Z", ...over,
});

function renderRecordings(options: { canManage?: boolean; groups?: typeof GROUPS; memberships?: typeof MEMBERSHIPS } = {}) {
  const notify = notifySpy();
  const onDataChanged = vi.fn();
  // The shell makes the signed-in account the cache owner before a screen mounts.
  setCacheOwner("u-me");
  render(<RecordingWorkspace user={userOf("u-me")} groups={options.groups ?? GROUPS} memberships={options.memberships ?? MEMBERSHIPS} canManage={options.canManage ?? false} onDataChanged={onDataChanged} />);
  return { notify, onDataChanged };
}
const listReads = () => fake.from("recordings", "select");
const search = (text: string) => fireEvent.change(screen.getByLabelText("Search recordings"), { target: { value: text } });

describe("the recordings list: what it asks the server for", () => {
  it("one page of 24, newest first, published, with an exact count; Show more asks for the next 24", async () => {
    const rows = Array.from({ length: 24 }, (_, i) => rec(i + 1, `Take ${i + 1}`));
    listReads().reply(ok(rows, { count: 30 }));
    renderRecordings();
    expect(await screen.findByText("Take 1")).toBeInTheDocument();
    const first = listReads().calls[0];
    expect(first.used("select", "*", { count: "exact" })).toBe(true);
    expect(first.used("eq", "status", "published")).toBe(true);
    expect(first.uses("order")).toEqual([["created_at", { ascending: false }], ["id", { ascending: false }]]);
    expect(first.used("range", 0, 23)).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Show more (6 more)" }));
    await waitFor(() => expect(listReads().count).toBe(2));
    expect(listReads().calls[1].used("range", 0, 47)).toBe(true);
  });

  it("My drafts shows only the person's own drafts; Archived adds that limit unless the person can manage", async () => {
    listReads().reply(ok([], { count: 0 }));
    renderRecordings();
    await waitFor(() => expect(listReads().count).toBe(1));
    fireEvent.click(screen.getByRole("tab", { name: "My drafts" }));
    await waitFor(() => expect(listReads().count).toBe(2));
    expect(listReads().calls[1].used("eq", "status", "draft")).toBe(true);
    expect(listReads().calls[1].used("eq", "uploaded_by", "u-me")).toBe(true);
    fireEvent.click(screen.getByRole("tab", { name: "Archived" }));
    await waitFor(() => expect(listReads().count).toBe(3));
    expect(listReads().calls[2].used("eq", "status", "archived")).toBe(true);
    expect(listReads().calls[2].used("eq", "uploaded_by", "u-me")).toBe(true);
  });

  it("a manager sees every archived recording, not just their own", async () => {
    listReads().reply(ok([], { count: 0 }));
    renderRecordings({ canManage: true });
    await waitFor(() => expect(listReads().count).toBe(1));
    fireEvent.click(screen.getByRole("tab", { name: "Archived" }));
    await waitFor(() => expect(listReads().count).toBe(2));
    expect(listReads().calls[1].used("eq", "status", "archived")).toBe(true);
    expect(listReads().calls[1].uses("eq").some(([column]) => column === "uploaded_by")).toBe(false);
  });

  it("choosing a group narrows the list to it", async () => {
    listReads().reply(ok([], { count: 0 }));
    renderRecordings();
    await waitFor(() => expect(listReads().count).toBe(1));
    fireEvent.change(screen.getByLabelText("Group"), { target: { value: "7" } });
    await waitFor(() => expect(listReads().count).toBe(2));
    expect(listReads().calls[1].used("eq", "subgroup_id", 7)).toBe(true);
  });

  it("a search waits for the person to stop typing, then asks the server; characters that mean something in the filter are dropped", async () => {
    vi.useFakeTimers();
    listReads().reply(ok([], { count: 0 }));
    renderRecordings();
    await advance(1);
    expect(listReads().count).toBe(1);
    search("bhai,ra(vi)");
    await advance(200);
    expect(listReads().count).toBe(1);
    await advance(60);
    expect(listReads().count).toBe(2);
    const filter = listReads().calls[1].uses("or")[0][0] as string;
    expect(filter).toContain("title.ilike.%bhai ra vi%");
    expect(filter).toContain("raga.ilike.%bhai ra vi%");
    expect(filter).not.toMatch(/[()]/);
  });

  it("a search settling starts again from the first page, and spaces around the words are not a new search", async () => {
    vi.useFakeTimers();
    listReads().reply(ok(Array.from({ length: 24 }, (_, i) => rec(i + 1, `Take ${i + 1}`)), { count: 60 }));
    renderRecordings();
    await advance(1);
    expect(listReads().count).toBe(1);
    await advance(300);
    fireEvent.click(screen.getByRole("button", { name: "Show more (36 more)" }));
    await advance(1);
    expect(listReads().count).toBe(2);
    expect(listReads().calls[1].used("range", 0, 47)).toBe(true);
    search("raga");
    await advance(260);
    expect(listReads().count).toBe(3);
    expect(listReads().calls[2].used("range", 0, 23)).toBe(true);
    search("raga ");
    await advance(300);
    search(" raga ");
    await advance(300);
    expect(listReads().count).toBe(3);
  });

  it("someone with no active group is told to join one and cannot start a recording", async () => {
    renderRecordings({ memberships: [{ subgroup_id: 7, status: "pending" }] });
    expect(await screen.findByText("Join a subgroup to start recording")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "＋ New recording" })).toBeDisabled();
  });
});

describe("the recordings list: stale answers and failed loads", () => {
  it("of two searches, the older answer arriving last is dropped", async () => {
    vi.useFakeTimers();
    const older = deferred();
    listReads().replyOnce(ok([rec(1, "Raga warmup")], { count: 1 })).replyOnce(older.reply).reply(ok([rec(3, "Raga fresh")], { count: 1 }));
    renderRecordings();
    await advance(1);
    search("ra");
    await advance(260);
    expect(listReads().count).toBe(2);
    search("raga");
    await advance(260);
    expect(listReads().count).toBe(3);
    expect(screen.getByText("Raga fresh")).toBeInTheDocument();
    await act(async () => { older.resolve(ok([rec(2, "Raga stale")], { count: 1 })); });
    await advance(1);
    expect(screen.queryByText("Raga stale")).not.toBeInTheDocument();
    expect(screen.getByText("Raga fresh")).toBeInTheDocument();
  });

  it("a load that fails keeps the rows on screen, says the list may be out of date, and tries again on request", async () => {
    vi.useFakeTimers();
    listReads().replyOnce(ok([rec(1, "Raga warmup")], { count: 1 })).replyOnce(fail("boom")).reply(ok([rec(1, "Raga warmup"), rec(2, "Raga second")], { count: 2 }));
    const { notify } = renderRecordings();
    await advance(1);
    search("raga");
    await advance(260);
    expect(screen.getByText("Raga warmup")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("The list could not be refreshed, so it may be out of date.");
    expect(notify.find("The recordings workspace could not be loaded")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await advance(1);
    expect(screen.getByText("Raga second")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("a first load that fails says so instead of showing an empty-list message", async () => {
    listReads().reply(fail("boom"));
    renderRecordings();
    expect(await screen.findByRole("alert")).toHaveTextContent("The recordings could not be loaded.");
    expect(screen.queryByText("No published recordings in this view")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------------------------------------------
// The notation list in a recording's window
// ---------------------------------------------------------------------------------------------------------------

const note = (id: number, title: string, over: Record<string, unknown> = {}) =>
  ({ id, recording_id: 1, title, note_type: "text", body: `${title} body`, storage_path: null, mime_type: null, uploaded_by: "u-me", created_at: "2026-10-02T00:00:00Z", ...over });

async function openRecording(title: string) {
  fireEvent.click(await screen.findByRole("button", { name: new RegExp(title) }));
  await screen.findByText("Notation and notes");
}
async function editNote(index: number, newTitle: string) {
  const articles = screen.getAllByRole("article");
  fireEvent.click(within(articles[index]).getByRole("button", { name: "Edit" }));
  const form = screen.getByRole("heading", { name: "Edit notation" }).closest('[role="dialog"]')!.querySelector("form")!;
  fireEvent.change(within(form).getByLabelText("Title"), { target: { value: newTitle } });
  fireEvent.submit(form);
}

describe("the notation list: only the newest reload may replace it", () => {
  it("of two overlapping reloads after edits, the older answer arriving last is dropped", async () => {
    const older = deferred();
    listReads().reply(ok([rec(1, "Varnam take")], { count: 1 }));
    fake.from("recording_notes", "select")
      .replyOnce(ok([note(1, "Alap"), note(2, "Sargam")]))
      .replyOnce(older.reply)
      .reply(ok([note(1, "Alap"), note(2, "Sargam v2")]));
    fake.from("recording_notes", "update").reply(ok([{ id: 1 }]));
    renderRecordings();
    await openRecording("Varnam take");
    await screen.findByText("Sargam");
    await editNote(0, "Alap v2");
    await waitFor(() => expect(fake.from("recording_notes", "select").count).toBe(2));
    await editNote(1, "Sargam v2");
    expect(await screen.findByText("Sargam v2")).toBeInTheDocument();
    await act(async () => { older.resolve(ok([note(9, "Stale note")])); });
    expect(screen.queryByText("Stale note")).not.toBeInTheDocument();
    expect(screen.getByText("Sargam v2")).toBeInTheDocument();
  });

  it("a reload that fails keeps the notation already shown and says the list may be out of date", async () => {
    listReads().reply(ok([rec(1, "Varnam take")], { count: 1 }));
    fake.from("recording_notes", "select").replyOnce(ok([note(1, "Alap")])).reply(fail("boom"));
    fake.from("recording_notes", "update").reply(ok([{ id: 1 }]));
    const { notify } = renderRecordings();
    await openRecording("Varnam take");
    await screen.findByText("Alap");
    await editNote(0, "Alap v2");
    await waitFor(() => expect(fake.from("recording_notes", "select").count).toBe(2));
    await waitFor(() => expect(notify.find("The notation could not be refreshed, so the list may be out of date.").tone).toBe("error"));
    expect(screen.getByText("Alap")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------------------------------------------
// The recording studio: what it removes when a save fails part way
// ---------------------------------------------------------------------------------------------------------------

const TAKE = () => new File(["audio-bytes"], "take.mp3", { type: "audio/mpeg" });
const NOTATION = () => new File(["pdf-bytes"], "sargam.pdf", { type: "application/pdf" });

async function openStudioWithTake(options: { title?: string; notationText?: string; notationFile?: File } = {}) {
  fireEvent.click(await screen.findByRole("button", { name: "＋ New recording" }));
  const studio = await screen.findByRole("heading", { name: "Recording studio" });
  const dialog = studio.closest('[role="dialog"]') as HTMLElement;
  fireEvent.change(dialog.querySelector('input[type="file"]')!, { target: { files: [TAKE()] } });
  await within(dialog).findByText("take.mp3");
  fireEvent.change(within(dialog).getByLabelText("Title"), { target: { value: options.title ?? "Evening practice" } });
  if (options.notationText) fireEvent.change(within(dialog).getByLabelText("Notation text"), { target: { value: options.notationText } });
  if (options.notationFile) fireEvent.change(within(dialog).getByLabelText(/Notation file/), { target: { files: [options.notationFile] } });
  return { dialog, publish: () => fireEvent.click(within(dialog).getByRole("button", { name: "Publish to subgroup" })) };
}
const removed = (bucket: string) => fake.storage(bucket, "remove").calls;

describe("the recording studio: it removes only files that no saved row points at", () => {
  function scriptStudio() {
    listReads().reply(ok([], { count: 0 }));
    fake.from("recordings", "insert").reply(ok({ id: 41 }));
    fake.from("recording_notes", "insert").reply(ok(null));
  }

  it("a recording that saves puts the take in the recordings bucket under the person's folder and the group", async () => {
    scriptStudio();
    const { notify } = renderRecordings();
    const studio = await openStudioWithTake();
    studio.publish();
    await waitFor(() => expect(notify.find("Published to your subgroup")).toBeTruthy());
    const upload = fake.storage("recordings", "upload").calls[0];
    expect(upload.args[0]).toMatch(/^u-me\/subgroups\/7\/[0-9a-f-]{36}-take\.mp3$/);
    expect(fake.from("recordings", "insert").calls[0].payload).toMatchObject({ title: "Evening practice", subgroup_id: 7, storage_path: upload.args[0], status: "published", uploaded_by: "u-me" });
    expect(removed("recordings")).toHaveLength(0);
  });

  it("when the recording row cannot be saved, the take just uploaded is removed", async () => {
    scriptStudio();
    fake.from("recordings", "insert").reply(fail("That group is archived"));
    const { notify } = renderRecordings();
    const studio = await openStudioWithTake();
    studio.publish();
    await waitFor(() => expect(removed("recordings")).toHaveLength(1));
    expect(removed("recordings")[0].args[0]).toEqual([fake.storage("recordings", "upload").calls[0].args[0]]);
    expect(notify.find("That group is archived").tone).toBe("error");
    // The studio stays open for another try.
    expect(screen.getByRole("heading", { name: "Recording studio" })).toBeInTheDocument();
  });

  it("when the take cannot be removed either, the sentence says so and an administrator is named", async () => {
    scriptStudio();
    fake.from("recordings", "insert").reply(fail("That group is archived"));
    fake.storage("recordings", "remove").reply(ok([]));
    const { notify } = renderRecordings();
    const studio = await openStudioWithTake();
    studio.publish();
    await waitFor(() => expect(notify.toasts().length).toBeGreaterThan(0));
    const shown = notify.find(/That group is archived/);
    expect(shown.message).toContain("The uploaded take could not be removed from storage.");
    expect(shown.message).toContain("An administrator may need to clean up.");
    expect(shown.tone).toBe("error");
  });

  it("when only the notation text fails, the take is NOT removed: the recording exists and points at it", async () => {
    scriptStudio();
    fake.from("recording_notes", "insert").reply(fail("Notation is too long"));
    const { notify } = renderRecordings();
    const studio = await openStudioWithTake({ notationText: "S R G M" });
    studio.publish();
    await waitFor(() => expect(notify.find(/The recording was saved, but its notation could not be added/)).toBeTruthy());
    expect(notify.find(/The recording was saved/).message).toContain("Notation is too long");
    expect(notify.find(/The recording was saved/).tone).toBe("error");
    expect(removed("recordings")).toHaveLength(0);
    // The studio closes so a second save cannot make a duplicate, and the list is read again.
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Recording studio" })).not.toBeInTheDocument());
    await waitFor(() => expect(listReads().count).toBeGreaterThanOrEqual(2));
  });

  it("when the notation file was uploaded but its note could not be saved, only the notation file is removed", async () => {
    scriptStudio();
    fake.from("recording_notes", "insert").reply(fail("Notation is too long"));
    const { notify } = renderRecordings();
    const studio = await openStudioWithTake({ notationFile: NOTATION() });
    studio.publish();
    await waitFor(() => expect(removed("recording-notations")).toHaveLength(1));
    const notationPath = fake.storage("recording-notations", "upload").calls[0].args[0];
    expect(removed("recording-notations")[0].args[0]).toEqual([notationPath]);
    expect(removed("recordings")).toHaveLength(0);
    expect(notify.find(/The recording was saved/).tone).toBe("error");
  });

  it("when the notation file cannot be uploaded at all, the take stays and nothing is removed", async () => {
    scriptStudio();
    fake.storage("recording-notations", "upload").reply(fail("Bucket not found"));
    const { notify } = renderRecordings();
    const studio = await openStudioWithTake({ notationFile: NOTATION() });
    studio.publish();
    await waitFor(() => expect(notify.find(/The recording was saved, but its notation could not be added: Bucket not found/)).toBeTruthy());
    expect(removed("recordings")).toHaveLength(0);
    expect(removed("recording-notations")).toHaveLength(0);
  });

  it("when the take cannot be uploaded, nothing is saved and nothing is removed", async () => {
    scriptStudio();
    fake.storage("recordings", "upload").reply(fail("The object exceeded the maximum allowed size"));
    const { notify } = renderRecordings();
    const studio = await openStudioWithTake();
    studio.publish();
    await waitFor(() => expect(notify.find(/maximum allowed size/).tone).toBe("error"));
    expect(fake.from("recordings", "insert").count).toBe(0);
    expect(removed("recordings")).toHaveLength(0);
  });

  it("asks for a title, a group and a file before it sends anything", async () => {
    scriptStudio();
    const { notify } = renderRecordings();
    fireEvent.click(await screen.findByRole("button", { name: "＋ New recording" }));
    const dialog = (await screen.findByRole("heading", { name: "Recording studio" })).closest('[role="dialog"]') as HTMLElement;
    // No file yet: the save buttons are off.
    expect(within(dialog).getByRole("button", { name: "Publish to subgroup" })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "Save draft" })).toBeDisabled();
    expect(fake.storage("recordings", "upload").count).toBe(0);
    expect(notify.toasts()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Deleting a stored file: an empty answer from storage is not a success
// ---------------------------------------------------------------------------------------------------------------

const ARCHIVE_ITEM: ClubArchiveItem = {
  id: 11, title: "Spring concert", description: "", storage_path: "u-1/spring.mp4", visibility: "members", event_date: null, raga: null, tala: null,
  created_at: "2026-04-01T00:00:00Z", is_public: false, subgroup_id: null,
};

function renderManager(item: ClubArchiveItem = ARCHIVE_ITEM) {
  const notify = notifySpy();
  const onChanged = vi.fn();
  render(<ClubArchiveManager items={[item]} groups={[]} onAdd={vi.fn()} onChanged={onChanged} />);
  return { notify, onChanged };
}
async function confirmDelete(confirmLabel: string, openWith = "Delete") {
  fireEvent.click(screen.getByRole("button", { name: openWith }));
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: confirmLabel }));
}

describe("deleting a club recording: an empty answer from storage is not a success", () => {
  it("storage that removes nothing while the file still opens is a failure: say so, and keep the row", async () => {
    fake.from("recordings", "select").reply(ok([]));
    fake.storage("club-archive", "remove").reply(ok([]));
    const { notify, onChanged } = renderManager();
    await confirmDelete("Delete recording");
    await waitFor(() => expect(notify.find(FILE_NOT_DELETED).tone).toBe("error"));
    expect(fake.from("archive_items", "delete").count).toBe(0);
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("an empty answer for a file that is already gone (a retry after a half-finished delete) lets the row go", async () => {
    fake.from("recordings", "select").reply(ok([]));
    fake.storage("club-archive", "remove").reply(ok([]));
    fake.storage("club-archive", "createSignedUrl").reply(fail("Object not found"));
    fake.from("archive_items", "delete").reply(ok([{ id: 11 }]));
    const { notify, onChanged } = renderManager();
    await confirmDelete("Delete recording");
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(notify.find("Recording deleted").tone).not.toBe("error");
    expect(fake.from("archive_items", "delete").calls[0].used("eq", "id", 11)).toBe(true);
  });

  it("the file goes first, then the row", async () => {
    fake.from("recordings", "select").reply(ok([]));
    fake.from("archive_items", "delete").reply(ok([{ id: 11 }]));
    const { onChanged } = renderManager();
    await confirmDelete("Delete recording");
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(fake.storage("club-archive", "remove").calls[0].args[0]).toEqual(["u-1/spring.mp4"]);
    expect(fake.storage("club-archive", "remove").calls[0].seq).toBeLessThan(fake.from("archive_items", "delete").calls[0].seq);
  });

  it("a storage error is shown and the row is kept", async () => {
    fake.from("recordings", "select").reply(ok([]));
    fake.storage("club-archive", "remove").reply(fail("Storage is paused"));
    const { notify } = renderManager();
    await confirmDelete("Delete recording");
    await waitFor(() => expect(notify.find(/Storage is paused/).tone).toBe("error"));
    expect(fake.from("archive_items", "delete").count).toBe(0);
  });

  it("a dropped connection is shown as a failure too", async () => {
    fake.from("recordings", "select").reply(ok([]));
    fake.storage("club-archive", "remove").reply(rejects());
    const { notify } = renderManager();
    await confirmDelete("Delete recording");
    await waitFor(() => expect(notify.toasts().length).toBeGreaterThan(0));
    expect(notify.toasts()[0].tone).toBe("error");
    expect(fake.from("archive_items", "delete").count).toBe(0);
  });
});

describe("deleting a recording that a group plays", () => {
  it("is refused with the notice, and neither the file nor the row is touched", async () => {
    fake.from("recordings", "select").reply(ok([{ id: 5 }]));
    renderManager();
    await confirmDelete("Delete recording");
    expect(await screen.findByText("This recording is in a group's recording room")).toBeInTheDocument();
    expect(screen.getByText(/To take it off the public concert page, set its access to All club members/)).toBeInTheDocument();
    expect(screen.queryByText(/executives only/i)).not.toBeInTheDocument();
    expect(fake.from("recordings", "select").calls[0].used("eq", "storage_path", "u-1/spring.mp4")).toBe(true);
    expect(fake.storage("club-archive", "remove").count).toBe(0);
    expect(fake.from("archive_items", "delete").count).toBe(0);
  });

  it("a failed check is shown and nothing is deleted", async () => {
    fake.from("recordings", "select").reply(fail("Could not check"));
    const { notify } = renderManager();
    await confirmDelete("Delete recording");
    await waitFor(() => expect(notify.find("Could not check").tone).toBe("error"));
    expect(fake.storage("club-archive", "remove").count).toBe(0);
  });
});

describe("lowering a shared recording to Executives only is refused", () => {
  async function submitAccess(access: string) {
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(await screen.findByLabelText("Who can access this?"), { target: { value: access } });
    fireEvent.submit(screen.getByLabelText("Title").closest("form")!);
  }

  it("a file a group still plays: the notice, and no update", async () => {
    fake.from("recordings", "select").reply(ok([{ id: 5 }]));
    renderManager();
    await submitAccess("executives");
    const message = await screen.findByRole("alert");
    expect(message).toHaveTextContent("This file also plays in a group's recording room.");
    expect(message).toHaveTextContent("nothing was saved");
    expect(fake.from("archive_items", "update").count).toBe(0);
  });

  it("a file no group plays can be limited to executives", async () => {
    fake.from("recordings", "select").reply(ok([]));
    fake.from("archive_items", "update").reply(ok([{ id: 11 }]));
    const { notify, onChanged } = renderManager();
    await submitAccess("executives");
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(fake.from("archive_items", "update").calls[0].payload).toMatchObject({ visibility: "executives", is_public: false });
    expect(notify.find("Recording updated").tone).not.toBe("error");
  });

  it("other changes never need the check: taking a shared file off the public page does not read the recording room", async () => {
    fake.from("archive_items", "update").reply(ok([{ id: 11 }]));
    const { onChanged } = renderManager({ ...ARCHIVE_ITEM, is_public: true });
    await submitAccess("members");
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(fake.from("recordings", "select").count).toBe(0);
    expect(fake.from("archive_items", "update").calls[0].payload).toMatchObject({ visibility: "members", is_public: false });
  });

  it("a failed check is shown in the dialog and nothing is saved", async () => {
    fake.from("recordings", "select").reply(fail("Could not check"));
    renderManager();
    await submitAccess("executives");
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not check");
    expect(fake.from("archive_items", "update").count).toBe(0);
  });
});

const RESOURCE: ManagedResource = {
  id: 4, node_kind: "file", title: "Syllabus.pdf", description: "", parent_id: null, visibility: "members",
  storage_bucket: null, storage_path: "club/syllabus.pdf", external_url: null, status: "ready", is_pinned: false,
};
function renderActions(item: Partial<ManagedResource> = {}, props: { childCount?: number } = {}) {
  const notify = notifySpy();
  const onChanged = vi.fn();
  const onRemoved = vi.fn();
  render(<ResourceActions item={{ ...RESOURCE, ...item }} canManage isExecutive childCount={props.childCount ?? 0} onChanged={onChanged} onRemoved={onRemoved} />);
  return { notify, onChanged, onRemoved };
}

describe("deleting a library file: an empty answer from storage is not a success", () => {
  it("storage that removes nothing while the file still opens is a failure: say so, and keep the row", async () => {
    fake.storage("club-resources", "remove").reply(ok([]));
    const { notify, onRemoved } = renderActions();
    await confirmDelete("Delete");
    await waitFor(() => expect(notify.find(FILE_NOT_DELETED).tone).toBe("error"));
    expect(fake.from("resources", "delete").count).toBe(0);
    expect(onRemoved).not.toHaveBeenCalled();
  });

  it("a file already gone lets the row go; the file is removed first, from the bucket the row names", async () => {
    fake.storage("club-finance-docs", "remove").reply(ok([]));
    fake.storage("club-finance-docs", "createSignedUrl").reply(fail("Object not found"));
    fake.from("resources", "delete").reply(ok([{ id: 4 }]));
    const { notify, onRemoved } = renderActions({ storage_bucket: "club-finance-docs" });
    await confirmDelete("Delete");
    await waitFor(() => expect(onRemoved).toHaveBeenCalledTimes(1));
    expect(fake.storage("club-finance-docs", "remove").calls[0].args[0]).toEqual(["club/syllabus.pdf"]);
    expect(fake.storage("club-finance-docs", "remove").calls[0].seq).toBeLessThan(fake.from("resources", "delete").calls[0].seq);
    expect(notify.find("The file was deleted").tone).not.toBe("error");
  });

  it("a link has no file to remove: only the row is deleted", async () => {
    fake.from("resources", "delete").reply(ok([{ id: 4 }]));
    const { onRemoved } = renderActions({ node_kind: "link", storage_path: null, external_url: "https://example.org" });
    await confirmDelete("Delete");
    await waitFor(() => expect(onRemoved).toHaveBeenCalled());
    expect(fake.storage("*", "remove").count).toBe(0);
  });

  it("an upload that never finished is discarded the same way", async () => {
    fake.storage("club-resources", "remove").reply(ok([]));
    const { notify } = renderActions({ status: "failed" });
    await confirmDelete("Discard", "Discard upload");
    await waitFor(() => expect(notify.find(FILE_NOT_DELETED).tone).toBe("error"));
    expect(fake.from("resources", "delete").count).toBe(0);
  });
});

const MANAGED: ManagedRecording = {
  id: 1, title: "Varnam take", description: "", uploaded_by: "u-me", storage_path: "u-me/take.mp3", status: "published", recording_kind: "practice",
  raga: null, tala: null, sruthi: null, tempo: null,
};
const MANAGED_NOTE: ManagedNote = { id: 3, recording_id: 1, title: "Sargam", note_type: "file", body: "", storage_path: "u-me/sargam.pdf", mime_type: "application/pdf", uploaded_by: "u-me" };

function renderManageBar(recording: Partial<ManagedRecording> = {}, notes: ManagedNote[] = [MANAGED_NOTE]) {
  const notify = notifySpy();
  const onChanged = vi.fn();
  const onRemoved = vi.fn();
  render(<RecordingManageBar recording={{ ...MANAGED, ...recording }} user={userOf("u-me")} canManage={false} notes={notes} onChanged={onChanged} onRemoved={onRemoved} />);
  return { notify, onChanged, onRemoved };
}

describe("deleting a recording: notation files, then the take, then the row", () => {
  it("removes the files in that order and only then the row", async () => {
    fake.from("recordings", "delete").reply(ok([{ id: 1 }]));
    const { notify, onRemoved } = renderManageBar();
    await confirmDelete("Delete recording");
    await waitFor(() => expect(onRemoved).toHaveBeenCalledTimes(1));
    const [notation] = fake.storage("recording-notations", "remove").calls;
    const [take] = fake.storage("recordings", "remove").calls;
    expect(notation.args[0]).toEqual(["u-me/sargam.pdf"]);
    expect(take.args[0]).toEqual(["u-me/take.mp3"]);
    expect(notation.seq).toBeLessThan(take.seq);
    expect(take.seq).toBeLessThan(fake.from("recordings", "delete").calls[0].seq);
    expect(notify.find("Recording deleted").tone).not.toBe("error");
  });

  it("a notation file that storage will not delete stops everything: the take and the row are kept", async () => {
    fake.storage("recording-notations", "remove").reply(ok([]));
    const { notify, onRemoved } = renderManageBar();
    await confirmDelete("Delete recording");
    await waitFor(() => expect(notify.find(FILE_NOT_DELETED).tone).toBe("error"));
    expect(fake.storage("recordings", "remove").count).toBe(0);
    expect(fake.from("recordings", "delete").count).toBe(0);
    expect(onRemoved).not.toHaveBeenCalled();
  });

  it("a take that storage will not delete keeps the row", async () => {
    fake.storage("recordings", "remove").reply(ok([]));
    const { notify } = renderManageBar();
    await confirmDelete("Delete recording");
    await waitFor(() => expect(notify.find(FILE_NOT_DELETED).tone).toBe("error"));
    expect(fake.from("recordings", "delete").count).toBe(0);
  });

  it("a file that is already gone (a retry) does not block the delete", async () => {
    fake.storage("recording-notations", "remove").reply(ok([]));
    fake.storage("recording-notations", "createSignedUrl").reply(fail("Object not found"));
    fake.from("recordings", "delete").reply(ok([{ id: 1 }]));
    const { onRemoved } = renderManageBar();
    await confirmDelete("Delete recording");
    await waitFor(() => expect(onRemoved).toHaveBeenCalled());
  });

  it("a recording that shares a file with the club archive cannot be deleted from here", () => {
    renderManageBar({ storage_bucket: "club-archive" });
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Archive" })).toBeInTheDocument();
  });

  it("a person who neither made the recording nor manages recordings sees no controls", () => {
    renderManageBar({ uploaded_by: "someone-else" });
    expect(screen.queryByRole("button", { name: "Edit details" })).not.toBeInTheDocument();
  });
});

describe("deleting a notation item", () => {
  function renderNote(item: Partial<ManagedNote> = {}) {
    const notify = notifySpy();
    const onChanged = vi.fn();
    render(<NoteActions note={{ ...MANAGED_NOTE, ...item }} user={userOf("u-me")} canManage={false} onChanged={onChanged} />);
    return { notify, onChanged };
  }

  it("a notation file that storage will not delete keeps the note", async () => {
    fake.storage("recording-notations", "remove").reply(ok([]));
    const { notify, onChanged } = renderNote();
    await confirmDelete("Delete");
    await waitFor(() => expect(notify.find(FILE_NOT_DELETED).tone).toBe("error"));
    expect(fake.from("recording_notes", "delete").count).toBe(0);
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("a text note has no file: only the row is deleted", async () => {
    fake.from("recording_notes", "delete").reply(ok([{ id: 3 }]));
    const { notify, onChanged } = renderNote({ note_type: "text", storage_path: null, body: "S R G M" });
    await confirmDelete("Delete");
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(fake.storage("*", "remove").count).toBe(0);
    expect(notify.find("Notation deleted").tone).not.toBe("error");
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Adding a club recording from the Recordings page (the form lives in the shell)
// ---------------------------------------------------------------------------------------------------------------

describe("adding a club recording: the uploaded file is an orphan when its row cannot be saved", () => {
  async function fillAndSave() {
    openPortal({ role: "executive", page: "recordings" });
    fireEvent.click(await screen.findByRole("button", { name: "＋ Add club recording" }));
    const form = (await screen.findByRole("heading", { name: "Add a club recording" })).closest("form")!;
    fireEvent.change(within(form).getByLabelText("Title"), { target: { value: "Spring concert" } });
    fireEvent.change(within(form).getByLabelText("Choose file"), { target: { files: [new File(["bytes"], "spring concert.mp4", { type: "video/mp4" })] } });
    fireEvent.submit(form);
  }

  it("a saved recording uploads the file to the club archive, then adds the row pointing at it", async () => {
    fake.from("archive_items", "insert").reply(ok(null));
    await fillAndSave();
    await waitFor(() => expect(fake.from("archive_items", "insert").count).toBe(1));
    const path = fake.storage("club-archive", "upload").calls[0].args[0] as string;
    expect(path).toMatch(/^u-me\/[0-9a-f-]{36}-spring-concert\.mp4$/);
    expect(fake.from("archive_items", "insert").calls[0].payload).toMatchObject({ title: "Spring concert", storage_path: path, uploaded_by: "u-me", visibility: "members", is_public: false });
    expect(fake.storage("club-archive", "remove").count).toBe(0);
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Add a club recording" })).not.toBeInTheDocument());
  });

  it("when the row cannot be saved the file is removed, and the person is told why", async () => {
    fake.from("archive_items", "insert").reply(fail("Only executives can add club recordings"));
    await fillAndSave();
    const shown = await screen.findByText(/Only executives can add club recordings/);
    expect(shown).toHaveAttribute("role", "alert");
    expect(fake.storage("club-archive", "remove").calls).toHaveLength(1);
    expect(fake.storage("club-archive", "remove").calls[0].args[0]).toEqual([fake.storage("club-archive", "upload").calls[0].args[0]]);
  });

  it("when the file cannot be removed either, the person is told to ask an administrator", async () => {
    fake.from("archive_items", "insert").reply(fail("Only executives can add club recordings"));
    fake.storage("club-archive", "remove").reply(ok([]));
    await fillAndSave();
    const shown = await screen.findByText(/Ask an administrator to delete it/);
    expect(shown).toHaveTextContent("The recording could not be saved, and its uploaded file could not be removed.");
    expect(shown).toHaveAttribute("role", "alert");
  });

  it("when the upload itself fails, no row is added and nothing is removed", async () => {
    fake.storage("club-archive", "upload").reply(fail("The object exceeded the maximum allowed size"));
    await fillAndSave();
    expect(await screen.findByText(/maximum allowed size/)).toHaveAttribute("role", "alert");
    expect(fake.from("archive_items", "insert").count).toBe(0);
    expect(fake.storage("club-archive", "remove").count).toBe(0);
  });
});
