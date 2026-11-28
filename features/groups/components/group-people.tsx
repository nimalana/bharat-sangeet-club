"use client";

import type { User } from "@supabase/supabase-js";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { addSubgroupMember, leaveSubgroup, listSubgroupRoster, removeSubgroupMember, reviewSubgroupRequest, setSubgroupArchived, setSubgroupEnrollmentMode, setSubgroupMemberRole, updateSubgroup, type RosterRow } from "../../../lib/api/groups";
import { listAddableMembers, type MemberCandidate } from "../../../lib/api/members";
import { settle } from "../../../lib/api/settle";
import type { ClubRole, EnrollmentMode, GroupRole, Tables } from "../../../lib/db";
import { friendlyError } from "../../../lib/errors";
import { canRemoveGroupMember, groupCapabilities } from "../../../lib/permissions";
import { createRequestGate } from "../../../lib/request-gate";
import { createSingleFlight } from "../../../lib/single-flight";
import type { Notify } from "../../../lib/toast";
import { Button } from "../../../components/ui/button";
import { ConfirmDialog } from "../../../components/ui/confirm-dialog";
import { Dialog } from "../../../components/ui/dialog";
import { Input } from "../../../components/ui/input";
import { Textarea } from "../../../components/ui/textarea";

export type ManagedGroup = Pick<Tables<"subgroups">, "id" | "name" | "description" | "enrollment_mode"> & Partial<Pick<Tables<"subgroups">, "archived_at">>;
type Pending =
  | { kind: "remove"; row: RosterRow }
  | { kind: "decline"; row: RosterRow }
  | { kind: "leave" }
  | { kind: "archive" }
  | null;

const roleLabels: Record<GroupRole, string> = { member: "Member", leader: "Leader", manager: "Manager" };
const modeLabels: Record<EnrollmentMode, string> = { open: "Open — anyone can join", approval: "Request approval", invite: "Invitation only" };

