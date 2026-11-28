"use client";

import type { FormEvent } from "react";
import { Button } from "../../../components/ui/button";
import { categoryLabels, formatDateTime } from "../display";
import type { AttendanceSession } from "../model";

// A member's absence form: the meeting, the reason, whether an executive was told, and an optional proof image.
export function AbsenceFormDialog({ sessions, saving, onSubmit, onClose }: {
  sessions: AttendanceSession[];
  saving: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onClose: () => void;
}) {
  return <div className="modal-backdrop"><form className="modal attendance-modal" onSubmit={onSubmit}><button type="button" className="modal-close" onClick={onClose}>×</button><p className="eyebrow">PRIVATE SUBMISSION</p><h2>Absence form</h2><p className="modal-copy">Submit this for every absence. An executive will decide whether it is excused.</p><label>Meeting<select name="session_id" required defaultValue=""><option value="" disabled>Choose a meeting</option>{sessions.filter((session) => session.status !== "canceled").map((session) => <option value={session.id} key={session.id}>{session.title} · {formatDateTime(session.starts_at)}</option>)}</select></label><label>Reason category<select name="reason_category" defaultValue="other">{Object.entries(categoryLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label>What happened<textarea name="reason" required rows={4} minLength={10} maxLength={3000} placeholder="Share the context executives need to review…" /></label><label className="check-label"><input name="notified" type="checkbox" /> I notified an executive</label><label>Proof image <span className="optional-label">(optional)</span><input name="proof" type="file" accept="image/*" /><small>JPG, PNG, HEIC, or another image up to 8 MB.</small></label><Button type="submit" disabled={saving}>{saving ? "Submitting…" : "Submit form"}</Button></form></div>;
}
