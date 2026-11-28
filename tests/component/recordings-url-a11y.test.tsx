// Phase 3 on the recordings area, second half: what is kept in the address (the view, the group, the search, the recording that is open),
// the states of a first read (waiting, failed), the keyboard and screen-reader side of the controls, a button pressed twice, and axe on
// every screen and dialog.
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClubArchiveManager } from "../../features/recordings/components/club-archive-manager";
import { RecordingManageBar, type ManagedRecording } from "../../features/recordings/components/recording-manage";
import { RecordingWorkspace } from "../../features/recordings/components/recording-workspace";
import { ArchiveModal } from "../../features/recordings/components/archive-modal";
import { setCacheOwner } from "../../lib/cache";
import type { ClubArchiveItem } from "../../lib/db";
import { expectNoSeriousViolations } from "../support/a11y";
import { notifySpy, userOf } from "../support/helpers";
import { deferred, fail, fake, ok } from "../support/fake-supabase";
import { focusedName, keyboardUser, tabOrder } from "../support/keyboard";
import { routeUploadsToFakeClient } from "./content-uploads";

beforeEach(() => { routeUploadsToFakeClient(); });

vi.mock("wavesurfer.js", () => ({ default: { create: () => ({ on: () => {}, destroy: () => {}, getDuration: () => 0, getCurrentTime: () => 0, setTime: () => {}, setPlaybackRate: () => {}, playPause: () => {} }) } }));
vi.mock("tone", () => ({ start: async () => {}, Transport: { clear: () => {}, stop: () => {}, start: () => {}, scheduleRepeat: () => 1 }, Synth: class { volume = { value: 0 }; toDestination() { return this; } triggerAttackRelease() {} triggerRelease() {} dispose() {} } }));

const GROUPS = [{ id: 7, name: "Hindustani Vocal", description: "" }, { id: 8, name: "Carnatic Violin", description: "" }];
const MEMBERSHIPS = [{ subgroup_id: 7, status: "active" }, { subgroup_id: 8, status: "active" }];
const rec = (id: number, title: string, over: Record<string, unknown> = {}) => ({
  id, title, description: "", subgroup_id: 7, uploaded_by: "u-me", storage_path: `u-me/take-${id}.mp3`, mime_type: "audio/mpeg", media_kind: "audio",
  status: "published", audience: "subgroup", recording_kind: "practice", event_date: null, raga: null, tala: null, sruthi: null, tempo: null,
  duration_seconds: 95, created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z", published_at: "2026-10-01T00:00:00Z", ...over,
});
const note = (id: number, title: string, over: Record<string, unknown> = {}) =>
  ({ id, recording_id: 1, title, note_type: "text", body: `${title} body`, storage_path: null, mime_type: null, uploaded_by: "u-me", created_at: "2026-10-02T00:00:00Z", ...over });
const listReads = () => fake.from("recordings", "select");

function renderRecordings(props: { initialScope?: "all" | number; address?: string } = {}) {
  if (props.address) window.history.replaceState({}, "", props.address);
  const notify = notifySpy();
  setCacheOwner("u-me");
  const view = render(<RecordingWorkspace user={userOf("u-me")} groups={GROUPS} memberships={MEMBERSHIPS} canManage={false} initialScope={props.initialScope} onDataChanged={vi.fn()} />);
  return { notify, ...view };
}
const params = () => new URLSearchParams(window.location.search);
const goBack = async () => { await act(async () => { window.history.back(); await new Promise((resolve) => setTimeout(resolve, 10)); }); };

// ---------------------------------------------------------------------------------------------------------------
// The address
// ---------------------------------------------------------------------------------------------------------------

