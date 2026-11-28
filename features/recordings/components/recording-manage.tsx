"use client";

import { useState, type FormEvent } from "react";
import type { User } from "@supabase/supabase-js";
import { attempt } from "../../../lib/api/attempt";
import { deleteRecordingNote, deleteRecordingRow, recordingBucket, removeNotationFile, removeRecordingTake, setRecordingStatus, updateRecordingDetails, updateRecordingNote } from "../../../lib/api/recordings";
import type { Tables } from "../../../lib/db";
import { friendlyError } from "../../../lib/errors";
import { Button } from "../../../components/ui/button";
import { ConfirmDialog } from "../../../components/ui/confirm-dialog";
import { Dialog } from "../../../components/ui/dialog";
import { Input } from "../../../components/ui/input";
import { Textarea } from "../../../components/ui/textarea";
import { useToast } from "../../../components/ui/toast";

export type ManagedRecording = Pick<Tables<"recordings">, "id" | "title" | "description" | "uploaded_by" | "storage_path" | "status" | "recording_kind" | "raga" | "tala" | "sruthi" | "tempo">
  & Partial<Pick<Tables<"recordings">, "storage_bucket">>;
// note_type is text with a CHECK constraint, so the generated type is `string`; the UI knows the two values.
export type ManagedNote = Pick<Tables<"recording_notes">, "id" | "recording_id" | "title" | "body" | "storage_path" | "mime_type">
  & Partial<Pick<Tables<"recording_notes">, "uploaded_by">> & { note_type: "text" | "file" };

// Storage only lets a file be deleted while its database row still exists, so
// files always go first. remove() answers a refused delete with an empty list
// and no error, so an empty answer counts as a failure unless the file can no
// longer be signed (it is gone: a retry after a partly finished delete).
// (lib/api/recordings.ts: removeRecordingTake and removeNotationFile.)

export function RecordingManageBar({ recording, user, canManage, notes, onChanged, onRemoved }: {
  recording: ManagedRecording; user: User; canManage: boolean; notes: ManagedNote[];
  onChanged: () => void | Promise<void>; onRemoved: () => void | Promise<void>;
}) {
  const { notify } = useToast();
  const [dialog, setDialog] = useState<"edit" | "archive" | "restore" | "delete" | null>(null);
  const [busy, setBusy] = useState(false);
  const mine = recording.uploaded_by === user.id;
  if (!mine && !canManage) return null;
  const sharedWithLegacy = recordingBucket(recording) !== "recordings";

  async function saveDetails(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const text = (name: string) => String(form.get(name) || "").trim();
    setBusy(true);
    const { data, error } = await attempt(() => updateRecordingDetails(recording.id, {
      title: text("title"), description: text("description"), recording_kind: text("recording_kind") || recording.recording_kind,
      raga: text("raga") || null, tala: text("tala") || null, sruthi: text("sruthi") || null, tempo: text("tempo") || null,
    }));
    setBusy(false);
    if (error || !data?.length) { notify(friendlyError(error, "You do not have permission to edit this recording."), "error"); return; }
    setDialog(null); notify("Recording details saved"); await onChanged();
  }

  async function setStatus(status: "archived" | "published") {
    setBusy(true);
    const { data, error } = await attempt(() => setRecordingStatus(recording.id, status));
    setBusy(false);
    if (error || !data?.length) { notify(friendlyError(error, "You do not have permission to change this recording."), "error"); return; }
    setDialog(null); notify(status === "archived" ? "Recording archived" : "Recording restored"); await onRemoved();
  }

  async function deleteRecording() {
    setBusy(true);
    // 1. notation files, 2. the take itself, 3. the row (notes go with it).
    for (const note of notes) {
      if (!note.storage_path) continue;
      const problem = await removeNotationFile(note.storage_path);
      if (problem) { setBusy(false); notify(problem, "error"); return; }
    }
    const problem = await removeRecordingTake(recording.storage_path);
    if (problem) { setBusy(false); notify(problem, "error"); return; }
    const { data, error } = await attempt(() => deleteRecordingRow(recording.id));
    setBusy(false);
    if (error || !data?.length) { notify(friendlyError(error, "The recording could not be deleted."), "error"); return; }
    setDialog(null); notify("Recording deleted"); await onRemoved();
  }

  return <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-[var(--line)] pt-4">
    <span className="mr-auto text-xs uppercase tracking-wide text-[#4c5f6b]">{mine ? "Your recording" : "Manage as executive"}{recording.status === "archived" ? " · Archived" : ""}</span>
    <Button variant="secondary" size="sm" onClick={() => setDialog("edit")}>Edit details</Button>
    {recording.status === "archived"
      ? <Button variant="secondary" size="sm" onClick={() => setDialog("restore")}>Restore</Button>
      : <Button variant="secondary" size="sm" onClick={() => setDialog("archive")}>Archive</Button>}
    {!sharedWithLegacy && <Button variant="danger" size="sm" onClick={() => setDialog("delete")}>Delete</Button>}

    <Dialog open={dialog === "edit"} onClose={busy ? () => {} : () => setDialog(null)} className="max-w-[560px]">
      <h2 className="m-0 text-2xl">Edit recording details</h2>
      <form className="mt-4 grid gap-3" onSubmit={saveDetails}>
        <label className="grid gap-1 text-sm font-semibold" htmlFor="recording-edit-title">Title<Input id="recording-edit-title" name="title" defaultValue={recording.title} required maxLength={160} /></label>
        <label className="grid gap-1 text-sm font-semibold" htmlFor="recording-edit-description">Description<Textarea id="recording-edit-description" name="description" defaultValue={recording.description} rows={3} /></label>
        <label className="grid gap-1 text-sm font-semibold" htmlFor="recording-edit-kind">Recording type<select id="recording-edit-kind" name="recording_kind" defaultValue={recording.recording_kind}><option value="practice">Practice</option><option value="rehearsal">Rehearsal</option><option value="lesson">Lesson</option><option value="performance">Performance</option><option value="workshop">Workshop</option></select></label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1 text-sm font-semibold" htmlFor="recording-edit-raga">Raga / raag<Input id="recording-edit-raga" name="raga" defaultValue={recording.raga || ""} /></label>
          <label className="grid gap-1 text-sm font-semibold" htmlFor="recording-edit-tala">Tala / taal<Input id="recording-edit-tala" name="tala" defaultValue={recording.tala || ""} /></label>
          <label className="grid gap-1 text-sm font-semibold" htmlFor="recording-edit-sruthi">Sruthi / tonic<Input id="recording-edit-sruthi" name="sruthi" defaultValue={recording.sruthi || ""} /></label>
          <label className="grid gap-1 text-sm font-semibold" htmlFor="recording-edit-tempo">Tempo / laya<Input id="recording-edit-tempo" name="tempo" defaultValue={recording.tempo || ""} /></label>
        </div>
        <div className="mt-3 flex flex-wrap justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => setDialog(null)} disabled={busy}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save details"}</Button>
        </div>
      </form>
    </Dialog>

    <ConfirmDialog open={dialog === "archive"} title="Archive this recording?" confirmLabel="Archive" busy={busy} onConfirm={() => setStatus("archived")} onCancel={() => setDialog(null)}>
      It disappears from the group&apos;s list but nothing is deleted. You can restore it from the Archived tab.
    </ConfirmDialog>
    <ConfirmDialog open={dialog === "restore"} title="Restore this recording?" confirmLabel="Restore" busy={busy} onConfirm={() => setStatus("published")} onCancel={() => setDialog(null)}>
      It becomes visible to the group again.
    </ConfirmDialog>
    <ConfirmDialog open={dialog === "delete"} title="Delete this recording for good?" confirmLabel="Delete recording" danger busy={busy} onConfirm={deleteRecording} onCancel={() => setDialog(null)}>
      The take{notes.length ? ` and its ${notes.length} notation ${notes.length === 1 ? "item" : "items"}` : ""} will be permanently deleted. This cannot be undone. Archive it instead if you might want it back.
    </ConfirmDialog>
  </div>;
}

