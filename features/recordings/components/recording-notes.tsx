"use client";

import type { User } from "@supabase/supabase-js";
import type { RecordingNote } from "../model";
import { NoteActions } from "./recording-manage";

/** The notation attached to a recording: text notes inline, files as a link that opens them, and the owner's controls per note. */
export function RecordingNotes({ notes, user, canManage, onOpenNote, onChanged }: {
  notes: RecordingNote[]; user: User; canManage: boolean;
  onOpenNote: (note: RecordingNote) => void; onChanged: () => void | Promise<void>;
}) {
  return <section className="notation-panel"><div className="notation-panel-heading"><div><p className="eyebrow">FOLLOW ALONG</p><h3>Notation and notes</h3></div><span>{notes.length}</span></div>{notes.length ? notes.map((note) => <article className="notation-item" key={note.id}>{note.note_type === "file" ? <button type="button" onClick={() => onOpenNote(note)}><span>▤</span>{note.title}<i>Open file →</i></button> : <><h4>{note.title}</h4><p>{note.body}</p></>}<NoteActions note={note} user={user} canManage={canManage} onChanged={onChanged} /></article>) : <p className="notation-empty">No notation attached yet.</p>}</section>;
}
