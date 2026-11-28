// What a person does to a recording after it is saved, and to the club's older recordings: edit, archive and restore, delete,
// the notation items, the club recording list and the form that adds one. people-recordings.test.tsx pins the part that touches
// stored files (the order of the deletes, an empty answer from storage, the orphan clean-up); this file pins the rest, so the
// screens can be moved or split without losing what they say and send.
//
// Everything runs for real against the fake client: what a write sent is read from the call, what the person sees from the DOM
// and from the toasts the screen asked for.
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ArchiveModal } from "../../features/recordings/components/archive-modal";
import { ClubArchiveManager, type ClubArchiveItem } from "../../features/recordings/components/club-archive-manager";
import { NoteActions, RecordingManageBar, type ManagedNote, type ManagedRecording } from "../../features/recordings/components/recording-manage";
import { notifySpy, userOf } from "../support/helpers";
import { deferred, fail, fake, ok } from "../support/fake-supabase";

const typeInto = (scope: HTMLElement, label: string, value: string) => fireEvent.change(within(scope).getByLabelText(label), { target: { value } });
const submitIn = (scope: HTMLElement) => fireEvent.submit(scope.querySelector("form")!);
const confirmIn = (name: string) => fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name }));

// ---------------------------------------------------------------------------------------------------------------
// The manage bar under a recording
// ---------------------------------------------------------------------------------------------------------------

const MANAGED: ManagedRecording = {
  id: 1, title: "Varnam take", description: "", uploaded_by: "u-me", storage_path: "u-me/take.mp3", status: "published", recording_kind: "practice",
  raga: null, tala: null, sruthi: null, tempo: null,
};
const FILE_NOTE: ManagedNote = { id: 3, recording_id: 1, title: "Sargam", note_type: "file", body: "", storage_path: "u-me/sargam.pdf", mime_type: "application/pdf", uploaded_by: "u-me" };
const TEXT_NOTE: ManagedNote = { id: 4, recording_id: 1, title: "Alaap", note_type: "text", body: "S R G M", storage_path: null, mime_type: null, uploaded_by: "u-me" };

function renderBar(recording: Partial<ManagedRecording> = {}, options: { notes?: ManagedNote[]; canManage?: boolean } = {}) {
  const notify = notifySpy();
  const onChanged = vi.fn();
  const onRemoved = vi.fn();
  render(<RecordingManageBar recording={{ ...MANAGED, ...recording }} user={userOf("u-me")} canManage={options.canManage ?? false} notes={options.notes ?? [FILE_NOTE]} onChanged={onChanged} onRemoved={onRemoved} />);
  return { notify, onChanged, onRemoved };
}
const updates = () => fake.from("recordings", "update").calls;

