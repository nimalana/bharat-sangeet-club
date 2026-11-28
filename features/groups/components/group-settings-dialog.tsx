"use client";

import type { FormEvent } from "react";
import type { EnrollmentMode } from "../../../lib/db";
import { Button } from "../../../components/ui/button";
import { Dialog } from "../../../components/ui/dialog";
import { Input } from "../../../components/ui/input";
import { Textarea } from "../../../components/ui/textarea";
import { modeLabels, type ManagedGroup } from "../model";

/** A group's settings: name, description, how people join (executives only) and Archive or Restore (for those who may). */
export function GroupSettingsDialog({ open, group, canChangeEnrollment, canArchive, saving, onClose, onSubmit, onArchive }: {
  open: boolean; group: ManagedGroup; canChangeEnrollment: boolean; canArchive: boolean; saving: boolean;
  onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void; onArchive: () => void;
}) {
  return <Dialog open={open} onClose={onClose} className="max-w-[520px]">
    <form onSubmit={onSubmit} className="grid gap-4">
      <h2 className="m-0 text-2xl">Group settings</h2>
      <label htmlFor="group-settings-name" className="grid gap-1 text-xs font-semibold">Name<Input id="group-settings-name" name="name" required maxLength={120} defaultValue={group.name} /></label>
      <label htmlFor="group-settings-description" className="grid gap-1 text-xs font-semibold">Description<Textarea id="group-settings-description" name="description" rows={4} maxLength={2000} defaultValue={group.description} /></label>
      {canChangeEnrollment ? <label htmlFor="group-settings-mode" className="grid gap-1 text-xs font-semibold">How members join<select id="group-settings-mode" name="enrollment_mode" defaultValue={group.enrollment_mode} className="h-11 border border-[var(--line)] bg-[var(--paper)] px-3 text-sm">{(Object.keys(modeLabels) as EnrollmentMode[]).map((mode) => <option key={mode} value={mode}>{modeLabels[mode]}</option>)}</select></label> : <p className="m-0 text-xs text-[#70818c]">How members join: {modeLabels[group.enrollment_mode]}. Only executives can change this.</p>}
      <div className="flex flex-wrap items-center justify-between gap-2">
        {canArchive ? <Button variant={group.archived_at ? "secondary" : "danger"} onClick={onArchive}>{group.archived_at ? "Restore group" : "Archive group"}</Button> : <span />}
        <div className="flex gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" disabled={saving}>{saving ? "Saving…" : "Save"}</Button></div>
      </div>
    </form>
  </Dialog>;
}
