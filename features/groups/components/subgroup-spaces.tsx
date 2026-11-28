"use client";

import type { User } from "@supabase/supabase-js";
import { FormEvent, useEffect, useRef, useState } from "react";
import { createSubgroup, postGroupAnnouncement, requestSubgroupEnrollment } from "../../../lib/api/groups";
import { settle } from "../../../lib/api/settle";
import type { ClubRole, EnrollmentMode, Subgroup, SubgroupMembership } from "../../../lib/db";
import { useAsyncAction } from "../../../lib/hooks/use-async-action";
import { canManageClub } from "../../../lib/permissions";
import { createSingleFlight } from "../../../lib/single-flight";
import { ErrorBlock } from "../../../components/ui/error-block";
import { LoadErrorBanner } from "../../../components/ui/load-error";
import { PageTitle } from "../../../components/ui/page-title";
import { SkeletonRows } from "../../../components/ui/skeleton";
import { useToast } from "../../../components/ui/toast";
import { DEFAULT_GROUP_TAB, useGroupParam, useGroupTabParam } from "../hooks/use-group-selection";
import { useGroupSpaces } from "../hooks/use-group-spaces";
import type { GroupTabRenderer } from "../model";
import { CreateGroupDialog } from "./create-group-dialog";
import { DiscoverGroups } from "./discover-groups";
import { GroupDetail } from "./group-detail";
import { GroupList } from "./group-list";
import { GroupUpdateDialog } from "./group-update-dialog";

/**
 * My Groups: the list, Discover, and one group's page. The open group is in the address (`?group=12`, and `&tab=` for its tab: see
 * hooks/use-group-selection.ts). `renderGroupTab` is how the shell puts another area's screen into a group's Resources, Recordings,
 * Attendance or Dates tab (features may not import each other, the shell combines them); without it, or when it answers nothing for a
 * tab, the tab shows its short panel with the button that opens that page for the group, as the group page always had.
 */
