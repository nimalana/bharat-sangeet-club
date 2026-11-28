// The recordings workspace in its parts: the cards, the studio (a take dropped or recorded, a draft being finished), the detail
// window with its notation, the waveform player and the sruthi companion. people-recordings.test.tsx pins the list requests and
// what a failed save removes; this file pins the rest of what each part does, so a part can be moved without losing it.
//
// Only two third-party libraries are replaced, because jsdom has neither a canvas nor an audio clock: wavesurfer.js (the instance
// is recorded so a test can fire its events and read what the player asked of it) and tone (every call is logged).
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RecordingWorkspace } from "../../features/recordings/components/recording-workspace";
import { ShruthiCompanion } from "../../features/recordings/components/shruthi-companion";
import { WaveformPlayer } from "../../features/recordings/components/waveform-player";
import { setCacheOwner } from "../../lib/cache";
import { flush, notifySpy, userOf } from "../support/helpers";
import { fail, fake, ok } from "../support/fake-supabase";

type Handler = (value?: number) => void;
type Wave = { options: Record<string, unknown>; handlers: Record<string, Handler>; calls: unknown[][]; destroyed: boolean; duration: number; time: number };
const wave = vi.hoisted(() => ({ instances: [] as Wave[] }));
vi.mock("wavesurfer.js", () => ({
  default: {
    create: (options: Record<string, unknown>) => {
      const instance: Wave = { options, handlers: {}, calls: [], destroyed: false, duration: 0, time: 0 };
      wave.instances.push(instance);
      return {
        on: (name: string, handler: Handler) => { instance.handlers[name] = handler; },
        destroy: () => { instance.destroyed = true; },
        getDuration: () => instance.duration,
        getCurrentTime: () => instance.time,
        setTime: (value: number) => { instance.calls.push(["setTime", value]); },
        setPlaybackRate: (value: number) => { instance.calls.push(["setPlaybackRate", value]); },
        playPause: () => { instance.calls.push(["playPause"]); },
      };
    },
  },
}));

type Synth = { volume: { value: number }; played: unknown[][]; disposed: boolean };
const tone = vi.hoisted(() => ({ log: [] as string[], synths: [] as Synth[], scheduled: null as null | { callback: (time: number) => void; interval: number } }));
vi.mock("tone", () => ({
  start: async () => { tone.log.push("start"); },
  Transport: {
    clear: (id: number) => { tone.log.push(`clear ${id}`); },
    stop: () => { tone.log.push("stop"); },
    start: () => { tone.log.push("transport start"); },
    scheduleRepeat: (callback: (time: number) => void, interval: number) => { tone.scheduled = { callback, interval }; tone.log.push(`schedule ${interval}`); return 7; },
  },
  Synth: class {
    volume = { value: 0 };
    played: unknown[][] = [];
    disposed = false;
    constructor() { tone.synths.push(this); }
    toDestination() { return this; }
    triggerAttackRelease(note: number, length: number, time: number) { this.played.push([note, length, time]); }
    triggerRelease() { tone.log.push("release"); }
    dispose() { this.disposed = true; tone.log.push("dispose"); }
  },
}));

beforeEach(() => { wave.instances.length = 0; tone.log.length = 0; tone.synths.length = 0; tone.scheduled = null; });

const GROUPS = [{ id: 7, name: "Hindustani Vocal", description: "" }, { id: 8, name: "Carnatic Violin", description: "" }];
const MEMBERSHIPS = [{ subgroup_id: 7, status: "active" }, { subgroup_id: 8, status: "active" }];
const rec = (id: number, title: string, over: Record<string, unknown> = {}) => ({
  id, title, description: "", subgroup_id: 7, uploaded_by: "u-me", storage_path: `u-me/take-${id}.mp3`, mime_type: "audio/mpeg", media_kind: "audio",
  status: "published", audience: "subgroup", recording_kind: "practice", event_date: null, raga: null, tala: null, sruthi: null, tempo: null,
  duration_seconds: 95, created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z", published_at: "2026-10-01T00:00:00Z", ...over,
});
const note = (id: number, title: string, over: Record<string, unknown> = {}) =>
  ({ id, recording_id: 1, title, note_type: "text", body: `${title} body`, storage_path: null, mime_type: null, uploaded_by: "u-me", created_at: "2026-10-02T00:00:00Z", ...over });

function renderRecordings(options: { canManage?: boolean } = {}) {
  const notify = notifySpy();
  setCacheOwner("u-me");
  render(<RecordingWorkspace user={userOf("u-me")} groups={GROUPS} memberships={MEMBERSHIPS} canManage={options.canManage ?? false} onDataChanged={vi.fn()} />);
  return { notify };
}
const listReads = () => fake.from("recordings", "select");
const signedFor = (bucket: string) => fake.storage(bucket, "createSignedUrl").calls;
const inDialog = (heading: string) => within((screen.getByRole("heading", { name: heading }).closest('[role="dialog"]')) as HTMLElement);

