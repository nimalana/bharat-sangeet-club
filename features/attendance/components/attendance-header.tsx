"use client";

import { Button } from "../../../components/ui/button";
import type { GroupOption, ScopeFilter } from "../../../lib/db";
import { termLabel } from "../model";

// The title and the two pickers: which audience (all activity, club-wide, one subgroup's rehearsals) and which term; an
// executive also gets the button that creates a meeting.
export function AttendanceHeader({ scopeFilter, termFilter, groups, scopeLabel, scopeInGroups, termOptions, canManage, onScope, onTerm, onNewMeeting }: {
  scopeFilter: ScopeFilter;
  termFilter: string;
  groups: GroupOption[];
  scopeLabel: string;
  /** False when the audience in view is a subgroup the person's own group list does not carry. */
  scopeInGroups: boolean;
  termOptions: string[];
  canManage: boolean;
  onScope: (value: ScopeFilter) => void;
  onTerm: (value: string) => void;
  onNewMeeting: () => void;
}) {
  return <div className="attendance-title-row">
    <div><p className="eyebrow">MEETINGS</p><h1>Attendance</h1><p>Check in to club-wide and subgroup meetings, review attendance, and handle absence forms.</p></div>
    <div className="attendance-title-actions">
      <label className="scope-picker"><span>View</span><select aria-label="Filter attendance by audience" value={typeof scopeFilter === "number" ? `group:${scopeFilter}` : scopeFilter} onChange={(event) => { const next = event.target.value; onScope(next.startsWith("group:") ? Number(next.slice(6)) : next as "all" | "club"); }}><option value="all">All activity</option><option value="club">Club-wide meetings</option>{groups.map((group) => <option key={group.id} value={`group:${group.id}`}>{group.name} rehearsals</option>)}{!scopeInGroups && <option value={`group:${scopeFilter}`}>{scopeLabel} rehearsals</option>}</select></label>
      <label className="scope-picker"><span>Term</span><select aria-label="Filter attendance by term" value={termFilter} onChange={(event) => onTerm(event.target.value)}><option value="all">All terms</option>{termOptions.map((term) => <option key={term} value={term}>{termLabel(term)}</option>)}</select></label>
      {canManage && <Button onClick={onNewMeeting}>＋ New meeting</Button>}
    </div>
  </div>;
}