export function GroupPeople({ user, role, group, myRole, isMember, onGroupChanged, onLeft, notify }: {
  user: User; role: ClubRole; group: ManagedGroup; myRole: GroupRole | null; isMember: boolean;
  onGroupChanged: () => void | Promise<void>; onLeft: () => void; notify: Notify;
}) {
  const can = groupCapabilities(role, myRole);
  const [roster, setRoster] = useState<RosterRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [busyKey, setBusyKey] = useState("");
  // `busyKey` shows which change is running; `flight` stops a second click before the next render.
  const [flight] = useState(createSingleFlight);
  // Reloads follow every change and can overlap; only the newest answer may replace the roster.
  const [loadGate] = useState(createRequestGate);
  const [pending, setPending] = useState<Pending>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [candidates, setCandidates] = useState<MemberCandidate[]>([]);
  const [candidateQuery, setCandidateQuery] = useState("");

  const loadRoster = useCallback(async () => {
    const isCurrent = loadGate.begin();
    const { data, error } = await settle(listSubgroupRoster(group.id));
    if (!isCurrent()) return;
    if (error) setLoadError(friendlyError(error, "The roster could not be loaded."));
    else { setLoadError(""); setRoster(data || []); }
    setLoading(false);
  }, [group.id, loadGate]);

  // The loader synchronizes remote Supabase state into this client component.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void loadRoster(); }, [loadRoster]);

  const requests = roster.filter((row) => row.status === "pending" || row.status === "waitlisted");
  const members = roster.filter((row) => row.status === "active");

  async function run(key: string, action: () => Promise<unknown>, success: string) {
    const outcome = await flight.run(async () => {
      setBusyKey(key);
      try {
        const { error } = await settle(action());
        if (error) { notify(friendlyError(error), "error"); return false; }
        notify(success, "success");
        return true;
      } catch {
        notify("The change could not be saved. Check your connection and try again.", "error");
        return false;
      } finally { setBusyKey(""); }
    });
    return outcome.ran && outcome.value;
  }

  async function review(row: RosterRow, decision: "approve" | "waitlist" | "decline") {
    const name = row.full_name || row.email;
    const done = await run(`${decision}-${row.member_id}`, () => reviewSubgroupRequest(group.id, row.member_id, decision), decision === "approve" ? `${name} joined ${group.name}` : decision === "waitlist" ? `${name} was waitlisted` : `Request from ${name} declined`);
    // Reload either way: a failure usually means someone else already reviewed it.
    await loadRoster();
    if (done) await onGroupChanged();
  }

  async function changeRole(row: RosterRow, nextRole: GroupRole) {
    if (row.membership_role === nextRole) return;
    await run(`role-${row.member_id}`, () => setSubgroupMemberRole(group.id, row.member_id, nextRole), `${row.full_name || row.email} is now a ${roleLabels[nextRole].toLowerCase()}`);
    await loadRoster();
  }

  async function confirmPending() {
    if (!pending) return;
    if (pending.kind === "decline") {
      const row = pending.row;
      await review(row, "decline");
      setPending(null);
    } else if (pending.kind === "remove") {
      const row = pending.row;
      await run("confirm", () => removeSubgroupMember(group.id, row.member_id), `${row.full_name || row.email} was removed from ${group.name}`);
      setPending(null); await loadRoster();
    } else if (pending.kind === "leave") {
      const done = await run("confirm", () => leaveSubgroup(group.id), `You left ${group.name}`);
      setPending(null);
      if (done) { await onGroupChanged(); onLeft(); }
    } else {
      const archiving = !group.archived_at;
      const done = await run("confirm", () => setSubgroupArchived(group.id, archiving), archiving ? `${group.name} was archived` : `${group.name} was restored`);
      setPending(null);
      if (done) { await onGroupChanged(); if (archiving) onLeft(); }
    }
  }

  async function openAdd() {
    setShowAdd(true); setCandidateQuery("");
    const { data, error } = await settle(listAddableMembers());
    if (error) notify(friendlyError(error, "Members could not be loaded."), "error"); else setCandidates(data || []);
  }

  async function addMember(candidate: MemberCandidate) {
    const done = await run(`add-${candidate.id}`, () => addSubgroupMember(group.id, candidate.id), `${candidate.full_name || candidate.email} was added to ${group.name}`);
    if (done) { await loadRoster(); await onGroupChanged(); }
  }

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const nextName = String(form.get("name") || "");
    const nextDescription = String(form.get("description") || "");
    const nextMode = String(form.get("enrollment_mode") || group.enrollment_mode) as EnrollmentMode;
    const outcome = await flight.run(async () => {
      setBusyKey("settings");
      try {
        const updated = await settle(updateSubgroup(group.id, nextName, nextDescription));
        const modeResult = !updated.error && can.canChangeEnrollment && nextMode !== group.enrollment_mode
          ? await settle(setSubgroupEnrollmentMode(group.id, nextMode))
          : { error: null };
        return updated.error || modeResult.error;
      } finally { setBusyKey(""); }
    });
    if (!outcome.ran) return;
    if (outcome.value) { notify(friendlyError(outcome.value), "error"); return; }
    setShowSettings(false); notify("Group settings saved"); await onGroupChanged();
  }

  const memberIds = new Set(members.map((row) => row.member_id));
  const filteredCandidates = candidates
    .filter((candidate) => !memberIds.has(candidate.id))
    .filter((candidate) => `${candidate.full_name} ${candidate.email}`.toLowerCase().includes(candidateQuery.toLowerCase()))
    .slice(0, 30);
  const canRemoveRow = (row: RosterRow) => row.member_id !== user.id && canRemoveGroupMember(role, myRole, row.membership_role);

  return <section className="mt-6 border border-[var(--line)] bg-[var(--paper)] p-5 sm:p-6" aria-label={`People in ${group.name}`}>
    {group.archived_at && <p className="action-feedback" role="status">This group is archived. It is hidden from members and cannot accept new requests.</p>}
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="dashboard-section-title m-0"><h2>People</h2><span>{members.length} {members.length === 1 ? "member" : "members"}</span></div>
      <div className="flex flex-wrap gap-2">
        {can.canAddMembers && !group.archived_at && <Button size="sm" variant="secondary" onClick={openAdd}>＋ Add member</Button>}
        {can.canEditGroup && <Button size="sm" variant="secondary" onClick={() => setShowSettings(true)}>Group settings</Button>}
        {isMember && <Button size="sm" variant="ghost" onClick={() => setPending({ kind: "leave" })}>Leave group</Button>}
      </div>
    </div>

    {loadError && <p className="action-feedback error" role="alert">{loadError} <button type="button" className="underline" onClick={() => { setLoading(true); void loadRoster(); }}>Try again</button></p>}

    {can.canReviewRequests && requests.length > 0 && <div className="mt-5 border border-[var(--carolina)] bg-[var(--carolina-pale)] p-4">
      <h3 className="m-0 text-base">Requests to join <span className="ml-1 text-sm font-normal text-[#4c5f6b]">({requests.length})</span></h3>
      <ul className="m-0 mt-3 grid list-none gap-3 p-0">
        {requests.map((row) => <li key={row.member_id} className="flex flex-wrap items-center justify-between gap-3 border-t border-[#b9d3e3] pt-3 first:border-t-0 first:pt-0">
          <div className="min-w-0"><b className="block truncate text-sm">{row.full_name || row.email}</b><small className="block truncate text-xs text-[#4c5f6b]">{row.email}{row.status === "waitlisted" ? " · Waitlisted" : ""}</small></div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={Boolean(busyKey)} onClick={() => review(row, "approve")}>{busyKey === `approve-${row.member_id}` ? "Approving…" : "Approve"}</Button>
            {row.status === "pending" && <Button size="sm" variant="secondary" disabled={Boolean(busyKey)} onClick={() => review(row, "waitlist")}>{busyKey === `waitlist-${row.member_id}` ? "Waitlisting…" : "Waitlist"}</Button>}
            <Button size="sm" variant="danger" disabled={Boolean(busyKey)} onClick={() => setPending({ kind: "decline", row })}>{busyKey === `decline-${row.member_id}` ? "Declining…" : "Decline"}</Button>
          </div>
        </li>)}
      </ul>
    </div>}

    {loading ? <p className="workspace-empty mt-4">Loading the roster…</p> : members.length ? <ul className="m-0 mt-4 list-none p-0">
      {members.map((row) => <li key={row.member_id} className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line)] py-3 last:border-b-0">
        <div className="min-w-0"><b className="block truncate text-sm">{row.full_name || row.email}{row.member_id === user.id ? " (you)" : ""}</b><small className="block truncate text-xs text-[#70818c]">{row.email}</small></div>
        <div className="flex flex-wrap items-center gap-2">
          {can.canChangeRoles ? <select aria-label={`Group role for ${row.full_name || row.email}`} className="h-9 border border-[var(--line)] bg-white px-2 text-xs" value={row.membership_role} disabled={Boolean(busyKey)} onChange={(event) => changeRole(row, event.target.value as GroupRole)}><option value="member">Member</option><option value="leader">Leader</option><option value="manager">Manager</option></select> : row.membership_role !== "member" && <span className="border border-[var(--line)] px-2 py-1 text-xs">{roleLabels[row.membership_role]}</span>}
          {canRemoveRow(row) && <Button size="sm" variant="danger" disabled={Boolean(busyKey)} onClick={() => setPending({ kind: "remove", row })}>Remove</Button>}
        </div>
      </li>)}
    </ul> : !loadError && <p className="workspace-empty mt-4">No one is in this group yet.</p>}

    <ConfirmDialog open={pending?.kind === "decline"} title="Decline this request?" confirmLabel="Decline request" danger busy={busyKey.startsWith("decline-")} onConfirm={confirmPending} onCancel={() => setPending(null)}>
      {pending?.kind === "decline" && <p className="m-0">{pending.row.full_name || pending.row.email} will not be added to {group.name}. They can ask to join again later.</p>}
    </ConfirmDialog>
    <ConfirmDialog open={pending?.kind === "remove"} title="Remove from group?" confirmLabel="Remove member" danger busy={busyKey === "confirm"} onConfirm={confirmPending} onCancel={() => setPending(null)}>
      {pending?.kind === "remove" && <p className="m-0">{pending.row.full_name || pending.row.email} will lose access to {group.name}. Their past attendance is kept. They cannot rejoin on their own; an executive can add them back.</p>}
    </ConfirmDialog>
    <ConfirmDialog open={pending?.kind === "leave"} title={`Leave ${group.name}?`} confirmLabel="Leave group" danger busy={busyKey === "confirm"} onConfirm={confirmPending} onCancel={() => setPending(null)}>
      <p className="m-0">You will lose access to this group&apos;s resources and recordings. Your past attendance is kept.{myRole && myRole !== "member" ? ` You will also give up your ${roleLabels[myRole].toLowerCase()} role.` : ""}</p>
    </ConfirmDialog>
    <ConfirmDialog open={pending?.kind === "archive"} title={group.archived_at ? `Restore ${group.name}?` : `Archive ${group.name}?`} confirmLabel={group.archived_at ? "Restore group" : "Archive group"} danger={!group.archived_at} busy={busyKey === "confirm"} onConfirm={confirmPending} onCancel={() => setPending(null)}>
      <p className="m-0">{group.archived_at ? "The group will appear in members' lists again." : "The group is hidden from members and stops accepting requests. Nothing is deleted: its members, resources, recordings and attendance are kept, and you can restore it later."}</p>
    </ConfirmDialog>

    <Dialog open={showSettings} onClose={() => setShowSettings(false)} className="max-w-[520px]">
      <form onSubmit={saveSettings} className="grid gap-4">
        <h2 className="m-0 text-2xl">Group settings</h2>
        <label htmlFor="group-settings-name" className="grid gap-1 text-xs font-semibold">Name<Input id="group-settings-name" name="name" required maxLength={120} defaultValue={group.name} /></label>
        <label htmlFor="group-settings-description" className="grid gap-1 text-xs font-semibold">Description<Textarea id="group-settings-description" name="description" rows={4} maxLength={2000} defaultValue={group.description} /></label>
        {can.canChangeEnrollment ? <label htmlFor="group-settings-mode" className="grid gap-1 text-xs font-semibold">How members join<select id="group-settings-mode" name="enrollment_mode" defaultValue={group.enrollment_mode} className="h-11 border border-[var(--line)] bg-[var(--paper)] px-3 text-sm">{(Object.keys(modeLabels) as EnrollmentMode[]).map((mode) => <option key={mode} value={mode}>{modeLabels[mode]}</option>)}</select></label> : <p className="m-0 text-xs text-[#70818c]">How members join: {modeLabels[group.enrollment_mode]}. Only executives can change this.</p>}
        <div className="flex flex-wrap items-center justify-between gap-2">
          {can.canArchive ? <Button variant={group.archived_at ? "secondary" : "danger"} onClick={() => { setShowSettings(false); setPending({ kind: "archive" }); }}>{group.archived_at ? "Restore group" : "Archive group"}</Button> : <span />}
          <div className="flex gap-2"><Button variant="secondary" onClick={() => setShowSettings(false)}>Cancel</Button><Button type="submit" disabled={busyKey === "settings"}>{busyKey === "settings" ? "Saving…" : "Save"}</Button></div>
        </div>
      </form>
    </Dialog>

    <Dialog open={showAdd} onClose={() => setShowAdd(false)} className="max-w-[520px]">
      <h2 className="m-0 text-2xl">Add a member to {group.name}</h2>
      <label htmlFor="group-add-search" className="mt-4 grid gap-1 text-xs font-semibold">Search club members<Input id="group-add-search" value={candidateQuery} onChange={(event) => setCandidateQuery(event.target.value)} placeholder="Name or email" /></label>
      <ul className="m-0 mt-3 max-h-[320px] list-none overflow-y-auto p-0">
        {filteredCandidates.map((candidate) => <li key={candidate.id} className="flex items-center justify-between gap-3 border-b border-[var(--line)] py-2">
          <div className="min-w-0"><b className="block truncate text-sm">{candidate.full_name || candidate.email}</b><small className="block truncate text-xs text-[#70818c]">{candidate.email}</small></div>
          <Button size="sm" variant="secondary" disabled={Boolean(busyKey)} onClick={() => addMember(candidate)}>{busyKey === `add-${candidate.id}` ? "Adding…" : "Add"}</Button>
        </li>)}
        {filteredCandidates.length === 0 && <li className="py-3 text-sm text-[#70818c]">{candidates.length ? "No matching members who are not already in this group." : "Loading members…"}</li>}
      </ul>
      <div className="mt-4 flex justify-end"><Button variant="secondary" onClick={() => setShowAdd(false)}>Done</Button></div>
    </Dialog>
  </section>;
}