// ---------------------------------------------------------------------------------------------------------------
// The cards
// ---------------------------------------------------------------------------------------------------------------

describe("the cards: what each recording says about itself", () => {
  it("a card names its group, kind and length, then the raga, tala and sruthi; without them the description; without that, a hint", async () => {
    listReads().reply(ok([
      rec(1, "Varnam take", { raga: "Bhairavi", tala: "Adi", sruthi: "D", recording_kind: "rehearsal", duration_seconds: 95 }),
      rec(2, "Evening alap", { description: "Slow and steady", subgroup_id: 8, duration_seconds: null }),
      rec(3, "Bare take"),
    ], { count: 3 }));
    renderRecordings();
    const first = (await screen.findByRole("button", { name: /Varnam take/ }));
    expect(first).toHaveTextContent("Hindustani Vocal · rehearsal · 1:35");
    expect(first).toHaveTextContent("Bhairavi · Adi · D");
    expect(screen.getByRole("button", { name: /Evening alap/ })).toHaveTextContent("Carnatic Violin · practice · —");
    expect(screen.getByRole("button", { name: /Evening alap/ })).toHaveTextContent("Slow and steady");
    expect(screen.getByRole("button", { name: /Bare take/ })).toHaveTextContent("No musical details added yet");
    // Numbered in the order the server gave them.
    expect(first).toHaveTextContent("01");
    expect(screen.getByRole("button", { name: /Bare take/ })).toHaveTextContent("03");
  });

  it("the badge says Audio or Video in the published list, Draft in My drafts and Archived in Archived", async () => {
    listReads().reply(ok([
      rec(1, "Audio take"), rec(2, "Video take", { media_kind: "video" }),
      rec(3, "Draft take", { status: "draft" }), rec(4, "Shelved take", { status: "archived" }),
    ], { count: 4 }));
    renderRecordings();
    const badge = (card: HTMLElement) => card.querySelector(".recording-card-status")?.textContent;
    expect(badge(await screen.findByRole("button", { name: /Audio take/ }))).toBe("Audio");
    expect(badge(screen.getByRole("button", { name: /Video take/ }))).toBe("Video");
    // Drafts and archived rows the server sent for another view are not shown in this one.
    expect(screen.queryByText("Draft take")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "My drafts" }));
    expect(badge(await screen.findByRole("button", { name: /Draft take/ }))).toBe("Draft");
    fireEvent.click(screen.getByRole("tab", { name: "Archived" }));
    expect(badge(await screen.findByRole("button", { name: /Shelved take/ }))).toBe("Archived");
  });

  it("the empty list says what each view is for, and offers to create the first recording", async () => {
    listReads().reply(ok([], { count: 0 }));
    renderRecordings();
    expect(await screen.findByText("No published recordings in this view")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "My drafts" }));
    expect(await screen.findByText("No drafts yet")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Archived" }));
    expect(await screen.findByText("Nothing archived in this view")).toBeInTheDocument();
    // The button opens the studio.
    fireEvent.click(screen.getByRole("button", { name: "Create the first recording" }));
    expect(await screen.findByRole("heading", { name: "Recording studio" })).toBeInTheDocument();
  });

  it("a published recording opens its window; the person's own draft opens the studio instead", async () => {
    listReads().reply(ok([rec(1, "Varnam take"), rec(2, "Half done", { status: "draft" })], { count: 2 }));
    fake.from("recording_notes", "select").reply(ok([]));
    renderRecordings();
    fireEvent.click(await screen.findByRole("button", { name: /Varnam take/ }));
    expect(await screen.findByText("Notation and notes")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Finish this recording" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close recording" }));
    await waitFor(() => expect(screen.queryByText("Notation and notes")).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("tab", { name: "My drafts" }));
    fireEvent.click(await screen.findByRole("button", { name: /Half done/ }));
    expect(await screen.findByRole("heading", { name: "Finish this recording" })).toBeInTheDocument();
    expect(screen.queryByText("Notation and notes")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------------------------------------------
// The studio
// ---------------------------------------------------------------------------------------------------------------

const draftRow = () => rec(5, "Half done", { status: "draft", raga: "Todi", tala: "Rupaka", sruthi: "C", tempo: "Madhyama", description: "Second half", recording_kind: "lesson", duration_seconds: 140, published_at: null });

async function openDraft() {
  listReads().reply(ok([draftRow()], { count: 1 }));
  const rendered = renderRecordings();
  fireEvent.click(screen.getByRole("tab", { name: "My drafts" }));
  fireEvent.click(await screen.findByRole("button", { name: /Half done/ }));
  await screen.findByRole("heading", { name: "Finish this recording" });
  return rendered;
}

describe("the studio: finishing a draft", () => {
  it("starts from what the draft says and shows its saved take, signed from the recordings bucket, as the preview", async () => {
    await openDraft();
    const studio = inDialog("Finish this recording");
    expect(studio.getByLabelText("Title")).toHaveValue("Half done");
    expect(studio.getByLabelText("Description")).toHaveValue("Second half");
    expect(studio.getByLabelText("Raga / raag")).toHaveValue("Todi");
    expect(studio.getByLabelText("Tala / taal")).toHaveValue("Rupaka");
    expect(studio.getByLabelText("Sruthi / tonic")).toHaveValue("C");
    expect(studio.getByLabelText("Tempo / laya")).toHaveValue("Madhyama");
    expect(studio.getByLabelText("Recording type")).toHaveValue("lesson");
    expect(await studio.findByText("Saved draft preview")).toBeInTheDocument();
    expect(studio.getByText("2:20")).toBeInTheDocument();
    expect(signedFor("recordings")[0].args).toEqual(["u-me/take-5.mp3", 1800]);
    expect(wave.instances[0].options.url).toBe("https://files.test/recordings/u-me/take-5.mp3?signed");
    // The take is there already, so the person can save without choosing a file.
    expect(studio.getByRole("button", { name: "Publish to subgroup" })).toBeEnabled();
    expect(studio.getByRole("button", { name: "Replace file" })).toBeInTheDocument();
  });

  it("publishing writes the same row (never a new one), keeps the take, and uploads nothing", async () => {
    fake.from("recordings", "update").reply(ok(null));
    const { notify } = await openDraft();
    const studio = inDialog("Finish this recording");
    fireEvent.change(studio.getByLabelText("Title"), { target: { value: "  Finished  " } });
    fireEvent.click(studio.getByRole("button", { name: "Publish to subgroup" }));
    await waitFor(() => expect(notify.find("Published to your subgroup")).toBeTruthy());
    const update = fake.from("recordings", "update").calls[0];
    expect(update.used("eq", "id", 5)).toBe(true);
    expect(update.payload).toMatchObject({
      title: "Finished", storage_path: "u-me/take-5.mp3", mime_type: "audio/mpeg", media_kind: "audio", status: "published", audience: "subgroup",
      subgroup_id: 7, recording_kind: "lesson", raga: "Todi", tala: "Rupaka", sruthi: "C", tempo: "Madhyama", duration_seconds: 140,
    });
    expect((update.payload as { published_at: string }).published_at).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect(fake.from("recordings", "insert").count).toBe(0);
    expect(fake.storage("recordings", "upload").count).toBe(0);
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Finish this recording" })).not.toBeInTheDocument());
  });

  it("Save draft keeps it a draft: no published date", async () => {
    fake.from("recordings", "update").reply(ok(null));
    const { notify } = await openDraft();
    fireEvent.click(inDialog("Finish this recording").getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(notify.find("Draft saved")).toBeTruthy());
    expect(fake.from("recordings", "update").calls[0].payload).toMatchObject({ status: "draft", published_at: null });
  });

  it("a take that cannot be signed leaves no preview to wait for, and the form still works", async () => {
    fake.storage("recordings", "createSignedUrl").reply(fail("Object not found"));
    await openDraft();
    const studio = inDialog("Finish this recording");
    await waitFor(() => expect(studio.queryByText("Loading your draft preview…")).not.toBeInTheDocument());
    expect(studio.queryByText("Saved draft preview")).not.toBeInTheDocument();
    expect(studio.getByLabelText("Title")).toHaveValue("Half done");
  });
});

const TAKE = (name = "take.mp3", type = "audio/mpeg") => new File(["bytes"], name, { type });

async function openNewStudio() {
  fireEvent.click(await screen.findByRole("button", { name: "＋ New recording" }));
  await screen.findByRole("heading", { name: "Recording studio" });
  return inDialog("Recording studio");
}
const dropFile = (file: File) => fireEvent.change(document.querySelector('.recording-studio-dialog input[type="file"]')!, { target: { files: [file] } });

describe("the studio: a take that is dropped", () => {
  it("a video file is saved as video with its own type and no length", async () => {
    listReads().reply(ok([], { count: 0 }));
    fake.from("recordings", "insert").reply(ok({ id: 41 }));
    const { notify } = renderRecordings();
    const studio = await openNewStudio();
    dropFile(TAKE("clip.mp4", "video/mp4"));
    await studio.findByText("clip.mp4");
    fireEvent.change(studio.getByLabelText("Title"), { target: { value: "Clip" } });
    fireEvent.click(studio.getByRole("button", { name: "Publish to subgroup" }));
    await waitFor(() => expect(notify.find("Published to your subgroup")).toBeTruthy());
    expect(fake.from("recordings", "insert").calls[0].payload).toMatchObject({ media_kind: "video", mime_type: "video/mp4", duration_seconds: null });

  });

  it("the second subgroup can be chosen: the take goes under its folder, and the note names it", async () => {
    listReads().reply(ok([], { count: 0 }));
    fake.from("recordings", "insert").reply(ok({ id: 41 }));
    const { notify } = renderRecordings();
    const studio = await openNewStudio();
    expect(studio.getByText("Hindustani Vocal", { selector: "strong" })).toBeInTheDocument();
    fireEvent.change(studio.getByLabelText("Subgroup"), { target: { value: "8" } });
    expect(studio.getByText("Carnatic Violin", { selector: "strong" })).toBeInTheDocument();
    dropFile(TAKE());
    await studio.findByText("take.mp3");
    fireEvent.change(studio.getByLabelText("Title"), { target: { value: "Violin practice" } });
    fireEvent.click(studio.getByRole("button", { name: "Publish to subgroup" }));
    await waitFor(() => expect(notify.find("Published to your subgroup")).toBeTruthy());
    expect(fake.storage("recordings", "upload").calls[0].args[0]).toMatch(/^u-me\/subgroups\/8\//);
    expect(fake.from("recordings", "insert").calls[0].payload).toMatchObject({ subgroup_id: 8 });
  });

  it("Retake puts the drop area back and lets go of the preview address", async () => {
    listReads().reply(ok([], { count: 0 }));
    renderRecordings();
    const studio = await openNewStudio();
    dropFile(TAKE());
    await studio.findByText("take.mp3");
    expect(studio.queryByText("Drop an audio or video take here")).not.toBeInTheDocument();
    fireEvent.click(studio.getByRole("button", { name: "Retake" }));
    expect(await studio.findByText("Drop an audio or video take here")).toBeInTheDocument();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:fake");
    expect(studio.getByRole("button", { name: "Publish to subgroup" })).toBeDisabled();
  });

  it("closing the studio lets go of the preview address", async () => {
    listReads().reply(ok([], { count: 0 }));
    renderRecordings();
    const studio = await openNewStudio();
    dropFile(TAKE());
    await studio.findByText("take.mp3");
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    fireEvent.click(studio.getByRole("button", { name: "Close recording studio" }));
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Recording studio" })).not.toBeInTheDocument());
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:fake");
  });

  it("a notation file is uploaded under the person's folder and attached as a file note named after it", async () => {
    listReads().reply(ok([], { count: 0 }));
    fake.from("recordings", "insert").reply(ok({ id: 41 }));
    fake.from("recording_notes", "insert").reply(ok(null));
    const { notify } = renderRecordings();
    const studio = await openNewStudio();
    dropFile(TAKE());
    await studio.findByText("take.mp3");
    fireEvent.change(studio.getByLabelText("Title"), { target: { value: "With a score" } });
    fireEvent.change(studio.getByLabelText(/Notation file/), { target: { files: [new File(["pdf"], "sargam.pdf", { type: "application/pdf" })] } });
    expect(await studio.findByText("sargam.pdf")).toBeInTheDocument();
    fireEvent.click(studio.getByRole("button", { name: "Publish to subgroup" }));
    await waitFor(() => expect(notify.find("Published to your subgroup")).toBeTruthy());
    const stored = fake.storage("recording-notations", "upload").calls[0].args[0];
    expect(stored).toMatch(/^u-me\/[0-9a-f-]{36}-sargam\.pdf$/);
    expect(fake.from("recording_notes", "insert").calls[0].payload).toMatchObject({ recording_id: 41, title: "sargam.pdf", note_type: "file", body: "", storage_path: stored, mime_type: "application/pdf", uploaded_by: "u-me" });
  });

  it("a notation text is attached to the saved recording as a text note", async () => {
    listReads().reply(ok([], { count: 0 }));
    fake.from("recordings", "insert").reply(ok({ id: 41 }));
    fake.from("recording_notes", "insert").reply(ok(null));
    const { notify } = renderRecordings();
    const studio = await openNewStudio();
    dropFile(TAKE());
    await studio.findByText("take.mp3");
    fireEvent.change(studio.getByLabelText("Title"), { target: { value: "With notes" } });
    fireEvent.change(studio.getByLabelText("Notation text"), { target: { value: "  S R G M  " } });
    fireEvent.click(studio.getByRole("button", { name: "Publish to subgroup" }));
    await waitFor(() => expect(notify.find("Published to your subgroup")).toBeTruthy());
    expect(fake.from("recording_notes", "insert").calls[0].payload).toMatchObject({ recording_id: 41, title: "Notation", note_type: "text", body: "S R G M", storage_path: null, uploaded_by: "u-me" });
  });
});

// A browser that records: the microphone and the recorder are replaced, the studio's own handling is what is tested.
const recorders: FakeRecorder[] = [];
class FakeRecorder {
  /** The types this browser claims to record; a test sets it. */
  static supported = ["audio/webm;codecs=opus"];
  static isTypeSupported = (type: string) => FakeRecorder.supported.includes(type);
  mimeType: string;
  state = "inactive";
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  constructor(public stream: unknown, options?: { mimeType?: string }) { this.mimeType = options?.mimeType ?? ""; recorders.push(this); }
  start() { this.state = "recording"; }
  stop() { this.state = "inactive"; this.ondataavailable?.({ data: new Blob(["sound"]) }); this.onstop?.(); }
}
const setMediaDevices = (value: unknown) => Object.defineProperty(navigator, "mediaDevices", { configurable: true, value });
afterEach(() => { recorders.length = 0; FakeRecorder.supported = ["audio/webm;codecs=opus"]; Reflect.deleteProperty(navigator, "mediaDevices"); });

describe("the studio: a take recorded in the browser", () => {
  it("a browser that cannot record says so and points to uploading a file", async () => {
    listReads().reply(ok([], { count: 0 }));
    renderRecordings();
    const studio = await openNewStudio();
    fireEvent.click(studio.getByRole("tab", { name: "Record audio" }));
    fireEvent.click(studio.getByRole("button", { name: "● Start recording" }));
    expect(await studio.findByRole("alert")).toHaveTextContent("This browser does not support direct recording. Try uploading a file instead.");
  });

  it("a blocked microphone and any other failure each have their own sentence, and the tracks that opened are stopped", async () => {
    listReads().reply(ok([], { count: 0 }));
    const getUserMedia = vi.fn().mockRejectedValueOnce(new DOMException("denied", "NotAllowedError")).mockRejectedValueOnce(new Error("no device"));
    setMediaDevices({ getUserMedia });
    renderRecordings();
    const studio = await openNewStudio();
    fireEvent.click(studio.getByRole("tab", { name: "Record audio" }));
    fireEvent.click(studio.getByRole("button", { name: "● Start recording" }));
    expect(await studio.findByRole("alert")).toHaveTextContent("Microphone or camera access was blocked. Allow access in your browser, then try again.");
    fireEvent.click(studio.getByRole("button", { name: "● Start recording" }));
    await waitFor(() => expect(studio.getByRole("alert")).toHaveTextContent("We could not start the recording. Try another input or upload a file instead."));
    expect(getUserMedia).toHaveBeenNthCalledWith(1, { audio: true, video: false });
  });

  it("a recorder that cannot be built gives the general sentence and lets the microphone go", async () => {
    listReads().reply(ok([], { count: 0 }));
    const stopTrack = vi.fn();
    setMediaDevices({ getUserMedia: async () => ({ getTracks: () => [{ stop: stopTrack }] }) });
    vi.stubGlobal("MediaRecorder", class { static isTypeSupported = () => false; constructor() { throw new Error("no recorder"); } });
    renderRecordings();
    const studio = await openNewStudio();
    fireEvent.click(studio.getByRole("tab", { name: "Record audio" }));
    fireEvent.click(studio.getByRole("button", { name: "● Start recording" }));
    expect(await studio.findByRole("alert")).toHaveTextContent("We could not start the recording. Try another input or upload a file instead.");
    expect(stopTrack).toHaveBeenCalledTimes(1);
  });

  it("records video: the camera shows in the preview while it runs, and the take is saved as webm video", async () => {
    listReads().reply(ok([], { count: 0 }));
    fake.from("recordings", "insert").reply(ok({ id: 41 }));
    const stream = { getTracks: () => [{ stop: vi.fn() }] };
    const getUserMedia = vi.fn(async () => stream);
    setMediaDevices({ getUserMedia });
    vi.stubGlobal("MediaRecorder", FakeRecorder);
    FakeRecorder.supported = ["video/webm;codecs=vp9,opus"];
    const { notify } = renderRecordings();
    const studio = await openNewStudio();
    fireEvent.click(studio.getByRole("tab", { name: "Record video" }));
    expect(studio.getByText("Camera ready when you are")).toBeInTheDocument();
    fireEvent.click(studio.getByRole("button", { name: "● Start recording" }));
    await studio.findByRole("button", { name: "■ Stop recording" });
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true, video: true });
    expect((document.querySelector(".recording-capture-card video") as HTMLVideoElement & { srcObject: unknown }).srcObject).toBe(stream);
    fireEvent.click(studio.getByRole("button", { name: "■ Stop recording" }));
    expect(await studio.findByText(/^recording-\d+\.webm$/)).toBeInTheDocument();
    fireEvent.change(studio.getByLabelText("Title"), { target: { value: "On camera" } });
    fireEvent.click(studio.getByRole("button", { name: "Publish to subgroup" }));
    await waitFor(() => expect(notify.find("Published to your subgroup")).toBeTruthy());
    expect(recorders[0].mimeType).toBe("video/webm;codecs=vp9,opus");
    expect(fake.from("recordings", "insert").calls[0].payload).toMatchObject({ media_kind: "video", mime_type: "video/webm;codecs=vp9,opus" });
  });

  it("a browser that supports none of the usual types still records, and the take is typed webm", async () => {
    listReads().reply(ok([], { count: 0 }));
    fake.from("recordings", "insert").reply(ok({ id: 41 }));
    setMediaDevices({ getUserMedia: async () => ({ getTracks: () => [{ stop: vi.fn() }] }) });
    vi.stubGlobal("MediaRecorder", FakeRecorder);
    FakeRecorder.supported = [];
    const { notify } = renderRecordings();
    const studio = await openNewStudio();
    fireEvent.click(studio.getByRole("tab", { name: "Record audio" }));
    fireEvent.click(studio.getByRole("button", { name: "● Start recording" }));
    await studio.findByRole("button", { name: "■ Stop recording" });
    expect(recorders[0].mimeType).toBe("");
    fireEvent.click(studio.getByRole("button", { name: "■ Stop recording" }));
    await studio.findByText(/^recording-\d+\.webm$/);
    fireEvent.change(studio.getByLabelText("Title"), { target: { value: "Plain" } });
    fireEvent.click(studio.getByRole("button", { name: "Publish to subgroup" }));
    await waitFor(() => expect(notify.find("Published to your subgroup")).toBeTruthy());
    expect(fake.from("recordings", "insert").calls[0].payload).toMatchObject({ media_kind: "audio", mime_type: "audio/webm" });
  });

  it("closing the studio while it records stops the recorder and the microphone", async () => {
    listReads().reply(ok([], { count: 0 }));
    const stopTrack = vi.fn();
    setMediaDevices({ getUserMedia: async () => ({ getTracks: () => [{ stop: stopTrack }] }) });
    vi.stubGlobal("MediaRecorder", FakeRecorder);
    renderRecordings();
    const studio = await openNewStudio();
    fireEvent.click(studio.getByRole("tab", { name: "Record audio" }));
    fireEvent.click(studio.getByRole("button", { name: "● Start recording" }));
    await studio.findByRole("button", { name: "■ Stop recording" });
    fireEvent.click(studio.getByRole("button", { name: "Close recording studio" }));
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Recording studio" })).not.toBeInTheDocument());
    expect(recorders[0].state).toBe("inactive");
    expect(stopTrack).toHaveBeenCalled();
  });

  it("records, counts the seconds, and turns the take into a file that is saved like a dropped one", async () => {
    listReads().reply(ok([], { count: 0 }));
    fake.from("recordings", "insert").reply(ok({ id: 41 }));
    const stopTrack = vi.fn();
    const getUserMedia = vi.fn(async () => ({ getTracks: () => [{ stop: stopTrack }] }));
    setMediaDevices({ getUserMedia });
    vi.stubGlobal("MediaRecorder", FakeRecorder);
    const { notify } = renderRecordings();
    const studio = await openNewStudio();
    fireEvent.click(studio.getByRole("tab", { name: "Record audio" }));
    expect(studio.getByText("Microphone ready when you are")).toBeInTheDocument();
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    await act(async () => { fireEvent.click(studio.getByRole("button", { name: "● Start recording" })); });
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true, video: false });
    expect(recorders[0].mimeType).toBe("audio/webm;codecs=opus");
    expect(recorders[0].state).toBe("recording");
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(studio.getByText("Recording 0:03")).toBeInTheDocument();
    await act(async () => { fireEvent.click(studio.getByRole("button", { name: "■ Stop recording" })); });
    vi.useRealTimers();
    expect(stopTrack).toHaveBeenCalled();
    expect(await studio.findByText(/^recording-\d+\.webm$/)).toBeInTheDocument();
    expect(studio.getByText("0:03")).toBeInTheDocument();
    fireEvent.change(studio.getByLabelText("Title"), { target: { value: "From the microphone" } });
    fireEvent.click(studio.getByRole("button", { name: "Publish to subgroup" }));
    await waitFor(() => expect(notify.find("Published to your subgroup")).toBeTruthy());
    expect(fake.from("recordings", "insert").calls[0].payload).toMatchObject({ media_kind: "audio", mime_type: "audio/webm;codecs=opus", duration_seconds: 3 });
  });
});

