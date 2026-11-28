"use client";

import { useRef, type FormEvent } from "react";
import { Button } from "../../../components/ui/button";
import { Dialog } from "../../../components/ui/dialog";
import { IconButton } from "../../../components/ui/icon-button";
import { localDateTime } from "../display";
import type { GroupOption, ScopeFilter } from "../../../lib/db";

// Create a club-wide meeting or a subgroup rehearsal, and optionally open check-in at once. A dialog like the absence form:
// named by its heading, focus on the first field, Escape and the × close it unless the meeting is being created.
export function NewMeetingDialog({ scopeFilter, scopeInGroups, groups, saving, onSubmit, onClose }: {
  scopeFilter: ScopeFilter;
  scopeInGroups: boolean;
  groups: GroupOption[];
  saving: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onClose: () => void;
}) {
  const firstField = useRef<HTMLSelectElement>(null);
  return <Dialog open onClose={onClose} dismissible={!saving} closeOnBackdrop={false} labelledBy="new-meeting-title" describedBy="new-meeting-copy" initialFocus={firstField} className="modal attendance-modal">
    <IconButton className="modal-close" aria-label="Close the new meeting form" onClick={onClose} disabled={saving}>×</IconButton>
    <form onSubmit={onSubmit}>
      <p className="eyebrow">NEW MEETING</p>
      <h2 id="new-meeting-title">New meeting</h2>
      <p id="new-meeting-copy" className="modal-copy">Create a club-wide meeting or subgroup rehearsal.</p>
      <label>Audience<select ref={firstField} name="audience" defaultValue={typeof scopeFilter === "number" && scopeInGroups ? `subgroup:${scopeFilter}` : "club"}><option value="club">Club-wide · General Body Meeting</option>{groups.map((group) => <option key={group.id} value={`subgroup:${group.id}`}>{group.name} · Subgroup rehearsal</option>)}</select></label>
      <label>Meeting date and time<input name="starts_at" type="datetime-local" required defaultValue={localDateTime()} /></label>
      <label>Code duration<select name="duration" defaultValue="60"><option value="15">15 minutes</option><option value="30">30 minutes</option><option value="60">1 hour</option><option value="120">2 hours</option></select></label>
      <label className="check-label"><input name="open_now" type="checkbox" defaultChecked /> Open check-in immediately</label>
      <Button type="submit" pending={saving}>{saving ? "Creating…" : "Create meeting"}</Button>
    </form>
  </Dialog>;
}
