// Phase 3 on the recordings area: what a person sees while a file goes up (progress, Retry), that a button pressed twice sends one
// request, that a form keeps what was typed when the request fails, and that nothing closes a dialog while it is busy.
//
// The upload goes through the fake XMLHttpRequest as it is (no bridge to the fake client): a test answers the request itself, so it can
// say how many bytes have left (`xhr.last.progress`) and when the server answered (`xhr.last.respond`).
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ArchiveModal } from "../../features/recordings/components/archive-modal";
import { RecordingWorkspace } from "../../features/recordings/components/recording-workspace";
import { setCacheOwner } from "../../lib/cache";
import { notifySpy, userOf } from "../support/helpers";
import { fail, fake, ok } from "../support/fake-supabase";
import { installFakeXhr } from "../support/fake-xhr";

vi.mock("wavesurfer.js", () => ({ default: { create: () => ({ on: () => {}, destroy: () => {}, getDuration: () => 0, getCurrentTime: () => 0, setTime: () => {}, setPlaybackRate: () => {}, playPause: () => {} }) } }));
vi.mock("tone", () => ({ start: async () => {}, Transport: { clear: () => {}, stop: () => {}, start: () => {}, scheduleRepeat: () => 1 }, Synth: class { volume = { value: 0 }; toDestination() { return this; } triggerAttackRelease() {} triggerRelease() {} dispose() {} } }));

const GROUPS = [{ id: 7, name: "Hindustani Vocal", description: "" }];
const MEMBERSHIPS = [{ subgroup_id: 7, status: "active" }];
const SONG = new File(["bytes"], "spring concert.mp4", { type: "video/mp4" });
const TAKE = new File(["bytes"], "take.mp3", { type: "audio/mpeg" });
const SCORE = new File(["pdf"], "sargam.pdf", { type: "application/pdf" });
const type = (scope: HTMLElement, label: string, value: string) => fireEvent.change(within(scope).getByLabelText(label), { target: { value } });
const progressbar = (name: string) => screen.getByRole("progressbar", { name });
const toastsOf = (notify: ReturnType<typeof notifySpy>) => notify.toasts().map((toast) => toast.message);

// ---------------------------------------------------------------------------------------------------------------
// Adding a club recording
// ---------------------------------------------------------------------------------------------------------------