export function NoteActions({ note, user, canManage, onChanged }: {
  note: ManagedNote; user: User; canManage: boolean; onChanged: () => void | Promise<void>;
}) {
  const { notify } = useToast();
  const [dialog, setDialog] = useState<"edit" | "delete" | null>(null);
  const [busy, setBusy] = useState(false);
  if (note.uploaded_by !== user.id && !canManage) return null;

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const changes: { title: string; body?: string } = { title: String(form.get("title") || "").trim() };
    if (note.note_type === "text") changes.body = String(form.get("body") || "").trim();
    setBusy(true);
    const { data, error } = await attempt(() => updateRecordingNote(note.id, changes));
    setBusy(false);
    if (error || !data?.length) { notify(friendlyError(error, "You do not have permission to edit this note."), "error"); return; }
    setDialog(null); notify("Notation saved"); await onChanged();
  }

  async function remove() {
    setBusy(true);
    if (note.storage_path) {
      const problem = await removeNotationFile(note.storage_path);
      if (problem) { setBusy(false); notify(problem, "error"); return; }
    }
    const { data, error } = await attempt(() => deleteRecordingNote(note.id));
    setBusy(false);
    if (error || !data?.length) { notify(friendlyError(error, "The notation could not be deleted."), "error"); return; }
    setDialog(null); notify("Notation deleted"); await onChanged();
  }

  return <div className="mt-2 flex gap-2">
    <Button variant="ghost" size="sm" onClick={() => setDialog("edit")}>{note.note_type === "file" ? "Rename" : "Edit"}</Button>
    <Button variant="ghost" size="sm" onClick={() => setDialog("delete")}>Delete</Button>
    <Dialog open={dialog === "edit"} onClose={busy ? () => {} : () => setDialog(null)} className="max-w-[520px]">
      <h2 className="m-0 text-2xl">{note.note_type === "file" ? "Rename notation file" : "Edit notation"}</h2>
      <form className="mt-4 grid gap-3" onSubmit={save}>
        <label className="grid gap-1 text-sm font-semibold" htmlFor={`note-title-${note.id}`}>Title<Input id={`note-title-${note.id}`} name="title" defaultValue={note.title} required maxLength={160} /></label>
        {note.note_type === "text" && <label className="grid gap-1 text-sm font-semibold" htmlFor={`note-body-${note.id}`}>Notation<Textarea id={`note-body-${note.id}`} name="body" defaultValue={note.body} rows={8} required /></label>}
        <div className="mt-3 flex flex-wrap justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => setDialog(null)} disabled={busy}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
        </div>
      </form>
    </Dialog>
    <ConfirmDialog open={dialog === "delete"} title="Delete this notation?" confirmLabel="Delete" danger busy={busy} onConfirm={remove} onCancel={() => setDialog(null)}>
      &ldquo;{note.title}&rdquo; will be permanently removed from this recording.
    </ConfirmDialog>
  </div>;
}
