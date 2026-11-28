"use client";

import type { User } from "@supabase/supabase-js";
import { FormEvent, useCallback, useEffect, useState } from "react";
import type { ClubRole, EnrollmentMode } from "../../../lib/db";
import { friendlyError } from "../../../lib/errors";
import { formatDate, initials } from "../../../lib/format";
import { canManageClub, canPostToGroup } from "../../../lib/permissions";
import type { Announcement, ArchiveItem, Subgroup, SubgroupMembership } from "../../../lib/portal-types";
import { listOrKeep } from "../../../lib/refresh";
import { createRequestGate } from "../../../lib/request-gate";
import { supabase } from "../../../lib/supabase";
import type { Notify } from "../../../lib/toast";
import { Button } from "../../../components/ui/button";
import { EmptyState } from "../../../components/ui/empty-state";
import { LoadingBlock } from "../../../components/ui/loading-block";
import { PageTitle } from "../../../components/ui/page-title";
import { AnnouncementActions } from "../../announcements/components/announcement-actions";
import { GroupPeople } from "./group-people";

export function SubgroupSpaces({ user, role, onGroupsChanged, onOpenAttendance, onOpenRecordings, onOpenResources, notify }: { user: User; role: ClubRole; onGroupsChanged: () => void; onOpenAttendance: (groupId: number) => void; onOpenRecordings: (groupId: number) => void; onOpenResources: (groupId: number) => void; notify: Notify }) {
  const [groups, setGroups] = useState<Subgroup[]>([]);
  const [memberships, setMemberships] = useState<SubgroupMembership[]>([]);
  const [items, setItems] = useState<ArchiveItem[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showAnnouncement, setShowAnnouncement] = useState(false);
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState<number | null>(null);
  const [inlineMessage, setInlineMessage] = useState("");
  const [requestCounts, setRequestCounts] = useState<Record<number, number>>({});
  // Several actions reload this screen; a slower, older answer must not replace a newer one.
  const [loadGate] = useState(createRequestGate);

  const load = useCallback(async () => {
    if (!supabase) return;
    const isCurrent = loadGate.begin();
    const [groupResult, membershipResult, archiveResult, announcementResult, requestResult] = await Promise.all([
      supabase.from("subgroups").select("id,name,description,enrollment_mode,archived_at").order("name"),
      supabase.from("subgroup_memberships").select("subgroup_id,member_id,status,membership_role").eq("member_id", user.id),
      supabase.from("archive_items").select("*").eq("type", "recording").not("subgroup_id", "is", null).order("created_at", { ascending: false }).limit(500),
      supabase.from("announcements").select("*").not("subgroup_id", "is", null).order("published_at", { ascending: false }).limit(300),
      // Row-level security returns other people's waiting requests only to executives and to that group's leaders and managers.
      supabase.from("subgroup_memberships").select("subgroup_id").in("status", ["pending", "waitlisted"]).neq("member_id", user.id),
    ]);
    if (!isCurrent()) return;
    if (groupResult.error || membershipResult.error || archiveResult.error || announcementResult.error) notify("Some group information could not be loaded", "error");
    // A list that failed keeps what is shown instead of becoming empty.
    if (!requestResult.error) {
      const counts: Record<number, number> = {};
      for (const row of (requestResult.data || []) as Array<{ subgroup_id: number }>) counts[row.subgroup_id] = (counts[row.subgroup_id] || 0) + 1;
      setRequestCounts(counts);
    }
    setGroups((current) => listOrKeep(current, groupResult as { data: Subgroup[] | null; error?: unknown }));
    setMemberships((current) => listOrKeep(current, membershipResult as { data: SubgroupMembership[] | null; error?: unknown }));
    setItems((current) => listOrKeep(current, archiveResult as { data: ArchiveItem[] | null; error?: unknown }));
    setAnnouncements((current) => listOrKeep(current, announcementResult as { data: Announcement[] | null; error?: unknown }));
    setLoading(false);
  }, [loadGate, notify, user.id]);

  useEffect(() => { load(); }, [load]);

  async function open(item: ArchiveItem) {
    if (!supabase) return;
    const { data, error } = await supabase.storage.from("club-archive").createSignedUrl(item.storage_path, 300);
    if (error || !data) notify("This file could not be opened"); else window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  }

  async function requestEnrollment(group: Subgroup) {
    if (!supabase) return;
    setJoining(group.id); setInlineMessage("");
    const { data, error } = await supabase.rpc("request_subgroup_enrollment", { target_subgroup_id: group.id });
    setJoining(null);
    if (error) { setInlineMessage(error.message); return; }
    const membership = data as SubgroupMembership;
    setMemberships((current) => [...current.filter((item) => item.subgroup_id !== group.id), membership]);
    onGroupsChanged();
    if (membership.status === "active") { setSelectedGroupId(group.id); notify(`Welcome to ${group.name}`); }
    else setInlineMessage(`Your request to join ${group.name} was sent.`);
  }

  async function createGroup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!supabase) return;
    const form = new FormData(event.currentTarget);
    const { data, error } = await supabase.rpc("create_subgroup", {
      subgroup_name: String(form.get("name") || ""),
      subgroup_description: String(form.get("description") || ""),
      subgroup_mode: String(form.get("enrollment_mode") || "approval") as EnrollmentMode, // the form's select offers exactly the enum's values
    });
    if (error) { notify(friendlyError(error), "error"); return; }
    const created = data as Subgroup;
    setShowCreate(false); await load(); onGroupsChanged();
    if (created?.id) setSelectedGroupId(created.id);
    notify("Group created");
  }

  async function createGroupAnnouncement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!supabase || !active) return;
    const form = new FormData(event.currentTarget);
    const { error } = await supabase.from("announcements").insert({ title: String(form.get("title") || ""), body: String(form.get("body") || ""), is_pinned: form.get("is_pinned") === "on", subgroup_id: active.id, created_by: user.id });
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
  const groupItems = items.filter((item) => item.subgroup_id === active?.id);
  const recordings = groupItems.filter((item) => item.type === "recording");
  const groupAnnouncements = announcements.filter((item) => item.subgroup_id === active?.id);

  if (loading) return <section className="section-shell page-section"><LoadingBlock>Loading the archive…</LoadingBlock></section>;

  return <section className="section-shell page-section group-page">
    <PageTitle eyebrow="GROUPS" title={active ? active.name : !canManageClub(role) ? "My groups" : "All groups"} text={active ? active.description || "Announcements, resources, recordings, and attendance for this group." : "Everything connected to your ensembles, without switching the rest of the site into another mode."} />
    {inlineMessage && <p className="action-feedback" role="status">{inlineMessage}</p>}
    {active ? <>
      <div className="group-detail-actions"><Button variant="secondary" onClick={() => setSelectedGroupId(null)}>← All groups</Button><Button variant="secondary" onClick={() => onOpenResources(active.id)}>Open resources</Button><Button variant="secondary" onClick={() => onOpenRecordings(active.id)}>Open recordings</Button><Button variant="secondary" onClick={() => onOpenAttendance(active.id)}>View attendance</Button>{canPostToGroup(role) && <><Button variant="secondary" onClick={() => setShowAnnouncement(true)}>Post update</Button><Button onClick={() => onOpenRecordings(active.id)}>Add recording</Button></>}</div>
      <div className="group-detail-grid">
        <section className="group-feed"><div className="dashboard-section-title"><h2>Announcements</h2><span>{groupAnnouncements.length}</span></div>{groupAnnouncements.length ? groupAnnouncements.map((item) => <article key={item.id}><b>{item.title}</b><p>{item.body}</p><small>{item.is_pinned ? "Pinned · " : ""}{formatDate(item.published_at)}</small>{canManageClub(role) && <AnnouncementActions user={user} groups={groups} announcement={item} onChanged={load} notify={notify} />}</article>) : <p className="workspace-empty">No announcements for this group yet.</p>}</section>
        <section><div className="dashboard-section-title"><h2>Resources</h2><span>Library</span></div><p className="workspace-empty">Documents, links, and photos live in the shared resource library.</p><Button variant="secondary" onClick={() => onOpenResources(active.id)}>Open resources</Button></section>
        <section><div className="dashboard-section-title"><h2>Recordings</h2><span>Room</span></div><p className="workspace-empty">Capture rehearsals, lessons, and takes in the subgroup recording room.</p><Button variant="secondary" onClick={() => onOpenRecordings(active.id)}>Open recording room →</Button></section>
      </div>
      <GroupPeople key={active.id} user={user} role={role} group={active} myRole={activeMembership(active.id)?.membership_role ?? null} isMember={Boolean(activeMembership(active.id))} onGroupChanged={async () => { await load(); onGroupsChanged(); }} onLeft={() => setSelectedGroupId(null)} notify={notify} />
    </> : <>
      <div className="group-list-heading"><div><h2>{!canManageClub(role) ? "Your groups" : "Groups you manage"}</h2><p>Open a group to see its latest activity.</p></div><div><span>{joinedGroups.length}</span>{canManageClub(role) && <Button onClick={() => setShowCreate(true)}>＋ New group</Button>}</div></div>
      {joinedGroups.length ? <div className="group-list">{joinedGroups.map((group) => { const resourceCount = items.filter((item) => item.subgroup_id === group.id).length; const updateCount = announcements.filter((item) => item.subgroup_id === group.id).length; return <button type="button" key={group.id} onClick={() => setSelectedGroupId(group.id)}><span className="workspace-seal subgroup">{initials(group.name)}</span><span><b>{group.name}{group.archived_at ? " (archived)" : ""}</b><small>{requestCounts[group.id] ? `${requestCounts[group.id]} ${requestCounts[group.id] === 1 ? "request" : "requests"} to review` : group.description || "Bharat Sangeet group"}</small></span><span><b>{updateCount}</b><small>updates</small></span><span><b>{resourceCount}</b><small>resources</small></span><i>Open →</i></button>; })}</div> : <EmptyState title="No groups yet" text={!canManageClub(role) ? "Join an open group or ask an executive for an invitation." : "Create the first group to organize rehearsals and resources."} />}
      {discoverGroups.length > 0 && <><div className="group-list-heading discover"><div><h2>Discover groups</h2><p>Find another ensemble to join.</p></div><span>{discoverGroups.length}</span></div><div className="discover-grid">{discoverGroups.map((group) => { const membership = membershipFor(group.id); return <article className="discover-card" key={group.id}><span className="workspace-seal subgroup">{initials(group.name)}</span><h2>{group.name}</h2><p>{group.description || "A Bharat Sangeet group at UNC Chapel Hill."}</p>{membership?.status === "pending" ? <span className="enrollment-status">Request pending</span> : membership?.status === "waitlisted" ? <span className="enrollment-status">Waitlisted</span> : membership?.status === "removed" ? <span className="enrollment-status muted">Ask an executive to add you back</span> : group.enrollment_mode === "invite" ? <span className="enrollment-status muted">Invitation required</span> : <Button variant="secondary" disabled={joining === group.id} onClick={() => requestEnrollment(group)}>{joining === group.id ? "Sending…" : group.enrollment_mode === "open" ? "Join group" : "Request to join"}</Button>}</article>; })}</div></>}
    </>}
    {showCreate && <div className="modal-backdrop" onMouseDown={() => setShowCreate(false)}><form className="modal" onSubmit={createGroup} onMouseDown={(event) => event.stopPropagation()}><button type="button" className="modal-close" onClick={() => setShowCreate(false)}>×</button><p className="eyebrow">NEW GROUP</p><h2>Create a group</h2><label>Name<input name="name" required maxLength={80} placeholder="Hindustani Ensemble" /></label><label>Description<textarea name="description" rows={4} placeholder="What this group rehearses or performs" /></label><label>Enrollment<select name="enrollment_mode" defaultValue="approval"><option value="open">Open — anyone can join</option><option value="approval">Request approval</option><option value="invite">Invitation only</option></select></label><Button type="submit">Create group</Button></form></div>}
    {showAnnouncement && active && <div className="modal-backdrop" onMouseDown={() => setShowAnnouncement(false)}><form className="modal" onSubmit={createGroupAnnouncement} onMouseDown={(event) => event.stopPropagation()}><button type="button" className="modal-close" onClick={() => setShowAnnouncement(false)}>×</button><p className="eyebrow">{active.name.toUpperCase()}</p><h2>Post a group update</h2><label>Title<input name="title" required maxLength={140} /></label><label>Message<textarea name="body" required rows={5} /></label><label className="check-label"><input name="is_pinned" type="checkbox" /> Pin this update</label><Button type="submit">Publish to {active.name}</Button></form></div>}
  </section>;
}
