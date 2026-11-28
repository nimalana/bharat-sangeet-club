"use client";

import type { User } from "@supabase/supabase-js";
import { FormEvent, useState } from "react";
import { changeMemberRole, publishAnnouncement, updateMemberProfile } from "../../../lib/api/admin";
import type { ClubRole, MemberProfile, Subgroup } from "../../../lib/db";
import { useAsyncAction } from "../../../lib/hooks/use-async-action";
import { useConfirm, type ConfirmOptions } from "../../../components/ui/confirm";
import { PageTitle } from "../../../components/ui/page-title";
import { SkeletonRows } from "../../../components/ui/skeleton";
import { useToast } from "../../../components/ui/toast";
import { useAdminData } from "../hooks/use-admin-data";
import { AdminAnnouncementsPanel } from "./admin-announcements-panel";
import { AdminAuditPanel } from "./admin-audit-panel";
import { AdminMemberEditor } from "./admin-member-editor";
import { AdminMembersPanel } from "./admin-members-panel";
import { AdminStats } from "./admin-stats";
import { SignupRequestsPanel } from "./signup-requests-panel";

const ROLE_AS: Record<ClubRole, string> = { member: "a member", executive: "an executive", admin: "an administrator" };
const ROLE_EFFECT: Record<ClubRole, string> = {
  admin: "Administrators can change anyone's permission, deactivate members and delete accounts.",
  executive: "Executives can manage groups, post announcements and approve sign-ups.",
  member: "They lose any executive or administrator access right away.",
};
/** The question asked before a permission changes: who, to what, what it lets them do, and that it can be changed back. */
const roleQuestion = (name: string, nextRole: ClubRole): ConfirmOptions => ({
  title: `Make ${name} ${ROLE_AS[nextRole]}?`,
  message: `${ROLE_EFFECT[nextRole]} You can change it again from this list.`,
  confirmLabel: `Make ${nextRole === "admin" ? "administrator" : nextRole}`,
  tone: nextRole === "member" ? "destructive" : "default",
});

/** `onPendingSignups` hears how many sign-ups wait for approval whenever the queue panel reads it (the shell shows the count in the menu). */
export function AdminPage({ user, groups, onPendingSignups }: { user: User; groups: Subgroup[]; onPendingSignups?: (waiting: number) => void }) {
  const { notify } = useToast();
  const { confirm } = useConfirm();
  const { members, memberships, announcements, audit, loading, load, status, retry, retrying } = useAdminData();
  const [editingMember, setEditingMember] = useState<MemberProfile | null>(null);
  // Each change waits for its answer and a second press sends nothing (exclusive); the editor and the form keep what was typed on a failure.
  const { pending: savingMember, run: saveMember } = useAsyncAction(notify, { exclusive: true });
  const { run: runRoleChange } = useAsyncAction(notify, { exclusive: true });
  const { pending: publishing, run: publish } = useAsyncAction(notify, { exclusive: true });
  const [changingRoleOf, setChangingRoleOf] = useState<string | null>(null);

  async function changeRole(member: MemberProfile, nextRole: ClubRole) {
    if (member.role === nextRole) return;
    const name = member.full_name || member.email;
    // The select shows the member's own permission until the database has changed it, so Cancel leaves everything as it was.
    if (!(await confirm(roleQuestion(name, nextRole)))) return;
    setChangingRoleOf(member.id);
    const outcome = await runRoleChange(() => changeMemberRole(member.id, nextRole), { success: `${name} is now ${nextRole}` });
    setChangingRoleOf(null);
    if (outcome.ok) load();
  }
  async function saveMemberProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingMember) return;
    const form = new FormData(event.currentTarget);
    const subgroupIds = form.getAll("subgroup_id").map((value) => Number(value)).filter((value) => Number.isInteger(value));
    const outcome = await saveMember(() => updateMemberProfile(editingMember.id, {
      fullName: String(form.get("full_name") || ""),
      phone: String(form.get("phone") || ""),
      classYear: String(form.get("class_year") || ""),
      specialty: String(form.get("specialty") || ""),
      subgroupIds,
    }), { success: `${editingMember.full_name || editingMember.email} was updated` });
    if (outcome.ok) { setEditingMember(null); load(); }
  }
  async function createAnnouncement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Keep a reference: event.currentTarget is cleared once the handler awaits.
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const subgroupId = String(form.get("subgroup_id") || "");
    // A failure leaves the form as it was typed; only a published announcement empties it.
    const outcome = await publish(() => publishAnnouncement({ title: String(form.get("title")), body: String(form.get("body")), isPinned: form.get("is_pinned") === "on", createdBy: user.id, subgroupId: subgroupId ? Number(subgroupId) : null }), { success: "Announcement published" });
    if (outcome.ok) { formElement.reset(); load(); }
  }

  const activeMembers = members.filter((member) => member.status !== "deactivated");
  if (loading) return <section className="section-shell page-section"><SkeletonRows rows={6} label="Loading the control center" /></section>;
  return <section className="section-shell page-section">
    <PageTitle eyebrow="ADMINISTRATION" title="Club control center" text="Manage identities, permissions, communications, and club health." />
    <AdminStats activeMembers={activeMembers} />
    <SignupRequestsPanel onCount={onPendingSignups} />
    <div className="admin-grid">
      <AdminMembersPanel user={user} members={members} groups={groups} memberships={memberships} onChangeRole={changeRole} onEdit={setEditingMember} onChanged={load} changingRoleOf={changingRoleOf} membersStatus={status.members} membershipsStatus={status.memberships} onRetry={() => void retry()} retrying={retrying} />
      <AdminAnnouncementsPanel user={user} groups={groups} announcements={announcements} onSubmit={createAnnouncement} onChanged={load} publishing={publishing} status={status.announcements} onRetry={() => void retry()} retrying={retrying} />
    </div>
    <AdminAuditPanel audit={audit} status={status.audit} onRetry={() => void retry()} retrying={retrying} />
    {editingMember && <AdminMemberEditor member={editingMember} groups={groups} memberships={memberships} saving={savingMember} onClose={() => setEditingMember(null)} onSubmit={saveMemberProfile} />}
  </section>;
}