// ---------------------------------------------------------------------------------------------------------------
// The detail window
// ---------------------------------------------------------------------------------------------------------------

describe("a recording's window", () => {
  it("plays the take signed for 30 minutes from the recordings bucket, and counts and lists the notation", async () => {
    listReads().reply(ok([rec(1, "Varnam take", { raga: "Bhairavi", tempo: "Madhyama" })], { count: 1 }));
    fake.from("recording_notes", "select").reply(ok([note(1, "Alap"), note(2, "Sargam", { note_type: "file", storage_path: "u-me/sargam.pdf" })]));
    renderRecordings();
    fireEvent.click(await screen.findByRole("button", { name: /Varnam take/ }));
    await screen.findByText("Alap body");
    const dialog = inDialog("Varnam take");
    expect(dialog.getByText("Bhairavi · Madhyama")).toBeInTheDocument();
    expect(dialog.getByText("Hindustani Vocal · practice")).toBeInTheDocument();
    expect(signedFor("recordings")[0].args).toEqual(["u-me/take-1.mp3", 1800]);
    await waitFor(() => expect(wave.instances).toHaveLength(1));
    expect(wave.instances[0].options.url).toBe("https://files.test/recordings/u-me/take-1.mp3?signed");
    expect(dialog.getByText("2")).toBeInTheDocument();
    expect(dialog.getByRole("button", { name: /Sargam/ })).toBeInTheDocument();
    expect(fake.from("recording_notes", "select").calls[0].used("eq", "recording_id", 1)).toBe(true);
  });

  it("a recording kept in another bucket is signed from that bucket; a video plays in a video element", async () => {
    listReads().reply(ok([rec(1, "Old concert", { storage_bucket: "club-archive", media_kind: "video", storage_path: "u-1/concert.mp4" })], { count: 1 }));
    fake.from("recording_notes", "select").reply(ok([]));
    renderRecordings();
    fireEvent.click(await screen.findByRole("button", { name: /Old concert/ }));
    await waitFor(() => expect(signedFor("club-archive")).toHaveLength(1));
    expect(signedFor("club-archive")[0].args).toEqual(["u-1/concert.mp4", 1800]);
    expect(signedFor("recordings")).toHaveLength(0);
    const video = await waitFor(() => { const found = document.querySelector("video.recording-detail-video"); expect(found).not.toBeNull(); return found as HTMLVideoElement; });
    expect(video.getAttribute("src")).toBe("https://files.test/club-archive/u-1/concert.mp4?signed");
    expect(wave.instances).toHaveLength(0);
    expect(screen.getByText("No notation attached yet.")).toBeInTheDocument();
  });

  it("a take that cannot be signed says so, and the player never appears", async () => {
    listReads().reply(ok([rec(1, "Varnam take")], { count: 1 }));
    fake.from("recording_notes", "select").reply(ok([]));
    fake.storage("recordings", "createSignedUrl").reply(fail("Object not found"));
    const { notify } = renderRecordings();
    fireEvent.click(await screen.findByRole("button", { name: /Varnam take/ }));
    await waitFor(() => expect(notify.find("This recording could not be opened").tone).toBe("error"));
    expect(screen.getByText("Loading the recording…")).toBeInTheDocument();
    expect(wave.instances).toHaveLength(0);
  });

  it("a notation file opens in a new tab through a link signed for 15 minutes, with no opener", async () => {
    listReads().reply(ok([rec(1, "Varnam take")], { count: 1 }));
    fake.from("recording_notes", "select").reply(ok([note(2, "Sargam", { note_type: "file", storage_path: "u-me/sargam.pdf" })]));
    renderRecordings();
    fireEvent.click(await screen.findByRole("button", { name: /Varnam take/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Sargam/ }));
    await waitFor(() => expect(window.open).toHaveBeenCalledWith("https://files.test/recording-notations/u-me/sargam.pdf?signed", "_blank", "noopener,noreferrer"));
    expect(signedFor("recording-notations")[0].args).toEqual(["u-me/sargam.pdf", 900]);
  });

  it("a notation file that cannot be signed says so and opens nothing", async () => {
    listReads().reply(ok([rec(1, "Varnam take")], { count: 1 }));
    fake.from("recording_notes", "select").reply(ok([note(2, "Sargam", { note_type: "file", storage_path: "u-me/sargam.pdf" })]));
    fake.storage("recording-notations", "createSignedUrl").reply(fail("Object not found"));
    const { notify } = renderRecordings();
    fireEvent.click(await screen.findByRole("button", { name: /Varnam take/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Sargam/ }));
    await waitFor(() => expect(notify.find("This notation file could not be opened").tone).toBe("error"));
    expect(window.open).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------------------------------------------
// The player and the companion
// ---------------------------------------------------------------------------------------------------------------

const fire = (instance: Wave, name: string, value?: number) => act(() => { instance.handlers[name](value); });

describe("the waveform player", () => {
  it("draws the wave for the address, stays off until it is ready, then plays, pauses and shows the time", async () => {
    render(<WaveformPlayer url="https://files.test/a.mp3" />);
    const instance = wave.instances[0];
    expect(instance.options).toMatchObject({ url: "https://files.test/a.mp3", height: 86, normalize: true });
    expect(screen.getByRole("button", { name: "Play" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "−10" })).toBeDisabled();
    instance.duration = 100;
    fire(instance, "ready");
    expect(screen.getByRole("button", { name: "Play" })).toBeEnabled();
    expect(screen.getByText("— / 1:40")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    expect(instance.calls).toEqual([["playPause"]]);
    fire(instance, "play");
    expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();
    fire(instance, "timeupdate", 65);
    expect(screen.getByText("1:05 / 1:40")).toBeInTheDocument();
    fire(instance, "pause");
    expect(screen.getByRole("button", { name: "Play" })).toBeInTheDocument();
    fire(instance, "play");
    fire(instance, "finish");
    expect(screen.getByRole("button", { name: "Play" })).toBeInTheDocument();
    expect(screen.getByText("1:40 / 1:40")).toBeInTheDocument();
  });

  it("skips ten seconds either way and never past the ends; the speed is passed on", async () => {
    render(<WaveformPlayer url="https://files.test/a.mp3" />);
    const instance = wave.instances[0];
    instance.duration = 100;
    fire(instance, "ready");
    instance.time = 95;
    fireEvent.click(screen.getByRole("button", { name: "＋10" }));
    instance.time = 4;
    fireEvent.click(screen.getByRole("button", { name: "−10" }));
    instance.time = 50;
    fireEvent.click(screen.getByRole("button", { name: "＋10" }));
    fireEvent.click(screen.getByRole("button", { name: "−10" }));
    expect(instance.calls).toEqual([["setTime", 100], ["setTime", 0], ["setTime", 60], ["setTime", 40]]);
    fireEvent.change(screen.getByLabelText("Speed"), { target: { value: "1.5" } });
    expect(instance.calls.at(-1)).toEqual(["setPlaybackRate", 1.5]);
    expect(screen.getByLabelText("Speed")).toHaveValue("1.5");
  });

  it("a compact player is shorter; a new address replaces the old wave, and leaving destroys it", async () => {
    const { rerender, unmount } = render(<WaveformPlayer url="https://files.test/a.mp3" compact />);
    expect(wave.instances[0].options.height).toBe(52);
    expect(document.querySelector(".waveform-player.compact")).not.toBeNull();
    rerender(<WaveformPlayer url="https://files.test/b.mp3" compact />);
    expect(wave.instances).toHaveLength(2);
    expect(wave.instances[0].destroyed).toBe(true);
    expect(wave.instances[1].options.url).toBe("https://files.test/b.mp3");
    expect(wave.instances[1].destroyed).toBe(false);
    unmount();
    expect(wave.instances[1].destroyed).toBe(true);
  });
});

describe("the sruthi companion", () => {
  async function start() {
    fireEvent.click(screen.getByRole("button", { name: "Start drone" }));
    await act(async () => { await flush(); });
  }

  it("starts a drone on the chosen Sa: the tonic, the fifth, the octave and the fifth again, every 1.5 seconds, at the volume set", async () => {
    render(<ShruthiCompanion />);
    expect(tone.log).toEqual([]);
    await start();
    expect(tone.log).toEqual(["start", "schedule 1.5", "transport start"]);
    expect(tone.synths).toHaveLength(1);
    expect(tone.synths[0].volume.value).toBeCloseTo(-34 + 45 * 0.28, 5);
    expect(tone.scheduled?.interval).toBe(1.5);
    for (let beat = 0; beat < 5; beat += 1) tone.scheduled!.callback(10 + beat);
    expect(tone.synths[0].played.map(([note]) => note)).toEqual([130.81, 130.81 * 1.5, 130.81 * 2, 130.81 * 1.5, 130.81]);
    expect(tone.synths[0].played[0]).toEqual([130.81, 1.25, 10]);
    expect(screen.getByRole("button", { name: "Stop drone" })).toBeInTheDocument();
  });

  it("the volume slider moves a drone that is playing", async () => {
    render(<ShruthiCompanion />);
    await start();
    fireEvent.change(screen.getByLabelText("Volume"), { target: { value: "80" } });
    expect(tone.synths[0].volume.value).toBeCloseTo(-34 + 80 * 0.28, 5);
  });

  it("changing the Sa or the pattern while it plays stops the drone; the next start uses the new choice", async () => {
    render(<ShruthiCompanion />);
    await start();
    tone.log.length = 0;
    fireEvent.change(screen.getByLabelText("Sa"), { target: { value: "D" } });
    expect(tone.log).toEqual(["clear 7", "stop", "release", "dispose"]);
    expect(tone.synths[0].disposed).toBe(true);
    expect(screen.getByRole("button", { name: "Start drone" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Pattern"), { target: { value: "ma" } });
    await start();
    tone.scheduled!.callback(1); tone.scheduled!.callback(2);
    expect(tone.synths[1].played.map(([note]) => note)).toEqual([146.83, 146.83 * 1.3335]);
  });

  it("changing the pattern while it plays stops the drone too", async () => {
    render(<ShruthiCompanion />);
    await start();
    tone.log.length = 0;
    fireEvent.change(screen.getByLabelText("Pattern"), { target: { value: "ma" } });
    expect(tone.log).toEqual(["clear 7", "stop", "release", "dispose"]);
    expect(screen.getByRole("button", { name: "Start drone" })).toBeInTheDocument();
  });

  it("Stop drone stops it, and leaving the screen stops a drone that is still playing", async () => {
    const { unmount } = render(<ShruthiCompanion />);
    await start();
    fireEvent.click(screen.getByRole("button", { name: "Stop drone" }));
    expect(tone.synths[0].disposed).toBe(true);
    await start();
    expect(tone.synths[1].disposed).toBe(false);
    unmount();
    expect(tone.synths[1].disposed).toBe(true);
    expect(tone.log.at(-4)).toBe("clear 7");
  });
});