export function SubgroupSpaces({ user, role, onGroupsChanged, onOpenAttendance, onOpenRecordings, onOpenResources, renderGroupTab }: { user: User; role: ClubRole; onGroupsChanged: () => void; onOpenAttendance: (groupId: number) => void; onOpenRecordings: (groupId: number) => void; onOpenResources: (groupId: number) => void; renderGroupTab?: GroupTabRenderer }) {
  const { notify } = useToast();
  const { groups, memberships, items, announcements, requestCounts, loading, failed, hasData, load, retry, setMemberships } = useGroupSpaces(user);
  const [selectedGroupId, setSelectedGroupId] = useGroupParam();
  const [, setTab] = useGroupTabParam();
  const [showCreate, setShowCreate] = useState(false);
  const [showAnnouncement, setShowAnnouncement] = useState(false);
  const [joining, setJoining] = useState<number | null>(null);
  const [inlineMessage, setInlineMessage] = useState("");
  // A second press before the first answered sends nothing; the dialogs' buttons wait the same way (exclusive runs).
  const [joinFlight] = useState(createSingleFlight);
  const create = useAsyncAction(notify, { exclusive: true });
  const post = useAsyncAction(notify, { exclusive: true });

  // When the person opens a group or goes back to the list, the old button is gone from the page: focus goes to the new page's heading
  // (not on a link that opens at a group, nor on Back/Forward), and after a join request it goes to the sentence that says how it went.
  const pageRef = useRef<HTMLElement>(null);
  const messageRef = useRef<HTMLParagraphElement>(null);
  const focusPage = useRef(false);
  const focusMessage = useRef(false);

  const openGroup = (groupId: number) => { focusPage.current = true; setSelectedGroupId(groupId); setTab(DEFAULT_GROUP_TAB); };
  /** One history entry: the group and its tab leave the address together. */
  const closeGroup = () => { focusPage.current = true; setSelectedGroupId(null); setTab(DEFAULT_GROUP_TAB); };

  async function requestEnrollment(group: Subgroup) {
    await joinFlight.run(async () => {
      setJoining(group.id); setInlineMessage("");
      const { data, error } = await settle(requestSubgroupEnrollment(group.id));
      setJoining(null);
      if (error) { focusMessage.current = true; setInlineMessage(error.message); return; }
      const membership = data as SubgroupMembership;
      setMemberships((current) => [...current.filter((item) => item.subgroup_id !== group.id), membership]);
      onGroupsChanged();
      if (membership.status === "active") { openGroup(group.id); notify(`Welcome to ${group.name}`); }
      else { focusMessage.current = true; setInlineMessage(`Your request to join ${group.name} was sent.`); }
    });
  }

  async function createGroup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    // A failure leaves the dialog open with what was typed; the toast (which stays) says why.
    const outcome = await create.run(() => createSubgroup({
      name: String(form.get("name") || ""),
      description: String(form.get("description") || ""),
      mode: String(form.get("enrollment_mode") || "approval") as EnrollmentMode, // the form's select offers exactly the enum's values
    }));
    if (!outcome.ok) return;
    const created = outcome.value;
    setShowCreate(false); await load(); onGroupsChanged();
    if (created?.id) openGroup(created.id);
    notify("Group created");
  }

  async function createGroupAnnouncement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!active) return;
    const form = new FormData(event.currentTarget);
    const outcome = await post.run(() => postGroupAnnouncement({ title: String(form.get("title") || ""), body: String(form.get("body") || ""), isPinned: form.get("is_pinned") === "on", subgroupId: active.id, createdBy: user.id }));
    if (!outcome.ok) return;
    setShowAnnouncement(false); await load(); notify(`Announcement posted to ${active.name}`);
  }

  const membershipFor = (id: number) => memberships.find((item) => item.subgroup_id === id);
  const canEnter = (id: number) => canManageClub(role) || membershipFor(id)?.status === "active";
  // Archived groups stay visible to executives (so they can be restored) and are hidden from everyone else.
  const listedGroups = groups.filter((group) => !group.archived_at || canManageClub(role));
  const joinedGroups = listedGroups.filter((group) => canEnter(group.id));
  const discoverGroups = listedGroups.filter((group) => !canEnter(group.id));
  const activeMembership = (id: number) => { const membership = membershipFor(id); return membership?.status === "active" ? membership : undefined; };
  // A group id in the address that is not one of the person's groups (mistyped, archived, not theirs) is the list.
  const active = listedGroups.find((group) => group.id === selectedGroupId && canEnter(group.id));
  const groupAnnouncements = announcements.filter((item) => item.subgroup_id === active?.id);
  const pageTitle = !canManageClub(role) ? "My groups" : "All groups";

  const shownGroupId = active?.id ?? null;
  useEffect(() => {
    if (!focusPage.current) return;
    focusPage.current = false;
    const heading = pageRef.current?.querySelector<HTMLElement>("h1");
    if (heading) { heading.tabIndex = -1; heading.focus(); }
  }, [shownGroupId]);
  useEffect(() => {
    if (!focusMessage.current || !inlineMessage) return;
    focusMessage.current = false;
    messageRef.current?.focus();
  }, [inlineMessage]);

  if (loading) return <section className="section-shell page-section"><SkeletonRows rows={4} label="Loading your groups" /></section>;
  if (failed && !hasData) return <section className="section-shell page-section group-page"><PageTitle eyebrow="GROUPS" title={pageTitle} text="Everything connected to your ensembles, without switching the rest of the site into another mode." /><ErrorBlock message="The groups could not be loaded." onRetry={() => void retry()} role="alert" /></section>;

  return <section ref={pageRef} className="section-shell page-section group-page">
    <PageTitle eyebrow="GROUPS" title={active ? active.name : pageTitle} text={active ? active.description || "Announcements, resources, recordings, and attendance for this group." : "Everything connected to your ensembles, without switching the rest of the site into another mode."} />
    {failed && <LoadErrorBanner message="Some group information could not be refreshed, so what is shown may be out of date." onRetry={() => void retry()} />}
    {inlineMessage && <p ref={messageRef} tabIndex={-1} className="action-feedback" role="status">{inlineMessage}</p>}
    {active ? <GroupDetail user={user} role={role} group={active} groups={groups} announcements={groupAnnouncements} myRole={activeMembership(active.id)?.membership_role ?? null} isMember={Boolean(activeMembership(active.id))} requestCount={requestCounts[active.id] ?? 0} renderTab={renderGroupTab} onBack={closeGroup} onOpenAttendance={onOpenAttendance} onOpenRecordings={onOpenRecordings} onOpenResources={onOpenResources} onPostUpdate={() => setShowAnnouncement(true)} onAnnouncementsChanged={load} onGroupChanged={async () => { await load(); onGroupsChanged(); }} onLeft={closeGroup} /> : <>
      <GroupList role={role} joinedGroups={joinedGroups} items={items} announcements={announcements} requestCounts={requestCounts} onOpen={openGroup} onCreate={() => setShowCreate(true)} />
      {discoverGroups.length > 0 && <DiscoverGroups groups={discoverGroups} membershipFor={membershipFor} joining={joining} onJoin={requestEnrollment} />}
    </>}
    {showCreate && <CreateGroupDialog onClose={() => setShowCreate(false)} onSubmit={createGroup} saving={create.pending} />}
    {showAnnouncement && active && <GroupUpdateDialog groupName={active.name} onClose={() => setShowAnnouncement(false)} onSubmit={createGroupAnnouncement} saving={post.pending} />}
  </section>;
}
