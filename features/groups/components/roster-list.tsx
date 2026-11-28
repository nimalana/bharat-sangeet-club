"use client";

import type { RosterRow } from "../../../lib/api/groups";
import type { GroupRole } from "../../../lib/db";
import { Button } from "../../../components/ui/button";
import { roleLabels } from "../model";

/** The members of a group: name, email, their group role (a select for those who may change it) and Remove (for those who may). */
export function RosterList({ members, userId, busyKey, canChangeRoles, canRemoveRow, onChangeRole, onRemove }: {
  members: RosterRow[]; userId: string; busyKey: string; canChangeRoles: boolean; canRemoveRow: (row: RosterRow) => boolean;
  onChangeRole: (row: RosterRow, nextRole: GroupRole) => void; onRemove: (row: RosterRow) => void;
}) {
  return <ul className="m-0 mt-4 list-none p-0">
    {members.map((row) => <li key={row.member_id} className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line)] py-3 last:border-b-0">
      <div className="min-w-0"><b className="block truncate text-sm">{row.full_name || row.email}{row.member_id === userId ? " (you)" : ""}</b><small className="block truncate text-xs text-[#70818c]">{row.email}</small></div>
      <div className="flex flex-wrap items-center gap-2">
        {canChangeRoles ? <select aria-label={`Group role for ${row.full_name || row.email}`} className="h-9 border border-[var(--line)] bg-white px-2 text-xs" value={row.membership_role} disabled={Boolean(busyKey)} onChange={(event) => onChangeRole(row, event.target.value as GroupRole)}><option value="member">Member</option><option value="leader">Leader</option><option value="manager">Manager</option></select> : row.membership_role !== "member" && <span className="border border-[var(--line)] px-2 py-1 text-xs">{roleLabels[row.membership_role]}</span>}
        {canRemoveRow(row) && <Button size="sm" variant="danger" disabled={Boolean(busyKey)} onClick={() => onRemove(row)}>Remove</Button>}
      </div>
    </li>)}
  </ul>;
}
