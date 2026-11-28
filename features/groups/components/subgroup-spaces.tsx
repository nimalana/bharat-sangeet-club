"use client";

import type { User } from "@supabase/supabase-js";
import { FormEvent, useState } from "react";
import { createSubgroup, postGroupAnnouncement, requestSubgroupEnrollment } from "../../../lib/api/groups";
import { settle } from "../../../lib/api/settle";
import type { ClubRole, EnrollmentMode } from "../../../lib/db";
import { friendlyError } from "../../../lib/errors";
import { canManageClub } from "../../../lib/permissions";
import type { Subgroup, SubgroupMembership } from "../../../lib/portal-types";
import type { Notify } from "../../../lib/toast";
import { PageTitle } from "../../../components/ui/page-title";
import { LoadingBlock } from "../../../components/ui/loading-block";
import { useToast } from "../../../components/ui/toast";
import { useGroupSpaces } from "../hooks/use-group-spaces";
import { CreateGroupDialog } from "./create-group-dialog";
import { DiscoverGroups } from "./discover-groups";
import { GroupDetail } from "./group-detail";
import { GroupList } from "./group-list";
import { GroupUpdateDialog } from "./group-update-dialog";

// `notify` is kept until the cleanup step removes it from every caller; the page reads the toast from useToast().
export function SubgroupSpaces({ user, role, onGroupsChanged, onOpenAttendance, onOpenRecordings, onOpenResources }: { user: User; role: ClubRole; onGroupsChanged: () => void; onOpenAttendance: (groupId: number) => void; onOpenRecordings: (groupId: number) => void; onOpenResources: (groupId: number) => void; notify?: Notify }) {
  const { notify } = useToast();
  const { groups, memberships, items, announcements, requestCounts, loading, load, setMemberships } = useGroupSpaces(user);
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showAnnouncement, setShowAnnouncement] = useState(false);
  const [joining, setJoining] = useState<number | null>(null);
  const [inlineMessage, setInlineMessage] = useState("");

  async function requestEnrollment(group: Subgroup) {
    setJoining(group.id); setInlineMessage("");
    const { data, error } = await settle(requestSubgroupEnrollment(group.id));
    setJoining(null);
    if (error) { setInlineMessage(error.message); return; }
    const membership = data as SubgroupMembership;
    setMemberships((current) => [...current.filter((item) => item.subgroup_id !== group.id), membership]);
    onGroupsChanged();
    if (membership.status === "active") { setSelectedGroupId(group.id); notify(`Welcome to ${group.name}`); }
    else setInlineMessage(`Your request to join ${group.name} was sent.`);
  }

  async function createGroup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const { data, error } = await settle(createSubgroup({
      name: String(form.get("name") || ""),
      description: String(form.get("description") || ""),
      mode: String(form.get("enrollment_mode") || "approval") as EnrollmentMode, // the form's select offers exactly the enum's values
    }));
    if (error) { notify(friendlyError(error), "error"); return; }
    const created = data as Subgroup;
    setShowCreate(false); await load(); onGroupsChanged();
    if (created?.id) setSelectedGroupId(created.id);
    notify("Group created");
  }

  async function createGroupAnnouncement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!active) return;
    const form = new FormData(event.currentTarget);
    const { error } = await settle(postGroupAnnouncement({ title: String(form.get("title") || ""), body: String(form.get("body") || ""), isPinned: form.get("is_pinned") === "on", subgroupId: active.id, createdBy: user.id }));
    if (error) { notify(friendlyError(error), "error"); return; }
    setShowAnnouncement(false); await load(); notify(`Announcement posted to ${active.name}`);
  }

  const membershipFor = (id: number) => memberships.find((item) => item.subgroup_id === id);
  const canEnter = (id: number) => canManageClub(role) || membershipFor(id)?.status === "active";
  // Archived groups stay visible to executives (so they can be restored) and are hidden from everyone else.
  const listedGroups = groups.filter((group) => !group.archived_at || canManageClub(role));
  const joinedGroups = listedGroups.filter((group) => canEnter(group.id));
  const discoverGroups = listedGroups.filter((group) => !canEnter(group.id));
  const activeMembership = (id: number) => { const membership = membershipFor(id); return membership?.status === "active" ? membership : undefined; };
  const active = listedGroups.find((group) => group.id === selectedGroupId && canEnter(group.id));
  const groupAnnouncements = announcements.filter((item) => item.subgroup_id === active?.id);

  if (loading) return <section className="section-shell page-section"><LoadingBlock>Loading the archive…</LoadingBlock></section>;

  return <section className="section-shell page-section group-page">
    <PageTitle eyebrow="GROUPS" title={active ? active.name : !canManageClub(role) ? "My groups" : "All groups"} text={active ? active.description || "Announcements, resources, recordings, and attendance for this group." : "Everything connected to your ensembles, without switching the rest of the site into another mode."} />
    {inlineMessage && <p className="action-feedback" role="status">{inlineMessage}</p>}
    {active ? <GroupDetail user={user} role={role} group={active} groups={groups} announcements={groupAnnouncements} myRole={activeMembership(active.id)?.membership_role ?? null} isMember={Boolean(activeMembership(active.id))} onBack={() => setSelectedGroupId(null)} onOpenAttendance={onOpenAttendance} onOpenRecordings={onOpenRecordings} onOpenResources={onOpenResources} onPostUpdate={() => setShowAnnouncement(true)} onAnnouncementsChanged={load} onGroupChanged={async () => { await load(); onGroupsChanged(); }} onLeft={() => setSelectedGroupId(null)} /> : <>
      <GroupList role={role} joinedGroups={joinedGroups} items={items} announcements={announcements} requestCounts={requestCounts} onOpen={setSelectedGroupId} onCreate={() => setShowCreate(true)} />
      {discoverGroups.length > 0 && <DiscoverGroups groups={discoverGroups} membershipFor={membershipFor} joining={joining} onJoin={requestEnrollment} />}
    </>}
    {showCreate && <CreateGroupDialog onClose={() => setShowCreate(false)} onSubmit={createGroup} />}
    {showAnnouncement && active && <GroupUpdateDialog groupName={active.name} onClose={() => setShowAnnouncement(false)} onSubmit={createGroupAnnouncement} />}
  </section>;
}