describe("the view, the group and the search are in the address", () => {
  it("a link with ?view=drafts opens My drafts, and the list is read for drafts", async () => {
    listReads().reply(ok([rec(2, "A draft", { status: "draft" })], { count: 1 }));
    renderRecordings({ address: "/?page=recordings&view=drafts" });
    expect(await screen.findByRole("button", { name: /A draft/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "My drafts" })).toHaveAttribute("aria-selected", "true");
    expect(listReads().calls[0].used("eq", "status", "draft")).toBe(true);
  });

  it("a view that does not exist is the usual view, and the address is left alone", async () => {
    listReads().reply(ok([rec(1, "Varnam")], { count: 1 }));
    renderRecordings({ address: "/?page=recordings&view=zzz&group=banana" });
    await screen.findByRole("button", { name: /Varnam/ });
    expect(screen.getByRole("tab", { name: "Published" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByLabelText("Group")).toHaveValue("all");
    expect(window.location.search).toBe("?page=recordings&view=zzz&group=banana");
  });

  it("choosing a view adds a history entry that Back undoes; the usual view takes the parameter away", async () => {
    listReads().reply(ok([rec(1, "Varnam")], { count: 1 }));
    renderRecordings({ address: "/?page=recordings" });
    await screen.findByRole("button", { name: /Varnam/ });
    const before = window.history.length;
    fireEvent.click(screen.getByRole("tab", { name: "Archived" }));
    await waitFor(() => expect(params().get("view")).toBe("archived"));
    expect(params().get("page")).toBe("recordings");
    expect(window.history.length).toBe(before + 1);
    expect(screen.getByRole("tab", { name: "Archived" })).toHaveAttribute("aria-selected", "true");
    await goBack();
    await waitFor(() => expect(screen.getByRole("tab", { name: "Published" })).toHaveAttribute("aria-selected", "true"));
    expect(params().has("view")).toBe(false);
  });

  it("a link with ?group= opens that group; a group the person is not in is the usual group; choosing one writes it and Back returns", async () => {
    listReads().reply(ok([rec(3, "Violin take", { subgroup_id: 8 })], { count: 1 }));
    renderRecordings({ address: "/?page=recordings&group=8" });
    await screen.findByRole("button", { name: /Violin take/ });
    expect(screen.getByLabelText("Group")).toHaveValue("8");
    expect(listReads().calls[0].used("eq", "subgroup_id", 8)).toBe(true);
    fireEvent.change(screen.getByLabelText("Group"), { target: { value: "7" } });
    await waitFor(() => expect(params().get("group")).toBe("7"));
    await goBack();
    await waitFor(() => expect(screen.getByLabelText("Group")).toHaveValue("8"));
  });

  it("a group that is not one of the person's is the usual one, whatever the link says", async () => {
    listReads().reply(ok([rec(1, "Varnam")], { count: 1 }));
    renderRecordings({ address: "/?page=recordings&group=999" });
    await screen.findByRole("button", { name: /Varnam/ });
    expect(screen.getByLabelText("Group")).toHaveValue("all");
    expect(listReads().calls.every((call) => !call.used("eq", "subgroup_id", 999))).toBe(true);
  });

  it("a group a link from another page asked for is the usual one; choosing All my groups is written as ?group=all", async () => {
    listReads().reply(ok([rec(1, "Varnam")], { count: 1 }));
    renderRecordings({ address: "/?page=recordings", initialScope: 7 });
    await screen.findByRole("button", { name: /Varnam/ });
    expect(screen.getByLabelText("Group")).toHaveValue("7");
    expect(params().has("group")).toBe(false);
    fireEvent.change(screen.getByLabelText("Group"), { target: { value: "all" } });
    await waitFor(() => expect(params().get("group")).toBe("all"));
    expect(screen.getByLabelText("Group")).toHaveValue("all");
  });

  it("the search box starts from ?q=, sends it, and typing replaces the address instead of adding an entry for every letter", async () => {
    listReads().reply(ok([rec(1, "Bhairavi alap")], { count: 1 }));
    renderRecordings({ address: "/?page=recordings&q=bhairavi" });
    await screen.findByRole("button", { name: /Bhairavi alap/ });
    const box = screen.getByLabelText("Search recordings");
    expect(box).toHaveValue("bhairavi");
    expect(listReads().calls[0].used("or", "title.ilike.%bhairavi%,description.ilike.%bhairavi%,raga.ilike.%bhairavi%,tala.ilike.%bhairavi%,recording_kind.ilike.%bhairavi%")).toBe(true);
    const before = window.history.length;
    fireEvent.change(box, { target: { value: "y" } });
    fireEvent.change(box, { target: { value: "yaman" } });
    await waitFor(() => expect(params().get("q")).toBe("yaman"));
    expect(window.history.length).toBe(before);
    expect(box).toHaveValue("yaman");
    fireEvent.change(box, { target: { value: "" } });
    await waitFor(() => expect(params().has("q")).toBe(false));
  });

  it("the page shows its own state when the address changes by Back or Forward: the box follows ?q=", async () => {
    listReads().reply(ok([rec(1, "Varnam")], { count: 1 }));
    renderRecordings({ address: "/?page=recordings" });
    await screen.findByRole("button", { name: /Varnam/ });
    act(() => { window.history.pushState({}, "", "/?page=recordings&q=todi"); window.dispatchEvent(new PopStateEvent("popstate")); });
    await waitFor(() => expect(screen.getByLabelText("Search recordings")).toHaveValue("todi"));
  });
});

describe("the recording that is open is in the address", () => {
  it("opening a recording writes ?recording=<id> (Back closes it); closing replaces the entry, so Back does not reopen it", async () => {
    listReads().reply(ok([rec(1, "Varnam")], { count: 1 }));
    fake.from("recording_notes", "select").reply(ok([]));
    renderRecordings({ address: "/?page=recordings" });
    fireEvent.click(await screen.findByRole("button", { name: /Varnam/ }));
    await screen.findByRole("dialog", { name: "Varnam" });
    expect(params().get("recording")).toBe("1");
    const opened = window.history.length;
    await goBack();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(params().has("recording")).toBe(false);
    // Open again and close with the button: the address no longer names it, and no entry was added by closing.
    fireEvent.click(screen.getByRole("button", { name: /Varnam/ }));
    await screen.findByRole("dialog", { name: "Varnam" });
    const length = window.history.length;
    fireEvent.click(screen.getByRole("button", { name: "Close recording" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(params().has("recording")).toBe(false);
    expect(window.history.length).toBe(length);
    expect(opened).toBeGreaterThan(0);
  });

  it("a link to a recording that is in the list opens it", async () => {
    listReads().reply(ok([rec(1, "Varnam"), rec(2, "Todi alap")], { count: 2 }));
    fake.from("recording_notes", "select").reply(ok([]));
    renderRecordings({ address: "/?page=recordings&recording=2" });
    expect(await screen.findByRole("dialog", { name: "Todi alap" })).toBeInTheDocument();
  });

  it("a link to a recording that the list does not hold reads it on its own and opens it", async () => {
    listReads().replyOnce(ok([], { count: 0 })).reply(ok(rec(5, "Linked take")));
    fake.from("recording_notes", "select").reply(ok([]));
    renderRecordings({ address: "/?page=recordings&recording=5" });
    expect(await screen.findByRole("dialog", { name: "Linked take" })).toBeInTheDocument();
    expect(listReads().calls[1].used("eq", "id", 5)).toBe(true);
  });

  it("an id nobody has opens nothing, says so, and is taken out of the address without a history entry (Back is not trapped)", async () => {
    listReads().replyOnce(ok([], { count: 0 })).reply(ok(null));
    const { notify } = renderRecordings({ address: "/?page=recordings&recording=404" });
    await waitFor(() => expect(notify.find("That recording could not be found")).toBeTruthy());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(params().has("recording")).toBe(false));
    expect(params().get("page")).toBe("recordings");
  });

  it("an id that is not a number is ignored", async () => {
    listReads().reply(ok([rec(1, "Varnam")], { count: 1 }));
    renderRecordings({ address: "/?page=recordings&recording=abc" });
    await screen.findByRole("button", { name: /Varnam/ });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(window.location.search).toBe("?page=recordings&recording=abc");
  });
});

// ---------------------------------------------------------------------------------------------------------------
// A first read: waiting, and failed
// ---------------------------------------------------------------------------------------------------------------

describe("the first read of the list", () => {
  it("shows a skeleton and says it is loading while it waits; no empty state before the answer", async () => {
    const slow = deferred();
    listReads().reply(slow.reply);
    renderRecordings();
    expect(await screen.findByRole("status", { name: "" })).toBeInTheDocument();
    expect(screen.getByText("Loading recordings")).toBeInTheDocument();
    expect(document.querySelectorAll(".skeleton-row")).toHaveLength(3);
    expect(screen.queryByText("No published recordings in this view")).not.toBeInTheDocument();
    await act(async () => { slow.resolve(ok([rec(1, "Varnam")], { count: 1 })); });
    expect(await screen.findByRole("button", { name: /Varnam/ })).toBeInTheDocument();
    expect(document.querySelectorAll(".skeleton-row")).toHaveLength(0);
  });

  it("a read that failed says so with Try again; it is not the empty state, and Try again reads it again", async () => {
    listReads().replyOnce(fail("boom")).reply(ok([rec(1, "Varnam")], { count: 1 }));
    renderRecordings();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("The recordings could not be loaded.");
    expect(screen.queryByText("No published recordings in this view")).not.toBeInTheDocument();
    fireEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("button", { name: /Varnam/ })).toBeInTheDocument();
    expect(screen.queryByText("The recordings could not be loaded.")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------------------------------------------
// The keyboard and a screen reader
// ---------------------------------------------------------------------------------------------------------------

describe("the view tabs are one stop for the keyboard, and the arrow keys move between them", () => {
  it("only the selected tab is in the Tab order; arrows, Home and End select and move focus; each tab names its panel", async () => {
    listReads().reply(ok([rec(1, "Varnam")], { count: 1 }));
    renderRecordings({ address: "/?page=recordings" });
    await screen.findByRole("button", { name: /Varnam/ });
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((tab) => tab.tabIndex)).toEqual([0, -1, -1]);
    tabs[0].focus();
    // The selection is in the address, which is written a moment after the key: each step waits for it.
    const press = async (key: string, expected: string) => {
      fireEvent.keyDown(document.activeElement!, { key });
      expect(document.activeElement).toBe(screen.getByRole("tab", { name: expected }));
      await waitFor(() => expect(screen.getByRole("tab", { name: expected })).toHaveAttribute("aria-selected", "true"));
    };
    await press("ArrowRight", "My drafts");
    await press("End", "Archived");
    await press("ArrowRight", "Published");
    await press("ArrowLeft", "Archived");
    await press("Home", "Published");
    const panel = screen.getByRole("tabpanel");
    expect(panel).toHaveAttribute("aria-labelledby", screen.getByRole("tab", { name: "Published" }).id);
    expect(screen.getByRole("tab", { name: "Published" })).toHaveAttribute("aria-controls", panel.id);
  });
});

type Recorder = { state: string; mimeType: string; ondataavailable: ((event: { data: Blob }) => void) | null; onstop: (() => void) | null; start(): void; stop(): void };
class FakeRecorder implements Recorder {
  static isTypeSupported = () => true;
  state = "inactive";
  mimeType = "audio/webm";
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  start() { this.state = "recording"; }
  stop() { this.state = "inactive"; this.ondataavailable?.({ data: new Blob(["sound"]) }); this.onstop?.(); }
}
afterEach(() => { Reflect.deleteProperty(navigator, "mediaDevices"); });

async function openStudio() {
  fireEvent.click(await screen.findByRole("button", { name: "＋ New recording" }));
  const dialog = await screen.findByRole("dialog", { name: "Recording studio" });
  return { dialog, inside: within(dialog) };
}

describe("the studio controls for a keyboard and a screen reader", () => {
  it("the source tabs are one stop and the arrows change the source", async () => {
    listReads().reply(ok([], { count: 0 }));
    renderRecordings();
    const { inside } = await openStudio();
    const tabs = inside.getAllByRole("tab");
    expect(tabs.map((tab) => tab.tabIndex)).toEqual([0, -1, -1]);
    tabs[0].focus();
    fireEvent.keyDown(tabs[0], { key: "ArrowRight" });
    expect(inside.getByRole("tab", { name: "Record audio" })).toHaveAttribute("aria-selected", "true");
    expect(inside.getByRole("tabpanel")).toHaveAttribute("aria-labelledby", inside.getByRole("tab", { name: "Record audio" }).id);
  });

  it("the record buttons are named by their words (the ● and ■ are not read), the recording is announced when it starts and when it stops, and the other sources cannot be chosen meanwhile", async () => {
    listReads().reply(ok([], { count: 0 }));
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: async () => ({ getTracks: () => [{ stop: vi.fn() }] }) } });
    vi.stubGlobal("MediaRecorder", FakeRecorder);
    renderRecordings();
    const { inside } = await openStudio();
    fireEvent.click(inside.getByRole("tab", { name: "Record audio" }));
    await act(async () => { fireEvent.click(inside.getByRole("button", { name: "Start recording" })); });
    expect(await inside.findByRole("button", { name: "Stop recording" })).toBeInTheDocument();
    expect(inside.getByRole("status", { name: "" })).toBeInTheDocument();
    expect(inside.getByText("Audio recording started")).toHaveAttribute("role", "status");
    expect(inside.getByText(/^Recording [—0-9]/)).toBeInTheDocument();
    // Locked: another source cannot be chosen (a click, or an arrow key) while it records.
    expect(inside.getByRole("tab", { name: "Upload file" })).toBeDisabled();
    fireEvent.keyDown(inside.getByRole("tab", { name: "Record audio" }), { key: "ArrowRight" });
    expect(inside.getByRole("tab", { name: "Record audio" })).toHaveAttribute("aria-selected", "true");
    await act(async () => { fireEvent.click(inside.getByRole("button", { name: "Stop recording" })); });
    expect(await inside.findByText(/^Recording stopped after \d+ seconds?\. The take is ready to preview\.$/)).toHaveAttribute("role", "status");
    expect(inside.getByRole("tab", { name: "Upload file" })).toBeEnabled();
  });

  it("a draft whose take cannot be signed says so with Try again, instead of an empty drop area", async () => {
    listReads().reply(ok([rec(2, "Half done", { status: "draft" })], { count: 1 }));
    fake.storage("recordings", "createSignedUrl").replyOnce(fail("Object not found"));
    renderRecordings({ address: "/?page=recordings&view=drafts" });
    fireEvent.click(await screen.findByRole("button", { name: /Half done/ }));
    const dialog = await screen.findByRole("dialog", { name: "Finish this recording" });
    const alert = await within(dialog).findByText("Your saved take could not be loaded.");
    fireEvent.click(within(alert.parentElement as HTMLElement).getByRole("button", { name: "Try again" }));
    expect(await within(dialog).findByText("Saved draft preview")).toBeInTheDocument();
    expect(within(dialog).queryByText("Your saved take could not be loaded.")).not.toBeInTheDocument();
  });
});

describe("the main flow with the keyboard alone", () => {
  it("Tab reaches New recording; Enter opens the studio with focus inside; Escape closes it and focus goes back", async () => {
    listReads().reply(ok([rec(1, "Varnam")], { count: 1 }));
    renderRecordings();
    await screen.findByRole("button", { name: /Varnam/ });
    const user = keyboardUser();
    const names = await tabOrder(user, 6);
    expect(names).toContain("＋ New recording");
    while (focusedName() !== "＋ New recording") await user.tab();
    await user.keyboard("{Enter}");
    const dialog = await screen.findByRole("dialog", { name: "Recording studio" });
    expect(dialog.contains(document.activeElement)).toBe(true);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(focusedName()).toBe("＋ New recording");
  });

  it("a card opens its recording with Enter; Escape closes it and focus returns to the card", async () => {
    listReads().reply(ok([rec(1, "Varnam")], { count: 1 }));
    fake.from("recording_notes", "select").reply(ok([note(1, "Alap")]));
    renderRecordings();
    const card = await screen.findByRole("button", { name: /Varnam/ });
    card.focus();
    const user = keyboardUser();
    await user.keyboard("{Enter}");
    const dialog = await screen.findByRole("dialog", { name: "Varnam" });
    expect(dialog.contains(document.activeElement)).toBe(true);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(document.activeElement).toBe(screen.getByRole("button", { name: /Varnam/ }));
  });
});

// ---------------------------------------------------------------------------------------------------------------
// A button pressed twice
// ---------------------------------------------------------------------------------------------------------------

const MANAGED: ManagedRecording = {
  id: 1, title: "Varnam take", description: "", uploaded_by: "u-me", storage_path: "u-me/take.mp3", status: "published", recording_kind: "practice",
  raga: null, tala: null, sruthi: null, tempo: null,
};
const ITEM: ClubArchiveItem = {
  id: 11, title: "Spring concert", description: "", storage_path: "u-1/spring.mp4", visibility: "members", event_date: null, raga: null, tala: null,
  created_at: "2026-04-01T00:00:00Z", is_public: false, subgroup_id: null,
};
const confirmButton = (name: string) => within(screen.getByRole("dialog")).getByRole("button", { name });

describe("a change pressed twice at once is sent once", () => {
  it("the recording's Delete confirmation", async () => {
    fake.from("recordings", "delete").reply(ok([{ id: 1 }]));
    const onRemoved = vi.fn();
    notifySpy();
    render(<RecordingManageBar recording={MANAGED} user={userOf("u-me")} canManage={false} notes={[]} onChanged={vi.fn()} onRemoved={onRemoved} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    const confirm = confirmButton("Delete recording");
    act(() => { fireEvent.click(confirm); fireEvent.click(confirm); });
    await waitFor(() => expect(onRemoved).toHaveBeenCalledTimes(1));
    expect(fake.from("recordings", "delete").calls).toHaveLength(1);
  });

  it("the recording's Save details", async () => {
    fake.from("recordings", "update").reply(ok([{ id: 1 }]));
    const onChanged = vi.fn();
    notifySpy();
    render(<RecordingManageBar recording={MANAGED} user={userOf("u-me")} canManage={false} notes={[]} onChanged={onChanged} onRemoved={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit details" }));
    const form = screen.getByRole("dialog").querySelector("form")!;
    act(() => { fireEvent.submit(form); fireEvent.submit(form); });
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(fake.from("recordings", "update").calls).toHaveLength(1);
  });

  it("the club recording's Delete confirmation", async () => {
    fake.from("recordings", "select").reply(ok([]));
    fake.from("archive_items", "delete").reply(ok([{ id: 11 }]));
    const onChanged = vi.fn();
    notifySpy();
    render(<ClubArchiveManager items={[ITEM]} groups={[]} onAdd={vi.fn()} onChanged={onChanged} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    const confirm = confirmButton("Delete recording");
    act(() => { fireEvent.click(confirm); fireEvent.click(confirm); });
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(fake.from("archive_items", "delete").calls).toHaveLength(1);
  });

  it("a form dialog keeps what was typed when a click lands beside it, and while it saves nothing closes it", async () => {
    const slow = deferred();
    fake.from("recordings", "update").reply(slow.reply);
    notifySpy();
    render(<RecordingManageBar recording={MANAGED} user={userOf("u-me")} canManage={false} notes={[]} onChanged={vi.fn()} onRemoved={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit details" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Title"), { target: { value: "Renamed" } });
    fireEvent.click(dialog.parentElement!);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.submit(dialog.querySelector("form")!);
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "Saving…" })).toBeDisabled());
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await act(async () => { slow.resolve(ok([])); });
    // Refused (no row changed): the dialog is still there with what was typed.
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "Save details" })).toBeEnabled());
    expect(within(dialog).getByLabelText("Title")).toHaveValue("Renamed");
  });
});