describe("adding a club recording: the file goes up with progress", () => {
  function renderModal() {
    const notify = notifySpy();
    const onClose = vi.fn();
    const onSaved = vi.fn();
    const view = render(<ArchiveModal user={userOf("u-me")} onClose={onClose} onSaved={onSaved} />);
    const form = view.container.querySelector("form")!;
    type(form, "Title", "Spring concert");
    fireEvent.change(within(form).getByLabelText("Choose file"), { target: { files: [SONG] } });
    return { notify, onClose, onSaved, form };
  }

  it("shows how far the file got, says Saving once every byte has left, and nothing closes the dialog meanwhile", async () => {
    const xhr = installFakeXhr();
    fake.from("archive_items", "insert").reply(ok(null));
    const { onClose, onSaved, form } = renderModal();
    fireEvent.submit(form);
    await xhr.waitForRequest();
    expect(xhr.last.url).toContain("/storage/v1/object/club-archive/u-me/");
    act(() => xhr.last.progress(250, 1000));
    expect(progressbar("Uploading spring concert.mp4")).toHaveAttribute("aria-valuenow", "25");
    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
    // Busy: Escape, the close button and a click beside the dialog do nothing.
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(form.closest("[role=dialog]")!.parentElement!);
    expect(within(form).getByRole("button", { name: "Close" })).toBeDisabled();
    expect(onClose).not.toHaveBeenCalled();
    act(() => xhr.last.progress(1000, 1000));
    expect(progressbar("Uploading spring concert.mp4")).toHaveAttribute("aria-valuetext", "Saving");
    await act(async () => { xhr.last.respond(200, { Id: "1", Key: "club-archive/x" }); });
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(fake.from("archive_items", "insert").calls[0].payload).toMatchObject({ title: "Spring concert", uploaded_by: "u-me" });
  });

  it("a second submit that lands before the button is disabled sends nothing", async () => {
    const xhr = installFakeXhr();
    fake.from("archive_items", "insert").reply(ok(null));
    const { form } = renderModal();
    act(() => { fireEvent.submit(form); fireEvent.submit(form); });
    await xhr.waitForRequest();
    await act(async () => { await Promise.resolve(); });
    expect(xhr.requests).toHaveLength(1);
    await act(async () => { xhr.last.respond(200, { Id: "1", Key: "x" }); });
    await waitFor(() => expect(fake.from("archive_items", "insert").calls).toHaveLength(1));
  });

  it("a refused upload keeps what was typed, marks the file Failed with the sentence in the toast, and Retry sends the same form again", async () => {
    const xhr = installFakeXhr();
    fake.from("archive_items", "insert").reply(ok(null));
    const { notify, onSaved, form } = renderModal();
    type(form, "Description", "Evening set");
    fireEvent.submit(form);
    await xhr.waitForRequest();
    await act(async () => { xhr.last.respond(413, { message: "The object exceeded the maximum allowed size", statusCode: "413" }); });
    await waitFor(() => expect(toastsOf(notify)).toEqual(["The object exceeded the maximum allowed size"]));
    expect(notify.toasts()[0].tone).toBe("error");
    expect(within(form).getByText("Failed")).toBeInTheDocument();
    expect(within(form).getByLabelText("Title")).toHaveValue("Spring concert");
    expect(within(form).getByLabelText("Description")).toHaveValue("Evening set");
    expect((within(form).getByLabelText("Choose file") as HTMLInputElement).files?.[0]).toBe(SONG);
    expect(within(form).getByRole("button", { name: "Save recording" })).toBeEnabled();
    fireEvent.click(within(form).getByRole("button", { name: "Retry spring concert.mp4" }));
    await waitFor(() => expect(xhr.requests).toHaveLength(2));
    await act(async () => { xhr.last.respond(200, { Id: "2", Key: "club-archive/y" }); });
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(fake.from("archive_items", "insert").calls[0].payload).toMatchObject({ title: "Spring concert", description: "Evening set" });
  });

  it("a row that cannot be saved after the upload marks the file Failed and the dialog stays with its values", async () => {
    const xhr = installFakeXhr();
    fake.from("archive_items", "insert").reply(fail("duplicate key value violates unique constraint"));
    const { notify, form } = renderModal();
    fireEvent.submit(form);
    await xhr.waitForRequest();
    await act(async () => { xhr.last.respond(200, { Id: "1", Key: "club-archive/x" }); });
    await waitFor(() => expect(toastsOf(notify)).toEqual(["The recording could not be saved."]));
    expect(within(form).getByText("Failed")).toBeInTheDocument();
    expect(within(form).getByLabelText("Title")).toHaveValue("Spring concert");
  });
});

// ---------------------------------------------------------------------------------------------------------------
// The studio
// ---------------------------------------------------------------------------------------------------------------

const rec = (id: number, title: string) => ({
  id, title, description: "", subgroup_id: 7, uploaded_by: "u-me", storage_path: `u-me/take-${id}.mp3`, mime_type: "audio/mpeg", media_kind: "audio",
  status: "published", audience: "subgroup", recording_kind: "practice", event_date: null, raga: null, tala: null, sruthi: null, tempo: null,
  duration_seconds: 95, created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z", published_at: "2026-10-01T00:00:00Z",
});

async function openStudio() {
  fake.from("recordings", "select").reply(ok([rec(1, "Existing")], { count: 1 }));
  const notify = notifySpy();
  setCacheOwner("u-me");
  render(<RecordingWorkspace user={userOf("u-me")} groups={GROUPS} memberships={MEMBERSHIPS} canManage={false} onDataChanged={vi.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: "＋ New recording" }));
  const dialog = await screen.findByRole("dialog", { name: "Recording studio" });
  const inside = within(dialog);
  fireEvent.change(dialog.querySelector('input[type="file"]')!, { target: { files: [TAKE] } });
  await inside.findByText("take.mp3");
  fireEvent.change(inside.getByLabelText("Title"), { target: { value: "Varnam" } });
  return { notify, dialog, inside };
}

