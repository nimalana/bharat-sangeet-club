"use client";

import type { User } from "@supabase/supabase-js";
import { FormEvent, useState } from "react";
import { changeMemberRole, publishAnnouncement, updateMemberProfile } from "../../../lib/api/admin";
import { settle } from "../../../lib/api/settle";
import type { ClubRole, MemberProfile, Subgroup } from "../../../lib/db";
import { friendlyError } from "../../../lib/errors";
import { useAsyncAction } from "../../../lib/hooks/use-async-action";
import { LoadingBlock } from "../../../components/ui/loading-block";
import { PageTitle } from "../../../components/ui/page-title";
import { useToast } from "../../../components/ui/toast";
import { useAdminData } from "../hooks/use-admin-data";
import { AdminAnnouncementsPanel } from "./admin-announcements-panel";
import { AdminAuditPanel } from "./admin-audit-panel";
import { AdminMemberEditor } from "./admin-member-editor";
import { AdminMembersPanel } from "./admin-members-panel";
import { AdminStats } from "./admin-stats";
import { SignupRequestsPanel } from "./signup-requests-panel";

/** `onPendingSignups` hears how many sign-ups wait for approval whenever the queue panel reads it (the shell shows the count in the menu). */
export function AdminPage({ user, groups, onPendingSignups }: { user: User; groups: Subgroup[]; onPendingSignups?: (waiting: number) => void }) {
  const { notify } = useToast();
  const { members, memberships, announcements, audit, loading, load } = useAdminData();
  const [editingMember, setEditingMember] = useState<MemberProfile | null>(null);
  const { pending: savingMember, run: saveMember } = useAsyncAction(notify);

  async function changeRole(member: MemberProfile, nextRole: ClubRole) {
    if (member.role === nextRole) return;
    const { error } = await settle(changeMemberRole(member.id, nextRole));
    if (error) notify(friendlyError(error), "error"); else { notify(`${member.full_name || member.email} is now ${nextRole}`); load(); }
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
    const { error } = await settle(publishAnnouncement({ title: String(form.get("title")), body: String(form.get("body")), isPinned: form.get("is_pinned") === "on", createdBy: user.id, subgroupId: subgroupId ? Number(subgroupId) : null }));
    if (error) notify(friendlyError(error), "error"); else { formElement.reset(); notify("Announcement published"); load(); }
  }

  const activeMembers = members.filter((member) => member.status !== "deactivated");
  if (loading) return <section className="section-shell page-section"><LoadingBlock>Loading the archive…</LoadingBlock></section>;
  return <section className="section-shell page-section">
    <PageTitle eyebrow="ADMINISTRATION" title="Club control center" text="Manage identities, permissions, communications, and club health." />
    <AdminStats activeMembers={activeMembers} />
    <SignupRequestsPanel onCount={onPendingSignups} />
    <div className="admin-grid">
      <AdminMembersPanel user={user} members={members} groups={groups} memberships={memberships} onChangeRole={changeRole} onEdit={setEditingMember} onChanged={load} />
      <AdminAnnouncementsPanel user={user} groups={groups} announcements={announcements} onSubmit={createAnnouncement} onChanged={load} />
    </div>
    <AdminAuditPanel audit={audit} />
    {editingMember && <AdminMemberEditor member={editingMember} groups={groups} memberships={memberships} saving={savingMember} onClose={() => setEditingMember(null)} onSubmit={saveMemberProfile} />}
  </section>;
}
