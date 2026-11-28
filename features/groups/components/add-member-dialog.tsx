"use client";

import type { MemberCandidate } from "../../../lib/api/members";
import { Button } from "../../../components/ui/button";
import { Dialog } from "../../../components/ui/dialog";
import { Input } from "../../../components/ui/input";
import type { ManagedGroup } from "../model";

/** The picker that adds a club member to the group at once: a search box and the matching members who are not in the group. */
export function AddMemberDialog({ open, group, query, onQueryChange, candidates, filteredCandidates, busyKey, onAdd, onClose }: {
  open: boolean; group: ManagedGroup; query: string; onQueryChange: (query: string) => void; candidates: MemberCandidate[]; filteredCandidates: MemberCandidate[];
  busyKey: string; onAdd: (candidate: MemberCandidate) => void; onClose: () => void;
}) {
  return <Dialog open={open} onClose={onClose} className="max-w-[520px]">
    <h2 className="m-0 text-2xl">Add a member to {group.name}</h2>
    <label htmlFor="group-add-search" className="mt-4 grid gap-1 text-xs font-semibold">Search club members<Input id="group-add-search" value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="Name or email" /></label>
    <ul className="m-0 mt-3 max-h-[320px] list-none overflow-y-auto p-0">
      {filteredCandidates.map((candidate) => <li key={candidate.id} className="flex items-center justify-between gap-3 border-b border-[var(--line)] py-2">
        <div className="min-w-0"><b className="block truncate text-sm">{candidate.full_name || candidate.email}</b><small className="block truncate text-xs text-[#70818c]">{candidate.email}</small></div>
        <Button size="sm" variant="secondary" disabled={Boolean(busyKey)} onClick={() => onAdd(candidate)}>{busyKey === `add-${candidate.id}` ? "Adding…" : "Add"}</Button>
      </li>)}
      {filteredCandidates.length === 0 && <li className="py-3 text-sm text-[#70818c]">{candidates.length ? "No matching members who are not already in this group." : "Loading members…"}</li>}
    </ul>
    <div className="mt-4 flex justify-end"><Button variant="secondary" onClick={onClose}>Done</Button></div>
  </Dialog>;
}