describe("the studio: the take and the notation file go up with progress", () => {
  it("each file has its own row: how far it got, then Uploaded; the notation file waits for the recording to be saved", async () => {
    const xhr = installFakeXhr();
    fake.from("recordings", "insert").reply(ok({ id: 41 }));
    fake.from("recording_notes", "insert").reply(ok(null));
    const { notify, inside } = await openStudio();
    const scoreInput = inside.getByLabelText(/^Notation file/);
    fireEvent.change(scoreInput, { target: { files: [SCORE] } });
    fireEvent.click(inside.getByRole("button", { name: "Publish to subgroup" }));
    await xhr.waitForRequest();
    expect(xhr.last.url).toContain("/storage/v1/object/recordings/u-me/subgroups/7/");
    expect(inside.getByText("Waiting")).toBeInTheDocument();
    act(() => xhr.last.progress(400, 1000));
    expect(progressbar("Uploading take.mp3")).toHaveAttribute("aria-valuenow", "40");
    await act(async () => { xhr.last.respond(200, { Id: "1", Key: "recordings/x" }); });
    await waitFor(() => expect(xhr.requests).toHaveLength(2));
    expect(xhr.last.url).toContain("/storage/v1/object/recording-notations/u-me/");
    expect(inside.getByText("Uploaded")).toBeInTheDocument();
    act(() => xhr.last.progress(10, 40));
    expect(progressbar("Uploading sargam.pdf")).toHaveAttribute("aria-valuenow", "25");
    await act(async () => { xhr.last.respond(200, { Id: "2", Key: "recording-notations/y" }); });
    await waitFor(() => expect(notify.find("Published to your subgroup")).toBeTruthy());
  });

  it("Publish pressed twice at once uploads the take once", async () => {
    const xhr = installFakeXhr();
    fake.from("recordings", "insert").reply(ok({ id: 41 }));
    const { notify, inside } = await openStudio();
    const publish = inside.getByRole("button", { name: "Publish to subgroup" });
    act(() => { fireEvent.click(publish); fireEvent.click(publish); });
    await xhr.waitForRequest();
    await act(async () => { await Promise.resolve(); });
    expect(xhr.requests).toHaveLength(1);
    await act(async () => { xhr.last.respond(200, { Id: "1", Key: "recordings/x" }); });
    await waitFor(() => expect(notify.find("Published to your subgroup")).toBeTruthy());
    expect(fake.from("recordings", "insert").calls).toHaveLength(1);
  });

  it("a take that is refused keeps the form as typed, says Failed on its row, and Retry sends the save again", async () => {
    const xhr = installFakeXhr();
    fake.from("recordings", "insert").reply(ok({ id: 41 }));
    const { notify, inside } = await openStudio();
    fireEvent.change(inside.getByLabelText("Notation text"), { target: { value: "S R G M" } });
    fireEvent.click(inside.getByRole("button", { name: "Save draft" }));
    await xhr.waitForRequest();
    await act(async () => { xhr.last.respond(413, { message: "The object exceeded the maximum allowed size", statusCode: "413" }); });
    await waitFor(() => expect(toastsOf(notify)).toEqual(["The object exceeded the maximum allowed size"]));
    expect(inside.getByText("Failed")).toBeInTheDocument();
    expect(inside.getByLabelText("Title")).toHaveValue("Varnam");
    expect(inside.getByLabelText("Notation text")).toHaveValue("S R G M");
    expect(fake.from("recordings", "insert").calls).toHaveLength(0);
    fireEvent.click(inside.getByRole("button", { name: "Retry take.mp3" }));
    await waitFor(() => expect(xhr.requests).toHaveLength(2));
    await act(async () => { xhr.last.respond(200, { Id: "1", Key: "recordings/x" }); });
    await waitFor(() => expect(notify.find("Draft saved")).toBeTruthy());
    // A retry of a draft save is a draft save: not a publication.
    expect(fake.from("recordings", "insert").calls[0].payload).toMatchObject({ status: "draft" });
  });

  it("while the files go up nothing closes the studio (Escape, a click beside it, the close button); afterwards they do", async () => {
    const xhr = installFakeXhr();
    const { dialog, inside } = await openStudio();
    fireEvent.click(inside.getByRole("button", { name: "Publish to subgroup" }));
    await xhr.waitForRequest();
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(dialog.parentElement!);
    expect(inside.getByRole("button", { name: "Close recording studio" })).toBeDisabled();
    expect(screen.getByRole("dialog", { name: "Recording studio" })).toBeInTheDocument();
    await act(async () => { xhr.last.networkError(); });
    await waitFor(() => expect(inside.getByRole("button", { name: "Close recording studio" })).toBeEnabled());
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Recording studio" })).not.toBeInTheDocument());
  });

  it("a click beside the studio does not close it, because what was typed would be lost", async () => {
    installFakeXhr();
    const { dialog } = await openStudio();
    fireEvent.mouseDown(dialog.parentElement!);
    fireEvent.click(dialog.parentElement!);
    expect(screen.getByRole("dialog", { name: "Recording studio" })).toBeInTheDocument();
  });
});
