"use client";

import { useRef, type FormEvent } from "react";
import { Button } from "../../../components/ui/button";
import { Dialog } from "../../../components/ui/dialog";
import { IconButton } from "../../../components/ui/icon-button";
import { UploadProgress, type UploadItem } from "../../../components/ui/upload-progress";
import { categoryLabels, formatDateTime } from "../display";
import type { AttendanceSession } from "../model";

// A member's absence form: the meeting, the reason, whether an executive was told, and an optional proof image. It is a dialog:
// named by its heading, focus starts on the first field, Escape and the × close it (not while it is being sent, and a click
// beside it does not, so what was typed is not lost).
export function AbsenceFormDialog({ sessions, saving, uploads = [], onSubmit, onClose }: {
  sessions: AttendanceSession[];
  saving: boolean;
  /** The proof image on its way (one row), with its progress; a failed one has Retry, which sends the form again. */
  uploads?: UploadItem[];
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onClose: () => void;
}) {
  const firstField = useRef<HTMLSelectElement>(null);
  const form = useRef<HTMLFormElement>(null);
  return <Dialog open onClose={onClose} dismissible={!saving} closeOnBackdrop={false} labelledBy="absence-form-title" describedBy="absence-form-copy" initialFocus={firstField} className="modal attendance-modal">
    <IconButton className="modal-close" aria-label="Close the absence form" onClick={onClose} disabled={saving}>×</IconButton>
    <form ref={form} onSubmit={onSubmit}>
      <p className="eyebrow">PRIVATE SUBMISSION</p>
      <h2 id="absence-form-title">Absence form</h2>
      <p id="absence-form-copy" className="modal-copy">Submit this for every absence. An executive will decide whether it is excused.</p>
      <label>Meeting<select ref={firstField} name="session_id" required defaultValue=""><option value="" disabled>Choose a meeting</option>{sessions.filter((session) => session.status !== "canceled").map((session) => <option value={session.id} key={session.id}>{session.title} · {formatDateTime(session.starts_at)}</option>)}</select></label>
      <label>Reason category<select name="reason_category" defaultValue="other">{Object.entries(categoryLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
      <label>What happened<textarea name="reason" required rows={4} minLength={10} maxLength={3000} placeholder="Share the context executives need to review…" /></label>
      <label className="check-label"><input name="notified" type="checkbox" /> I notified an executive</label>
      <label>Proof image <span className="optional-label">(optional)</span><input name="proof" type="file" accept="image/*" aria-describedby="absence-proof-help" /><small id="absence-proof-help">JPG, PNG, HEIC, or another image up to 8 MB.</small></label>
      <UploadProgress items={uploads} label="Proof image upload" onRetry={() => form.current?.requestSubmit()} />
      <Button type="submit" pending={saving}>{saving ? "Submitting…" : "Submit form"}</Button>
    </form>
  </Dialog>;
}
