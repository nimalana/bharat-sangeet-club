"use client";

import type { User } from "@supabase/supabase-js";
import { ErrorBlock } from "../../../components/ui/error-block";
import { SkeletonRows } from "../../../components/ui/skeleton";
import type { RecordingNote } from "../model";
import { NoteActions } from "./recording-manage";

/**
 * The notation attached to a recording: text notes inline, files as a button that opens them, and the owner's controls per note.
 * While it is first read it shows a skeleton, and a first read that failed says so with Try again (it is not "nothing attached").
 */
export function RecordingNotes({ notes, notesState = "ready", onRetry, user, canManage, onOpenNote, onChanged }: {
  notes: RecordingNote[]; user: User; canManage: boolean;
  /** Default "ready": the notes given are the whole list. */
  notesState?: "loading" | "ready" | "failed"; onRetry?: () => void;
  onOpenNote: (note: RecordingNote) => void; onChanged: () => void | Promise<void>;
}) {
  return <section className="notation-panel" aria-labelledby="notation-heading"><div className="notation-panel-heading"><div><p className="eyebrow">FOLLOW ALONG</p><h3 id="notation-heading">Notation and notes</h3></div>{notesState === "ready" && <span>{notes.length}</span>}</div>
    {notesState === "loading" ? <SkeletonRows rows={2} label="Loading the notation" className="notation-skeleton" />
      : notesState === "failed" ? <ErrorBlock role="alert" message="The notation could not be loaded." onRetry={() => onRetry?.()} />
      : notes.length ? notes.map((note) => <article className="notation-item" key={note.id}>{note.note_type === "file" ? <button type="button" onClick={() => onOpenNote(note)}><span aria-hidden="true">▤</span>{note.title}<i>Open file →</i></button> : <><h4>{note.title}</h4><p>{note.body}</p></>}<NoteActions note={note} user={user} canManage={canManage} onChanged={onChanged} /></article>)
      : <p className="notation-empty">No notation attached yet.</p>}
  </section>;
}
