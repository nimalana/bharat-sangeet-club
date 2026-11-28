"use client";

import type { FormEvent } from "react";
import { Button } from "../../../components/ui/button";
import { localDateTime } from "../display";
import type { GroupOption, ScopeFilter } from "../model";

// Create a club-wide meeting or a subgroup rehearsal, and optionally open check-in at once.
export function NewMeetingDialog({ scopeFilter, scopeInGroups, groups, saving, onSubmit, onClose }: {
  scopeFilter: ScopeFilter;
  scopeInGroups: boolean;
  groups: GroupOption[];
  saving: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onClose: () => void;
}) {
  return <div className="modal-backdrop"><form className="modal attendance-modal" onSubmit={onSubmit}><button type="button" className="modal-close" onClick={onClose}>×</button><p className="eyebrow">NEW MEETING</p><h2>New meeting</h2><p className="modal-copy">Create a club-wide meeting or subgroup rehearsal.</p><label>Audience<select name="audience" defaultValue={typeof scopeFilter === "number" && scopeInGroups ? `subgroup:${scopeFilter}` : "club"}><option value="club">Club-wide · General Body Meeting</option>{groups.map((group) => <option key={group.id} value={`subgroup:${group.id}`}>{group.name} · Subgroup rehearsal</option>)}</select></label><label>Meeting date and time<input name="starts_at" type="datetime-local" required defaultValue={localDateTime()} /></label><label>Code duration<select name="duration" defaultValue="60"><option value="15">15 minutes</option><option value="30">30 minutes</option><option value="60">1 hour</option><option value="120">2 hours</option></select></label><label className="check-label"><input name="open_now" type="checkbox" defaultChecked /> Open check-in immediately</label><Button type="submit" disabled={saving}>{saving ? "Creating…" : "Create meeting"}</Button></form></div>;
}