describe("the manage bar: who sees it and what it says", () => {
  it("the maker sees 'Your recording'", () => {
    renderBar();
    expect(screen.getByText("Your recording")).toBeInTheDocument();
    expect(screen.queryByText(/Manage as executive/)).not.toBeInTheDocument();
  });

  it("an executive managing someone else's recording is told so", () => {
    renderBar({ uploaded_by: "someone-else" }, { canManage: true });
    expect(screen.getByText("Manage as executive")).toBeInTheDocument();
    expect(screen.queryByText(/Your recording/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit details" })).toBeInTheDocument();
  });

  it("a published recording offers Archive and does not call itself archived", () => {
    renderBar();
    expect(screen.getByRole("button", { name: "Archive" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Restore" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Archived/)).not.toBeInTheDocument();
  });

  it("an archived recording says so and offers Restore in place of Archive", () => {
    renderBar({ status: "archived" });
    expect(screen.getByText("Your recording · Archived")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Restore" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Archive" })).not.toBeInTheDocument();
  });
});

describe("editing a recording's details", () => {
  function openEdit() {
    fireEvent.click(screen.getByRole("button", { name: "Edit details" }));
    return screen.getByRole("dialog");
  }

  it("sends the text trimmed, the chosen type and the optional fields, then closes, says so and reloads", async () => {
    fake.from("recordings", "update").reply(ok([{ id: 1 }]));
    const { notify, onChanged, onRemoved } = renderBar();
    const dialog = openEdit();
    expect(within(dialog).getByText("Edit recording details")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Title")).toHaveValue("Varnam take");
    typeInto(dialog, "Title", "  Varnam, second take  ");
    typeInto(dialog, "Description", "  Slow tempo  ");
    typeInto(dialog, "Recording type", "lesson");
    typeInto(dialog, "Raga / raag", "  Bhairavi ");
    typeInto(dialog, "Tala / taal", " Adi");
    typeInto(dialog, "Sruthi / tonic", "C# ");
    typeInto(dialog, "Tempo / laya", " Vilamba ");
    submitIn(dialog);
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(updates()).toHaveLength(1);
    expect(updates()[0].payload).toEqual({ title: "Varnam, second take", description: "Slow tempo", recording_kind: "lesson", raga: "Bhairavi", tala: "Adi", sruthi: "C#", tempo: "Vilamba" });
    expect(updates()[0].used("eq", "id", 1)).toBe(true);
    expect(notify.toasts()).toEqual([{ message: "Recording details saved", tone: undefined }]);
    expect(onRemoved).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("an optional field left empty (or only spaces) is sent as null; a type the form did not send keeps the current one", async () => {
    fake.from("recordings", "update").reply(ok([{ id: 1 }]));
    const { onChanged } = renderBar({ raga: "Todi", tala: "Adi", sruthi: "D", tempo: "Madhyama", recording_kind: "lesson", description: "Old" });
    const dialog = openEdit();
    expect(within(dialog).getByLabelText("Recording type")).toHaveValue("lesson");
    expect(within(dialog).getByLabelText("Raga / raag")).toHaveValue("Todi");
    typeInto(dialog, "Description", "");
    typeInto(dialog, "Raga / raag", "");
    typeInto(dialog, "Tala / taal", "");
    typeInto(dialog, "Sruthi / tonic", "");
    typeInto(dialog, "Tempo / laya", "   ");
    // A select with nothing chosen sends no value at all.
    typeInto(dialog, "Recording type", "");
    submitIn(dialog);
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(updates()[0].payload).toEqual({ title: "Varnam take", description: "", recording_kind: "lesson", raga: null, tala: null, sruthi: null, tempo: null });
  });

  it("an update that changed no row (a policy hid the recording) says so and keeps the dialog open", async () => {
    fake.from("recordings", "update").reply(ok([]));
    const { notify, onChanged } = renderBar();
    const dialog = openEdit();
    submitIn(dialog);
    await waitFor(() => expect(notify.find("You do not have permission to edit this recording.").tone).toBe("error"));
    expect(notify.toasts()).toHaveLength(1);
    expect(onChanged).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(within(screen.getByRole("dialog")).getByRole("button", { name: "Save details" })).toBeEnabled();
  });

  it("a database error is shown in words; a raw one is replaced by the sentence", async () => {
    fake.from("recordings", "update").replyOnce(fail("new row violates row-level security policy")).replyOnce(fail("only the maker can change a published recording"));
    const { notify, onChanged } = renderBar();
    const dialog = openEdit();
    submitIn(dialog);
    await waitFor(() => expect(notify.toasts()).toHaveLength(1));
    expect(notify.toasts()[0]).toEqual({ message: "You do not have permission to edit this recording.", tone: "error" });
    submitIn(screen.getByRole("dialog"));
    await waitFor(() => expect(notify.toasts()).toHaveLength(2));
    expect(notify.toasts()[1]).toEqual({ message: "Only the maker can change a published recording", tone: "error" });
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("while saving the button says so, Cancel is off and Escape does not close the dialog", async () => {
    const slow = deferred();
    fake.from("recordings", "update").reply(slow.reply);
    const { onChanged } = renderBar();
    const dialog = openEdit();
    submitIn(dialog);
    expect(await within(dialog).findByRole("button", { name: "Saving…" })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeDisabled();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await act(async () => { slow.resolve(ok([{ id: 1 }])); });
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("Cancel and Escape close the dialog without sending anything", () => {
    renderBar();
    const dialog = openEdit();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    openEdit();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(updates()).toHaveLength(0);
  });
});

describe("archiving and restoring a recording", () => {
  it("Archive asks first, then sets the status, says so and tells the list the recording is gone from it", async () => {
    fake.from("recordings", "update").reply(ok([{ id: 1 }]));
    const { notify, onChanged, onRemoved } = renderBar();
    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    expect(within(screen.getByRole("dialog")).getByText("Archive this recording?")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toHaveTextContent("It disappears from the group's list but nothing is deleted. You can restore it from the Archived tab.");
    expect(updates()).toHaveLength(0);
    // Cancel changes nothing.
    confirmIn("Cancel");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(updates()).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    confirmIn("Archive");
    await waitFor(() => expect(onRemoved).toHaveBeenCalledTimes(1));
    expect(updates()).toHaveLength(1);
    expect(updates()[0].payload).toEqual({ status: "archived" });
    expect(updates()[0].used("eq", "id", 1)).toBe(true);
    expect(notify.toasts()).toEqual([{ message: "Recording archived", tone: undefined }]);
    expect(onChanged).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("Restore publishes the recording again", async () => {
    fake.from("recordings", "update").reply(ok([{ id: 1 }]));
    const { notify, onChanged, onRemoved } = renderBar({ status: "archived" });
    fireEvent.click(screen.getByRole("button", { name: "Restore" }));
    expect(within(screen.getByRole("dialog")).getByText("Restore this recording?")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toHaveTextContent("It becomes visible to the group again.");
    confirmIn("Restore");
    await waitFor(() => expect(onRemoved).toHaveBeenCalledTimes(1));
    expect(updates()[0].payload).toEqual({ status: "published" });
    expect(notify.toasts()).toEqual([{ message: "Recording restored", tone: undefined }]);
    expect(onChanged).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("a change that touched no row is refused in words, and the confirmation stays", async () => {
    fake.from("recordings", "update").reply(ok([]));
    const { notify, onRemoved } = renderBar();
    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    confirmIn("Archive");
    await waitFor(() => expect(notify.find("You do not have permission to change this recording.").tone).toBe("error"));
    expect(onRemoved).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(within(screen.getByRole("dialog")).getByRole("button", { name: "Archive" })).toBeEnabled();
  });

  it("while the change is on its way the confirmation says it is working and cannot be answered twice", async () => {
    const slow = deferred();
    fake.from("recordings", "update").reply(slow.reply);
    const { onRemoved } = renderBar();
    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    confirmIn("Archive");
    expect(await within(screen.getByRole("dialog")).findByRole("button", { name: "Working…" })).toBeDisabled();
    expect(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" })).toBeDisabled();
    await act(async () => { slow.resolve(ok([{ id: 1 }])); });
    await waitFor(() => expect(onRemoved).toHaveBeenCalledTimes(1));
    expect(updates()).toHaveLength(1);
  });
});

describe("deleting a recording: what the confirmation says and what is refused", () => {
  it("names how many notation items go with the take, in the singular and the plural", () => {
    renderBar({}, { notes: [FILE_NOTE] });
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Delete this recording for good?")).toBeInTheDocument();
    expect(dialog).toHaveTextContent("The take and its 1 notation item will be permanently deleted. This cannot be undone. Archive it instead if you might want it back.");
  });

  it("two items are counted as items", () => {
    renderBar({}, { notes: [FILE_NOTE, TEXT_NOTE] });
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("The take and its 2 notation items will be permanently deleted.");
  });

  it("a recording with no notation says only that the take goes", () => {
    renderBar({}, { notes: [] });
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("The take will be permanently deleted. This cannot be undone.");
    expect(dialog).not.toHaveTextContent("notation");
  });

  it("a text note has no file: only the notation files are removed, one request each, then the take", async () => {
    fake.from("recordings", "delete").reply(ok([{ id: 1 }]));
    const second: ManagedNote = { ...FILE_NOTE, id: 5, storage_path: "u-me/tabla.pdf" };
    const { onRemoved } = renderBar({}, { notes: [FILE_NOTE, TEXT_NOTE, second] });
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    confirmIn("Delete recording");
    await waitFor(() => expect(onRemoved).toHaveBeenCalledTimes(1));
    expect(fake.storage("recording-notations", "remove").calls.map((call) => call.args[0])).toEqual([["u-me/sargam.pdf"], ["u-me/tabla.pdf"]]);
    expect(fake.storage("recordings", "remove").calls.map((call) => call.args[0])).toEqual([["u-me/take.mp3"]]);
  });

  it("a row that was not deleted (a policy hid it) is refused in words, and the person can try again", async () => {
    fake.from("recordings", "delete").reply(ok([]));
    const { notify, onRemoved } = renderBar();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    confirmIn("Delete recording");
    await waitFor(() => expect(notify.find("The recording could not be deleted.").tone).toBe("error"));
    expect(onRemoved).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete recording" })).toBeEnabled();
  });

  it("a database error on the row is shown as the same sentence when it is a raw one", async () => {
    fake.from("recordings", "delete").reply(fail("update or delete on table violates foreign key constraint"));
    const { notify, onRemoved } = renderBar();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    confirmIn("Delete recording");
    await waitFor(() => expect(notify.toasts()).toHaveLength(1));
    expect(notify.toasts()[0]).toEqual({ message: "The recording could not be deleted.", tone: "error" });
    expect(onRemoved).not.toHaveBeenCalled();
  });

  it("a deleted recording is reported, the confirmation closes and the list is told to drop it", async () => {
    fake.from("recordings", "delete").reply(ok([{ id: 1 }]));
    const { notify, onChanged, onRemoved } = renderBar();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    confirmIn("Delete recording");
    await waitFor(() => expect(onRemoved).toHaveBeenCalledTimes(1));
    expect(notify.toasts()).toEqual([{ message: "Recording deleted", tone: undefined }]);
    expect(onChanged).not.toHaveBeenCalled();
    expect(fake.from("recordings", "delete").calls[0].used("eq", "id", 1)).toBe(true);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------------------------------------------
// One notation item
// ---------------------------------------------------------------------------------------------------------------

describe("a notation item: rename, edit and delete", () => {
  function renderNote(item: Partial<ManagedNote> = {}, options: { canManage?: boolean } = {}) {
    const notify = notifySpy();
    const onChanged = vi.fn();
    render(<NoteActions note={{ ...FILE_NOTE, ...item }} user={userOf("u-me")} canManage={options.canManage ?? false} onChanged={onChanged} />);
    return { notify, onChanged };
  }
  const noteUpdates = () => fake.from("recording_notes", "update").calls;

  it("a notation file is renamed: only its title is sent, trimmed", async () => {
    fake.from("recording_notes", "update").reply(ok([{ id: 3 }]));
    const { notify, onChanged } = renderNote();
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Rename notation file")).toBeInTheDocument();
    expect(within(dialog).queryByLabelText("Notation")).not.toBeInTheDocument();
    expect(within(dialog).getByLabelText("Title")).toHaveValue("Sargam");
    typeInto(dialog, "Title", "  Sargam, second page  ");
    submitIn(dialog);
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(noteUpdates()[0].payload).toEqual({ title: "Sargam, second page" });
    expect(noteUpdates()[0].used("eq", "id", 3)).toBe(true);
    expect(notify.toasts()).toEqual([{ message: "Notation saved", tone: undefined }]);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("a text note is edited: the title and the notation are sent, both trimmed", async () => {
    fake.from("recording_notes", "update").reply(ok([{ id: 4 }]));
    const { onChanged } = renderNote(TEXT_NOTE);
    expect(screen.queryByRole("button", { name: "Rename" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Edit notation")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Notation")).toHaveValue("S R G M");
    typeInto(dialog, "Title", "  Alaap, slow ");
    typeInto(dialog, "Notation", "\n  S R G M P  \n");
    submitIn(dialog);
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(noteUpdates()[0].payload).toEqual({ title: "Alaap, slow", body: "S R G M P" });
    expect(noteUpdates()[0].used("eq", "id", 4)).toBe(true);
  });

  it("an update that changed no row is refused in words and the dialog stays", async () => {
    fake.from("recording_notes", "update").reply(ok([]));
    const { notify, onChanged } = renderNote(TEXT_NOTE);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    submitIn(screen.getByRole("dialog"));
    await waitFor(() => expect(notify.find("You do not have permission to edit this note.").tone).toBe("error"));
    expect(onChanged).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("Delete asks first, naming the note, and Cancel changes nothing", () => {
    renderNote(TEXT_NOTE);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Delete this notation?")).toBeInTheDocument();
    expect(dialog).toHaveTextContent("“Alaap” will be permanently removed from this recording.");
    confirmIn("Cancel");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(fake.from("recording_notes", "delete").count).toBe(0);
  });

  it("a row that was not deleted is refused in words and the note stays", async () => {
    fake.from("recording_notes", "delete").reply(ok([]));
    const { notify, onChanged } = renderNote(TEXT_NOTE);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    confirmIn("Delete");
    await waitFor(() => expect(notify.find("The notation could not be deleted.").tone).toBe("error"));
    expect(onChanged).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete" })).toBeEnabled();
  });

  it("a deleted note is reported, the dialog closes and the notation is reloaded", async () => {
    fake.from("recording_notes", "delete").reply(ok([{ id: 4 }]));
    const { notify, onChanged } = renderNote(TEXT_NOTE);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    confirmIn("Delete");
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(notify.toasts()).toEqual([{ message: "Notation deleted", tone: undefined }]);
    expect(fake.from("recording_notes", "delete").calls[0].used("eq", "id", 4)).toBe(true);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("only the person who added a note, or someone who manages recordings, sees its buttons", () => {
    notifySpy();
    const { unmount } = render(<NoteActions note={{ ...FILE_NOTE, uploaded_by: "someone-else" }} user={userOf("u-me")} canManage={false} onChanged={vi.fn()} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    unmount();
    renderNote({ uploaded_by: "someone-else" }, { canManage: true });
    expect(screen.getByRole("button", { name: "Rename" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------------------------------------------
// The club recordings (the older archive)
// ---------------------------------------------------------------------------------------------------------------

const ITEM: ClubArchiveItem = {
  id: 11, title: "Spring concert", description: "", storage_path: "u-1/spring.mp4", visibility: "members", event_date: null, raga: null, tala: null,
  created_at: "2026-04-01T00:00:00Z", is_public: false, subgroup_id: null,
};

function renderArchive(items: ClubArchiveItem[] = [ITEM], groups: Array<{ id: number; name: string }> = []) {
  const notify = notifySpy();
  const onChanged = vi.fn();
  const onAdd = vi.fn();
  render(<ClubArchiveManager items={items} groups={groups} onAdd={onAdd} onChanged={onChanged} />);
  return { notify, onChanged, onAdd };
}
const archiveUpdates = () => fake.from("archive_items", "update").calls;

describe("the club recording list", () => {
  it("says there are none, and Add club recording asks the page for its form", () => {
    const { onAdd } = renderArchive([]);
    expect(screen.getByText("No club recordings yet.")).toBeInTheDocument();
    expect(screen.queryByRole("article")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "＋ Add club recording" }));
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it("each row shows the title, then raga, tala, date and group in that order", () => {
    renderArchive([{ ...ITEM, raga: "Yaman", tala: "Teental", event_date: "2026-04-18", subgroup_id: 3, description: "Not shown while there are details" }], [{ id: 2, name: "Hindustani Vocal" }, { id: 3, name: "Carnatic Violin" }]);
    const row = screen.getByRole("article");
    expect(within(row).getByText("Spring concert")).toBeInTheDocument();
    expect(within(row).getByText("Yaman · Teental · 2026-04-18 · Carnatic Violin")).toBeInTheDocument();
    expect(within(row).queryByText(/Not shown/)).not.toBeInTheDocument();
  });

  it("a recording of a group that is not in the list shows no group, and no details falls back to the description, then to a sentence", () => {
    renderArchive([
      { ...ITEM, id: 1, title: "A", raga: "Todi", subgroup_id: 99 },
      { ...ITEM, id: 2, title: "B", description: "Recorded at the spring concert" },
      { ...ITEM, id: 3, title: "C" },
    ], [{ id: 3, name: "Carnatic Violin" }]);
    const [a, b, c] = screen.getAllByRole("article");
    expect(within(a).getByText("Todi")).toBeInTheDocument();
    expect(within(b).getByText("Recorded at the spring concert")).toBeInTheDocument();
    expect(within(c).getByText("No details added")).toBeInTheDocument();
  });

  it("each row says who can open it: the public page is highlighted, the others are muted", () => {
    renderArchive([
      { ...ITEM, id: 1, title: "A", is_public: true },
      { ...ITEM, id: 2, title: "B", visibility: "members" },
      { ...ITEM, id: 3, title: "C", visibility: "executives" },
    ]);
    const [a, b, c] = screen.getAllByRole("article");
    const badge = (row: HTMLElement, text: string) => within(row).getByText(text);
    expect(badge(a, "Public concert page").className).toContain("carolina-pale");
    expect(badge(b, "All club members").className).toContain("bg-transparent");
    expect(badge(c, "Executives only").className).toContain("bg-transparent");
    expect(badge(a, "Public concert page").className).not.toContain("bg-transparent");
  });
});

describe("opening a club recording", () => {
  it("signs the file for five minutes and opens it in a new tab that cannot reach back", async () => {
    renderArchive();
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    await waitFor(() => expect(window.open).toHaveBeenCalledTimes(1));
    expect(window.open).toHaveBeenCalledWith("https://files.test/club-archive/u-1/spring.mp4?signed", "_blank", "noopener,noreferrer");
    expect(fake.storage("club-archive", "createSignedUrl").calls[0].args).toEqual(["u-1/spring.mp4", 300]);
  });

  it("a file that cannot be signed is reported and nothing is opened", async () => {
    fake.storage("club-archive", "createSignedUrl").reply(fail("Object not found"));
    const { notify } = renderArchive();
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    await waitFor(() => expect(notify.find("This file could not be opened").tone).toBe("error"));
    expect(window.open).not.toHaveBeenCalled();
  });

  it("storage that answers with no link is reported the same way", async () => {
    fake.storage("club-archive", "createSignedUrl").reply(ok(null));
    const { notify } = renderArchive();
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    await waitFor(() => expect(notify.find("This file could not be opened").tone).toBe("error"));
    expect(window.open).not.toHaveBeenCalled();
  });
});

describe("editing a club recording", () => {
  const openEdit = () => { fireEvent.click(screen.getByRole("button", { name: "Edit" })); return screen.getByRole("dialog"); };

  it("starts from what is stored, including who can access it", () => {
    renderArchive([{ ...ITEM, description: "Evening set", raga: "Todi", tala: "Adi", event_date: "2026-04-01", is_public: true }]);
    const dialog = openEdit();
    expect(within(dialog).getByText("Edit club recording")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Title")).toHaveValue("Spring concert");
    expect(within(dialog).getByLabelText("Description")).toHaveValue("Evening set");
    expect(within(dialog).getByLabelText("Raga / raag")).toHaveValue("Todi");
    expect(within(dialog).getByLabelText("Tala / taal")).toHaveValue("Adi");
    expect(within(dialog).getByLabelText("Concert date")).toHaveValue("2026-04-01");
    expect(within(dialog).getByLabelText("Who can access this?")).toHaveValue("public");
  });

  it("sends the text trimmed (an empty or blank optional field as null) and the access as its two columns", async () => {
    fake.from("archive_items", "update").reply(ok([{ id: 11 }]));
    const { notify, onChanged } = renderArchive();
    const dialog = openEdit();
    typeInto(dialog, "Title", "  Spring concert 2026  ");
    typeInto(dialog, "Description", "  Evening set  ");
    typeInto(dialog, "Raga / raag", "  Yaman ");
    typeInto(dialog, "Tala / taal", "   ");
    typeInto(dialog, "Concert date", "2026-04-18");
    typeInto(dialog, "Who can access this?", "public");
    submitIn(dialog);
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(archiveUpdates()).toHaveLength(1);
    expect(archiveUpdates()[0].payload).toEqual({
      title: "Spring concert 2026", description: "Evening set", raga: "Yaman", tala: null, event_date: "2026-04-18", visibility: "members", is_public: true,
    });
    expect(archiveUpdates()[0].used("eq", "id", 11)).toBe(true);
    expect(notify.toasts()).toEqual([{ message: "Recording updated", tone: undefined }]);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    // Making a recording public is not lowering it: the recording room is not asked.
    expect(fake.from("recordings", "select").count).toBe(0);
  });

  it("clearing raga, tala and the date sends null for each", async () => {
    fake.from("archive_items", "update").reply(ok([{ id: 11 }]));
    const { onChanged } = renderArchive([{ ...ITEM, raga: "Todi", tala: "Adi", event_date: "2026-04-01" }]);
    const dialog = openEdit();
    typeInto(dialog, "Raga / raag", "");
    typeInto(dialog, "Tala / taal", "");
    typeInto(dialog, "Concert date", "");
    submitIn(dialog);
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(archiveUpdates()[0].payload).toEqual({ title: "Spring concert", description: "", raga: null, tala: null, event_date: null, visibility: "members", is_public: false });
  });

  it("an update that changed no row is refused in words and the dialog stays", async () => {
    fake.from("archive_items", "update").reply(ok([]));
    const { notify, onChanged } = renderArchive();
    submitIn(openEdit());
    await waitFor(() => expect(notify.find("You do not have permission to edit this recording.").tone).toBe("error"));
    expect(onChanged).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(within(screen.getByRole("dialog")).getByRole("button", { name: "Save changes" })).toBeEnabled();
  });

  it("a check of the recording room that fails with a raw error is shown as the sentence, in the dialog", async () => {
    fake.from("recordings", "select").reply(fail("permission denied for table recordings"));
    renderArchive();
    const dialog = openEdit();
    typeInto(dialog, "Who can access this?", "executives");
    submitIn(dialog);
    expect(await screen.findByRole("alert")).toHaveTextContent("The recording could not be checked.");
    expect(archiveUpdates()).toHaveLength(0);
    expect(within(screen.getByRole("dialog")).getByRole("button", { name: "Save changes" })).toBeEnabled();
  });

  it("the refusal is cleared when the person tries again, and when the dialog is opened again", async () => {
    fake.from("recordings", "select").reply(ok([{ id: 5 }]));
    fake.from("archive_items", "update").reply(ok([{ id: 11 }]));
    const { onChanged } = renderArchive();
    let dialog = openEdit();
    typeInto(dialog, "Who can access this?", "executives");
    submitIn(dialog);
    expect(await screen.findByRole("alert")).toHaveTextContent("This file also plays in a group's recording room.");
    // Cancel, open again: the old message is not there.
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    dialog = openEdit();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    // Refused again, then a different choice: the message goes while the new save is on its way.
    typeInto(dialog, "Who can access this?", "executives");
    submitIn(dialog);
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    const slow = deferred();
    fake.from("archive_items", "update").reply(slow.reply);
    typeInto(dialog, "Who can access this?", "members");
    submitIn(dialog);
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(within(dialog).getByRole("button", { name: "Saving…" })).toBeDisabled();
    // Neither Cancel nor Escape closes the dialog while the save is on its way.
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeDisabled();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await act(async () => { slow.resolve(ok([{ id: 11 }])); });
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("Cancel closes the dialog without sending anything", () => {
    renderArchive();
    fireEvent.click(within(openEdit()).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(archiveUpdates()).toHaveLength(0);
  });
});

describe("deleting a club recording: what the confirmation says and what is refused", () => {
  it("names the recording; a recording on the public page also says it will leave that page", () => {
    renderArchive([{ ...ITEM, is_public: true }]);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Delete this club recording?")).toBeInTheDocument();
    expect(dialog).toHaveTextContent("“Spring concert” and its file will be permanently deleted and it will disappear from the public concert page. This cannot be undone.");
  });

  it("a recording that is not public does not mention the public page", () => {
    renderArchive();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("“Spring concert” and its file will be permanently deleted. This cannot be undone.");
    expect(dialog).not.toHaveTextContent("public concert page");
  });

  it("a recording that a group plays can be closed after the notice, and the dialog is gone", async () => {
    fake.from("recordings", "select").reply(ok([{ id: 5 }]));
    renderArchive();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    confirmIn("Delete recording");
    expect(await screen.findByText("This recording is in a group's recording room")).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("a row that was not deleted (a policy hid it) is refused in words after the file is gone", async () => {
    fake.from("recordings", "select").reply(ok([]));
    fake.from("archive_items", "delete").reply(ok([]));
    const { notify, onChanged } = renderArchive();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    confirmIn("Delete recording");
    await waitFor(() => expect(notify.find("The recording could not be deleted.").tone).toBe("error"));
    expect(onChanged).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete recording" })).toBeEnabled();
  });

  it("a deleted recording is reported, the confirmation closes and the list is reloaded", async () => {
    fake.from("recordings", "select").reply(ok([]));
    fake.from("archive_items", "delete").reply(ok([{ id: 11 }]));
    const { notify, onChanged } = renderArchive();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    confirmIn("Delete recording");
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(notify.toasts()).toEqual([{ message: "Recording deleted", tone: undefined }]);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------------------------------------------
// The form that adds a club recording
// ---------------------------------------------------------------------------------------------------------------

describe("the form that adds a club recording", () => {
  const SONG = new File(["bytes"], "spring concert.mp4", { type: "video/mp4" });

  function renderModal() {
    const notify = notifySpy();
    const onClose = vi.fn();
    const onSaved = vi.fn();
    const view = render(<ArchiveModal user={userOf("u-me")} onClose={onClose} onSaved={onSaved} />);
    const form = view.container.querySelector("form")!;
    const backdrop = view.container.querySelector(".modal-backdrop")!;
    return { notify, onClose, onSaved, form, backdrop };
  }
  const fill = (form: HTMLElement, values: { title?: string; description?: string; raga?: string; tala?: string; access?: string; file?: File | null }) => {
    if (values.title !== undefined) typeInto(form, "Title", values.title);
    if (values.description !== undefined) typeInto(form, "Description", values.description);
    if (values.raga !== undefined) typeInto(form, "Raga / raag", values.raga);
    if (values.tala !== undefined) typeInto(form, "Tala / taal", values.tala);
    if (values.access !== undefined) typeInto(form, "Who can access this?", values.access);
    if (values.file) fireEvent.change(within(form).getByLabelText("Choose file"), { target: { files: [values.file] } });
  };
  const inserts = () => fake.from("archive_items", "insert").calls;

  it("a save with no file asks for one and sends nothing", () => {
    const { notify, onSaved, form } = renderModal();
    fill(form, { title: "Spring concert" });
    fireEvent.submit(form);
    expect(notify.toasts()).toEqual([{ message: "Choose a file to upload", tone: undefined }]);
    expect(fake.storage("club-archive", "upload").count).toBe(0);
    expect(inserts()).toHaveLength(0);
    expect(onSaved).not.toHaveBeenCalled();
    expect(within(form).getByRole("button", { name: "Save recording" })).toBeEnabled();
  });

  it("a file that cannot be uploaded is said so in a sentence when the error is a raw one, and nothing is saved", async () => {
    fake.storage("club-archive", "upload").reply(fail("new row violates row-level security policy"));
    const { notify, onSaved, form } = renderModal();
    fill(form, { title: "Spring concert", file: SONG });
    fireEvent.submit(form);
    await waitFor(() => expect(notify.toasts()).toHaveLength(1));
    expect(notify.toasts()[0]).toEqual({ message: "The file could not be uploaded.", tone: "error" });
    expect(inserts()).toHaveLength(0);
    expect(onSaved).not.toHaveBeenCalled();
    expect(within(form).getByRole("button", { name: "Save recording" })).toBeEnabled();
  });

  it("saves the text as typed, an empty raga or tala as null, and the default access as All club members", async () => {
    const { notify, onClose, onSaved, form } = renderModal();
    fill(form, { title: "Spring concert", description: "Evening set", file: SONG });
    fireEvent.submit(form);
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    const path = fake.storage("club-archive", "upload").calls[0].args[0] as string;
    expect(inserts()[0].payload).toEqual({
      title: "Spring concert", description: "Evening set", type: "recording", storage_path: path, visibility: "members", is_public: false, raga: null, tala: null, uploaded_by: "u-me",
    });
    expect(notify.toasts()).toEqual([]);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("a raga and a tala are sent when given", async () => {
    const { onSaved, form } = renderModal();
    fill(form, { title: "Spring concert", raga: "Yaman", tala: "Teental", file: SONG });
    fireEvent.submit(form);
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(inserts()[0].payload).toMatchObject({ raga: "Yaman", tala: "Teental" });
  });

  it("Everyone (public concert) is stored as All club members that is also public; Executives only is stored as it is", async () => {
    const first = renderModal();
    fill(first.form, { title: "Spring concert", access: "public", file: SONG });
    fireEvent.submit(first.form);
    await waitFor(() => expect(first.onSaved).toHaveBeenCalled());
    expect(inserts()[0].payload).toMatchObject({ visibility: "members", is_public: true });
    document.body.innerHTML = "";
    const second = renderModal();
    fill(second.form, { title: "Rehearsal", access: "executives", file: SONG });
    fireEvent.submit(second.form);
    await waitFor(() => expect(second.onSaved).toHaveBeenCalled());
    expect(inserts()[1].payload).toMatchObject({ visibility: "executives", is_public: false });
  });

  it("an access the form did not send is treated as All club members", async () => {
    const { onSaved, form } = renderModal();
    fill(form, { title: "Spring concert", file: SONG });
    // A select with nothing chosen sends no value at all.
    fireEvent.change(within(form).getByLabelText("Who can access this?"), { target: { value: "" } });
    fireEvent.submit(form);
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(inserts()[0].payload).toMatchObject({ visibility: "members", is_public: false });
  });

  it("while it saves the button says so and cannot be pressed again", async () => {
    const slow = deferred();
    fake.storage("club-archive", "upload").reply(slow.reply);
    const { onSaved, form } = renderModal();
    fill(form, { title: "Spring concert", file: SONG });
    fireEvent.submit(form);
    expect(await within(form).findByRole("button", { name: "Saving…" })).toBeDisabled();
    await act(async () => { slow.resolve(ok({ path: "u-me/x" })); });
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
  });

  it("a row that cannot be saved removes the file just uploaded and says so, in a sentence when the error is a raw one", async () => {
    fake.from("archive_items", "insert").reply(fail("duplicate key value violates unique constraint"));
    const { notify, onSaved, form } = renderModal();
    fill(form, { title: "Spring concert", file: SONG });
    fireEvent.submit(form);
    await waitFor(() => expect(notify.toasts()).toHaveLength(1));
    expect(notify.toasts()[0]).toEqual({ message: "The recording could not be saved.", tone: "error" });
    const path = fake.storage("club-archive", "upload").calls[0].args[0];
    expect(fake.storage("club-archive", "remove").calls.map((call) => call.args[0])).toEqual([[path]]);
    expect(onSaved).not.toHaveBeenCalled();
    expect(within(form).getByRole("button", { name: "Save recording" })).toBeEnabled();
  });

  it("the close button and a press on the backdrop close the form; a press inside it does not", () => {
    const { onClose, form, backdrop } = renderModal();
    fireEvent.mouseDown(within(form).getByText("Add a club recording"));
    fireEvent.mouseDown(within(form).getByLabelText("Title"));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.mouseDown(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(within(form).getByRole("button", { name: "×" }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
