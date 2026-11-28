"use client";

import { useState, type FormEvent } from "react";
import { attempt } from "../../../lib/api/attempt";
import { clearAttendanceStatus, deleteAttendanceSession, setAttendanceThresholds, updateAttendanceSession, voidAttendanceSession, withdrawAttendanceExcuse } from "../../../lib/api/attendance";
import { friendlyError } from "../../../lib/errors";
import type { Notify } from "../../../lib/toast";
import { Button } from "../../../components/ui/button";
import { ConfirmDialog } from "../../../components/ui/confirm-dialog";
import { Dialog } from "../../../components/ui/dialog";
import { Input } from "../../../components/ui/input";
import { Textarea } from "../../../components/ui/textarea";

type CorrectableSession = { id: number; title: string; starts_at: string; status: "draft" | "open" | "closed" | "canceled"; cancel_reason?: string | null };
type Done = () => void | Promise<void>;

function toLocalInput(value: string) {
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

// Edit or delete a meeting that has not opened, or void a closed one that
// should never have counted.
export function SessionCorrections({ session, notify, onChanged }: { session: CorrectableSession; notify: Notify; onChanged: Done }) {
  const [dialog, setDialog] = useState<"edit" | "delete" | "void" | null>(null);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");

  async function finish(error: { message?: string; code?: string } | null, message: string) {
    setBusy(false);
    if (error) { notify(friendlyError(error, "That change could not be saved."), "error"); return; }
    setDialog(null); setReason(""); notify(message, "success"); await onChanged();
  }

  async function saveEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const startsAt = new Date(String(form.get("starts_at") || ""));
    if (Number.isNaN(startsAt.getTime())) { notify("Choose when the meeting starts."); return; }
    setBusy(true);
    const { error } = await attempt(() => updateAttendanceSession({ sessionId: session.id, title: String(form.get("title") || "").trim(), startsAt: startsAt.toISOString() }));
    await finish(error, "Meeting updated");
  }
  async function remove() {
    setBusy(true);
    const { error } = await attempt(() => deleteAttendanceSession(session.id));
    await finish(error, "Meeting deleted");
  }
  async function voidSession(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    const { error } = await attempt(() => voidAttendanceSession(session.id, reason.trim()));
    await finish(error, "Meeting voided. It no longer counts toward attendance.");
  }

  if (session.status === "canceled") return session.cancel_reason ? <p className="m-0 text-sm text-[#4c5f6b]">Voided: {session.cancel_reason}</p> : null;
  if (session.status === "open") return null;

  return <>
    {session.status === "draft" && <><Button type="button" variant="secondary" size="sm" onClick={() => setDialog("edit")}>Edit</Button><Button type="button" variant="danger" size="sm" onClick={() => setDialog("delete")}>Delete</Button></>}
    {session.status === "closed" && <Button type="button" variant="secondary" size="sm" onClick={() => setDialog("void")}>Void meeting</Button>}

    <Dialog open={dialog === "edit"} onClose={busy ? () => {} : () => setDialog(null)} className="max-w-[480px]">
      <h2 className="m-0 text-2xl">Edit meeting</h2>
      <form className="mt-4 grid gap-3" onSubmit={saveEdit}>
        <label className="grid gap-1 text-sm font-semibold" htmlFor="session-edit-title">Title<Input id="session-edit-title" name="title" defaultValue={session.title} required maxLength={160} /></label>
        <label className="grid gap-1 text-sm font-semibold" htmlFor="session-edit-start">Starts<Input id="session-edit-start" name="starts_at" type="datetime-local" defaultValue={toLocalInput(session.starts_at)} required /></label>
        <div className="mt-3 flex flex-wrap justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => setDialog(null)} disabled={busy}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save changes"}</Button>
        </div>
      </form>
    </Dialog>

    <ConfirmDialog open={dialog === "delete"} title="Delete this meeting?" confirmLabel="Delete meeting" danger busy={busy} onConfirm={remove} onCancel={() => setDialog(null)}>
      &ldquo;{session.title}&rdquo; has not opened for check-in, so nothing else is affected.
    </ConfirmDialog>

    <Dialog open={dialog === "void"} onClose={busy ? () => {} : () => setDialog(null)} className="max-w-[500px]">
      <h2 className="m-0 text-2xl">Void this meeting?</h2>
      <p className="mt-3 text-sm leading-relaxed text-[#4c5f6b]">Use this when a meeting was recorded by mistake. It stops counting toward everyone&apos;s attendance, its open remediation items are waived and waiting absence forms are closed. The marks stay on file. This cannot be reversed.</p>
      <form className="mt-3 grid gap-3" onSubmit={voidSession}>
        <label className="grid gap-1 text-sm font-semibold" htmlFor="session-void-reason">Reason<Textarea id="session-void-reason" rows={3} maxLength={500} required minLength={3} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Created twice, wrong date…" /></label>
        <div className="mt-3 flex flex-wrap justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => setDialog(null)} disabled={busy}>Keep meeting</Button>
          <Button type="submit" variant="danger" disabled={busy || reason.trim().length < 3}>{busy ? "Working…" : "Void meeting"}</Button>
        </div>
      </form>
    </Dialog>
  </>;
}