// ---------------------------------------------------------------------------------------------------------------
// axe
// ---------------------------------------------------------------------------------------------------------------

describe("accessibility: no serious or critical violation (colour contrast is not checked in jsdom)", () => {
  it("the list, with its tabs, search and cards", async () => {
    listReads().reply(ok([rec(1, "Varnam"), rec(2, "Todi alap", { media_kind: "video" })], { count: 2 }));
    const { container } = renderRecordings();
    await screen.findByRole("button", { name: /Varnam/ });
    await expectNoSeriousViolations(container);
  });

  it("the empty list, the loading list and the failed list", async () => {
    const slow = deferred();
    listReads().replyOnce(slow.reply).reply(fail("boom"));
    const { container } = renderRecordings();
    await screen.findByText("Loading recordings");
    await expectNoSeriousViolations(container);
    await act(async () => { slow.resolve(ok([], { count: 0 })); });
    await screen.findByText("No published recordings in this view");
    await expectNoSeriousViolations(container);
    fireEvent.click(screen.getByRole("tab", { name: "Archived" }));
    await screen.findByRole("alert");
    await expectNoSeriousViolations(container);
  });

  it("the studio, with a take and while it uploads", async () => {
    listReads().reply(ok([], { count: 0 }));
    renderRecordings();
    const { dialog, inside } = await openStudio();
    await expectNoSeriousViolations(document.body);
    fireEvent.change(dialog.querySelector('input[type="file"]')!, { target: { files: [new File(["b"], "take.mp3", { type: "audio/mpeg" })] } });
    await inside.findByText("take.mp3");
    await expectNoSeriousViolations(document.body);
  });

  it("a recording's window, its notation and a notation file's preview", async () => {
    listReads().reply(ok([rec(1, "Varnam")], { count: 1 }));
    fake.from("recording_notes", "select").reply(ok([note(1, "Alap"), note(2, "Sargam", { note_type: "file", storage_path: "u-me/sargam.png", mime_type: "image/png" })]));
    renderRecordings();
    fireEvent.click(await screen.findByRole("button", { name: /Varnam/ }));
    await screen.findByText("Alap body");
    await expectNoSeriousViolations(document.body);
    fireEvent.click(screen.getByRole("button", { name: /Sargam/ }));
    await screen.findByRole("dialog", { name: "Sargam" });
    await screen.findByRole("img", { name: "Sargam" });
    await expectNoSeriousViolations(document.body);
  });

  it("the manage bar's dialogs: edit, archive and delete", async () => {
    notifySpy();
    render(<RecordingManageBar recording={MANAGED} user={userOf("u-me")} canManage={false} notes={[]} onChanged={vi.fn()} onRemoved={vi.fn()} />);
    await expectNoSeriousViolations(document.body);
    for (const [open, label] of [["Edit details", "Cancel"], ["Archive", "Cancel"], ["Delete", "Cancel"]] as const) {
      fireEvent.click(screen.getByRole("button", { name: open }));
      await expectNoSeriousViolations(document.body);
      fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: label }));
    }
  });

  it("the club recordings list and its dialogs (edit, delete, open)", async () => {
    fake.from("recordings", "select").reply(ok([]));
    notifySpy();
    render(<ClubArchiveManager items={[ITEM]} groups={[]} onAdd={vi.fn()} onChanged={vi.fn()} />);
    await expectNoSeriousViolations(document.body);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    await expectNoSeriousViolations(document.body);
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await expectNoSeriousViolations(document.body);
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    await screen.findByLabelText("spring.mp4");
    await expectNoSeriousViolations(document.body);
  });

  it("the form that adds a club recording, empty and with a failed file", async () => {
    notifySpy();
    render(<ArchiveModal user={userOf("u-me")} onClose={vi.fn()} onSaved={vi.fn()} />);
    await expectNoSeriousViolations(document.body);
    fake.storage("club-archive", "upload").reply(fail("Bucket not found"));
    const form = document.querySelector("form")!;
    fireEvent.change(within(form).getByLabelText("Title"), { target: { value: "Spring concert" } });
    fireEvent.change(within(form).getByLabelText("Choose file"), { target: { files: [new File(["b"], "a.mp4", { type: "video/mp4" })] } });
    fireEvent.submit(form);
    await within(form).findByText("Failed");
    await expectNoSeriousViolations(document.body);
  });
});
