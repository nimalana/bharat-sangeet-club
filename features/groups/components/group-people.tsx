"use client";

import type { User } from "@supabase/supabase-js";
import { FormEvent, useState } from "react";
import { addSubgroupMember, leaveSubgroup, removeSubgroupMember, reviewSubgroupRequest, setSubgroupArchived, setSubgroupEnrollmentMode, setSubgroupMemberRole, updateSubgroup, type RosterRow } from "../../../lib/api/groups";
import { listAddableMembers, type MemberCandidate } from "../../../lib/api/members";
import { settle } from "../../../lib/api/settle";
import type { ClubRole, EnrollmentMode, GroupRole } from "../../../lib/db";
import { friendlyError } from "../../../lib/errors";
import { canRemoveGroupMember, groupCapabilities } from "../../../lib/permissions";
import { createSingleFlight } from "../../../lib/single-flight";
import { Button } from "../../../components/ui/button";
import { ErrorBlock } from "../../../components/ui/error-block";
import { LoadErrorBanner } from "../../../components/ui/load-error";
import { SkeletonRows } from "../../../components/ui/skeleton";
import { useToast } from "../../../components/ui/toast";
import { useGroupRoster } from "../hooks/use-group-roster";
import { roleLabels, type ManagedGroup, type Pending } from "../model";
import { AddMemberDialog } from "./add-member-dialog";
import { GroupConfirmDialogs } from "./group-confirm-dialogs";
import { GroupSettingsDialog } from "./group-settings-dialog";
import { JoinRequestsPanel } from "./join-requests-panel";
import { RosterList } from "./roster-list";

export type { ManagedGroup };

/**
 * A group's people: the roster, the requests to join, and the dialogs that change them. `view` says which part is drawn: "all" (the
 * whole panel, as the group page had it before it had tabs), "roster" (the Roster tab: the people and their buttons) or "requests"
 * (the Requests tab). The state, the one read of the roster and the dialogs are the same in every view, so switching between the
 * Roster and the Requests tab changes what is drawn and reads nothing again.
 */
export function GroupPeople({ user, role, group, myRole, isMember, onGroupChanged, onLeft, view = "all" }: {
  user: User; role: ClubRole; group: ManagedGroup; myRole: GroupRole | null; isMember: boolean;
  onGroupChanged: () => void | Promise<void>; onLeft: () => void; view?: "all" | "roster" | "requests";
}) {
  const { notify } = useToast();
  const can = groupCapabilities(role, myRole);
  const { roster, loading, loadError, hasRoster, loadRoster, retry } = useGroupRoster(group.id, user.id);
  const showRoster = view !== "requests";
  const showRequests = view !== "roster";
  const [busyKey, setBusyKey] = useState("");
  // `busyKey` shows which change is running; `flight` stops a second click before the next render.
  const [flight] = useState(createSingleFlight);
  const [pending, setPending] = useState<Pending>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [candidates, setCandidates] = useState<MemberCandidate[]>([]);
  const [candidateQuery, setCandidateQuery] = useState("");

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

  const readingLabel = view === "requests" ? "Loading the requests" : "Loading the roster";
  return <section className={view === "all" ? "mt-6 border border-[var(--line)] bg-[var(--paper)] p-5 sm:p-6" : "group-people"} aria-label={`People in ${group.name}`}>
    {view === "all" && group.archived_at && <p className="action-feedback" role="status">This group is archived. It is hidden from members and cannot accept new requests.</p>}
    {showRoster && <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="dashboard-section-title m-0"><h2>People</h2><span>{members.length} {members.length === 1 ? "member" : "members"}</span></div>
      <div className="flex flex-wrap gap-2">
        {can.canAddMembers && !group.archived_at && <Button size="sm" variant="secondary" onClick={openAdd}>＋ Add member</Button>}
        {can.canEditGroup && <Button size="sm" variant="secondary" onClick={() => setShowSettings(true)}>Group settings</Button>}
        {isMember && <Button size="sm" variant="ghost" onClick={() => setPending({ kind: "leave" })}>Leave group</Button>}
      </div>
    </div>}

    {loadError && (hasRoster
      ? <LoadErrorBanner message={loadError} onRetry={() => void retry()} />
      : !loading && <ErrorBlock message={loadError} onRetry={() => void retry()} role="alert" />)}

    {showRequests && can.canReviewRequests && requests.length > 0 && <JoinRequestsPanel requests={requests} busyKey={busyKey} onReview={review} onDecline={(row) => setPending({ kind: "decline", row })} />}
    {view === "requests" && !loading && !loadError && requests.length === 0 && <p className="workspace-empty mt-4">No one is waiting to join this group.</p>}

    {loading ? <SkeletonRows className="mt-4" rows={3} label={readingLabel} /> : showRoster && (members.length ? <RosterList members={members} userId={user.id} busyKey={busyKey} canChangeRoles={can.canChangeRoles} canRemoveRow={canRemoveRow} onChangeRole={changeRole} onRemove={(row) => setPending({ kind: "remove", row })} /> : !loadError && <p className="workspace-empty mt-4">No one is in this group yet.</p>)}

    <GroupConfirmDialogs group={group} myRole={myRole} pending={pending} busyKey={busyKey} onConfirm={confirmPending} onCancel={() => setPending(null)} />

    <GroupSettingsDialog open={showSettings} group={group} canChangeEnrollment={can.canChangeEnrollment} canArchive={can.canArchive} saving={busyKey === "settings"} onClose={() => setShowSettings(false)} onSubmit={saveSettings} onArchive={() => { setShowSettings(false); setPending({ kind: "archive" }); }} />

    <AddMemberDialog open={showAdd} group={group} query={candidateQuery} onQueryChange={setCandidateQuery} candidates={candidates} filteredCandidates={filteredCandidates} busyKey={busyKey} onAdd={addMember} onClose={() => setShowAdd(false)} />
  </section>;
}