// Returns a member to "pending" when they were marked by mistake.
export function ClearMarkButton({ sessionId, memberId, memberName, notify, onChanged }: { sessionId: number; memberId: string; memberName: string; notify: Notify; onChanged: Done }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  async function clear() {
    setBusy(true);
    const { error } = await attempt(() => clearAttendanceStatus(sessionId, memberId));
    setBusy(false);
    if (error) { notify(friendlyError(error, "The mark could not be cleared."), "error"); return; }
    setOpen(false); notify("Mark cleared"); await onChanged();
  }
  return <>
    <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(true)} aria-label={`Clear attendance mark for ${memberName}`}>Clear</Button>
    <ConfirmDialog open={open} title={`Clear the mark for ${memberName}?`} confirmLabel="Clear mark" busy={busy} onConfirm={clear} onCancel={() => setOpen(false)}>
      They go back to pending for this meeting and any open remediation from this mark is removed. The change is kept in the audit trail.
    </ConfirmDialog>
  </>;
}

export function ThresholdSettings({ warning, critical, notify, onChanged }: { warning: number; critical: number; notify: Notify; onChanged: Done }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const nextWarning = Number(form.get("warning"));
    const nextCritical = Number(form.get("critical"));
    if (!Number.isInteger(nextWarning) || !Number.isInteger(nextCritical) || nextWarning < 1 || nextCritical <= nextWarning) { notify("The review level must be higher than the warning level."); return; }
    setBusy(true);
    const { error } = await attempt(() => setAttendanceThresholds(nextWarning, nextCritical));
    setBusy(false);
    if (error) { notify(friendlyError(error, "Thresholds could not be saved."), "error"); return; }
    setOpen(false); notify("Attendance thresholds updated"); await onChanged();
  }
  return <>
    <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(true)}>Change thresholds</Button>
    <Dialog open={open} onClose={busy ? () => {} : () => setOpen(false)} className="max-w-[460px]">
      <h2 className="m-0 text-2xl">Attendance thresholds</h2>
      <p className="mt-3 text-sm leading-relaxed text-[#4c5f6b]">Unexcused units in a term before a member is flagged.</p>
      <form className="mt-3 grid gap-3" onSubmit={save}>
        <label className="grid gap-1 text-sm font-semibold" htmlFor="threshold-warning">Warning at<Input id="threshold-warning" name="warning" type="number" min={1} max={49} step={1} defaultValue={warning} required /></label>
        <label className="grid gap-1 text-sm font-semibold" htmlFor="threshold-critical">Review at<Input id="threshold-critical" name="critical" type="number" min={2} max={50} step={1} defaultValue={critical} required /></label>
        <div className="mt-3 flex flex-wrap justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save thresholds"}</Button>
        </div>
      </form>
    </Dialog>
  </>;
}

export function WithdrawExcuseButton({ excuseId, notify, onChanged }: { excuseId: number; notify: Notify; onChanged: Done }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  async function withdraw() {
    setBusy(true);
    const { error } = await attempt(() => withdrawAttendanceExcuse(excuseId));
    setBusy(false);
    if (error) { notify(friendlyError(error, "The form could not be withdrawn."), "error"); return; }
    setOpen(false); notify("Absence form withdrawn"); await onChanged();
  }
  return <>
    <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(true)}>Withdraw</Button>
    <ConfirmDialog open={open} title="Withdraw this absence form?" confirmLabel="Withdraw" busy={busy} onConfirm={withdraw} onCancel={() => setOpen(false)}>
      Executives will no longer review it. You can submit a new form for the same meeting later.
    </ConfirmDialog>
  </>;
}
