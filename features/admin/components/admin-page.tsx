"use client";

import type { User } from "@supabase/supabase-js";
import { FormEvent, useCallback, useEffect, useState } from "react";
import type { ClubRole, Tables, TablesInsert } from "../../../lib/db";
import { friendlyError } from "../../../lib/errors";
import { formatDate } from "../../../lib/format";
import type { Announcement, MemberProfile, Subgroup, SubgroupMembership } from "../../../lib/portal-types";
import { listOrKeep } from "../../../lib/refresh";
import { createRequestGate } from "../../../lib/request-gate";
import { supabase } from "../../../lib/supabase";
import type { Notify } from "../../../lib/toast";
import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import { ContentScopeLabel } from "../../../components/ui/content-scope-label";
import { LoadingBlock } from "../../../components/ui/loading-block";
import { PageTitle } from "../../../components/ui/page-title";
import { AnnouncementActions } from "../../announcements/components/announcement-actions";
import { AdminMemberEditor } from "./admin-member-editor";
import { MemberAccessActions, adminActionLabels } from "./member-access";

export function AdminPage({ user, groups, notify }: { user: User; groups: Subgroup[]; notify: Notify }) {
  const [members, setMembers] = useState<MemberProfile[]>([]);
  const [memberships, setMemberships] = useState<SubgroupMembership[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [audit, setAudit] = useState<Array<Pick<Tables<"admin_audit_log">, "id" | "action" | "actor_email" | "target_email" | "details" | "created_at">>>([]);
  const [editingMember, setEditingMember] = useState<MemberProfile | null>(null);
  const [savingMember, setSavingMember] = useState(false);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [showDeactivated, setShowDeactivated] = useState(false);
  // A reload after an edit can overlap the one before it; only the newest answer may change the lists.
  const [loadGate] = useState(createRequestGate);

  const load = useCallback(async () => {
    if (!supabase) return;
    const isCurrent = loadGate.begin();
    const [membersResult, announcementsResult, auditResult, membershipResult] = await Promise.all([
      supabase.from("profiles").select("id,full_name,email,role,status,phone,class_year,specialty,joined_at").order("full_name").limit(2000),
      supabase.from("announcements").select("*").order("is_pinned", { ascending: false }).order("published_at", { ascending: false }).limit(50),
      supabase.from("admin_audit_log").select("id,action,actor_email,target_email,details,created_at").order("created_at", { ascending: false }).limit(20),
      supabase.from("subgroup_memberships").select("subgroup_id,member_id,status,membership_role").limit(5000),
    ]);
    if (!isCurrent()) return;
    if (membersResult.error || membershipResult.error || announcementsResult.error || auditResult.error) notify("Some admin data could not be loaded", "error");
    // A list that failed keeps what is shown (an empty roster would read as "no members").
    setMembers((current) => listOrKeep(current, membersResult as { data: MemberProfile[] | null; error?: unknown }));
    setMemberships((current) => listOrKeep(current, membershipResult as { data: SubgroupMembership[] | null; error?: unknown }));
    setAnnouncements((current) => listOrKeep(current, announcementsResult as { data: Announcement[] | null; error?: unknown }));
    setAudit((current) => listOrKeep(current, auditResult));
    setLoading(false);
  }, [loadGate, notify]);
  useEffect(() => { load(); }, [load]);

  async function changeRole(member: MemberProfile, nextRole: ClubRole) {
    if (!supabase || member.role === nextRole) return;
    const { error } = await supabase.rpc("admin_change_member_role", { p_target_id: member.id, p_new_role: nextRole });
    if (error) notify(friendlyError(error), "error"); else { notify(`${member.full_name || member.email} is now ${nextRole}`); load(); }
  }
  async function saveMemberProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !editingMember) return;
    setSavingMember(true);
    const form = new FormData(event.currentTarget);
    const subgroupIds = form.getAll("subgroup_id").map((value) => Number(value)).filter((value) => Number.isInteger(value));
    const { error } = await supabase.rpc("admin_update_member_profile", {
      p_target_id: editingMember.id,
      p_full_name: String(form.get("full_name") || ""),
      p_phone: String(form.get("phone") || ""),
      p_class_year: String(form.get("class_year") || ""),
      p_specialty: String(form.get("specialty") || ""),
      p_subgroup_ids: subgroupIds,
    });
    setSavingMember(false);
    if (error) notify(friendlyError(error), "error");
    else { setEditingMember(null); notify(`${editingMember.full_name || editingMember.email} was updated`); load(); }
  }
  async function createAnnouncement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!supabase) return;
    // Keep a reference: event.currentTarget is cleared once the handler awaits.
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const subgroupId = String(form.get("subgroup_id") || "");
    const payload: TablesInsert<"announcements"> = { title: String(form.get("title")), body: String(form.get("body")), is_pinned: form.get("is_pinned") === "on", created_by: user.id };
    if (subgroupId) payload.subgroup_id = Number(subgroupId);
    const { error } = await supabase.from("announcements").insert(payload);
    if (error) notify(friendlyError(error), "error"); else { formElement.reset(); notify("Announcement published"); load(); }
  }

  const activeMembers = members.filter((member) => member.status !== "deactivated");
  const deactivatedCount = members.length - activeMembers.length;
  const filtered = (showDeactivated ? members : activeMembers).filter((member) => `${member.full_name} ${member.email} ${member.role}`.toLowerCase().includes(query.toLowerCase()));
  if (loading) return <section className="section-shell page-section"><LoadingBlock>Loading the archive…</LoadingBlock></section>;
  return <section className="section-shell page-section">
    <PageTitle eyebrow="ADMINISTRATION" title="Club control center" text="Manage identities, permissions, communications, and club health." />
    <div className="admin-stats"><div><strong>{activeMembers.length}</strong><span>Active members</span></div><div><strong>{activeMembers.filter((member) => member.role === "executive").length}</strong><span>Executives</span></div><div><strong>{activeMembers.filter((member) => member.role === "admin").length}</strong><span>Administrators</span></div><div><strong>{activeMembers.filter((member) => !member.phone || !member.specialty).length}</strong><span>Incomplete profiles</span></div></div>
    <div className="admin-grid"><section className="admin-panel admin-members"><div className="admin-panel-heading"><div><p className="eyebrow">ACCESS & IDENTITIES</p><h2>Manage members</h2><p className="panel-note">Edit profile details and assign active subgroups from one place.</p></div><label className="search"><span aria-hidden="true">⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search members" /></label></div>{deactivatedCount > 0 && <label className="check-label admin-show-deactivated"><input type="checkbox" checked={showDeactivated} onChange={(event) => setShowDeactivated(event.target.checked)} /> Show {deactivatedCount} deactivated</label>}<div className="admin-member-head"><span>Member</span><span>Subgroups</span><span>Permission</span><span>Action</span></div>{filtered.map((member) => { const memberGroups = memberships.filter((item) => item.member_id === member.id && item.status === "active"); return <div className="admin-member-row" key={member.id}><div className="min-w-0"><b className="break-words">{member.full_name || member.email}{member.status === "deactivated" && <> <Badge variant="muted">Deactivated</Badge></>}</b><small className="break-all">{member.email}</small></div><div className="member-tags admin-member-tags">{memberGroups.length ? memberGroups.map((item) => <Badge key={item.subgroup_id}>{groups.find((group) => group.id === item.subgroup_id)?.name || "Subgroup"}</Badge>) : <Badge variant="muted">No subgroup</Badge>}</div><select className="max-w-full min-w-0" value={member.role} disabled={member.id === user.id || member.status === "deactivated"} onChange={(event) => changeRole(member, event.target.value as ClubRole)} aria-label={`Permission for ${member.full_name || member.email}`}><option value="member">Member</option><option value="executive">Executive</option><option value="admin">Admin</option></select><div className="admin-member-actions">{member.status !== "deactivated" && <Button variant="secondary" size="sm" onClick={() => setEditingMember(member)}>Edit</Button>}<MemberAccessActions member={member} isSelf={member.id === user.id} onChanged={load} notify={notify} /></div></div>; })}</section>
      <aside><form className="admin-panel announcement-form" onSubmit={createAnnouncement}><p className="eyebrow">COMMUNICATIONS</p><h2>Post announcement</h2><label>Audience<select name="subgroup_id"><option value="">Whole club</option>{groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label><label>Title<input name="title" required maxLength={140} /></label><label>Message<textarea name="body" required rows={5} /></label><label className="check-label"><input name="is_pinned" type="checkbox" /> Pin to dashboard</label><button className="primary">Publish announcement</button></form><section className="admin-panel"><div className="admin-panel-heading"><h2>Announcements</h2><span>{announcements.length}</span></div>{announcements.slice(0, 5).map((item) => <article className="admin-announcement" key={item.id}><div><b>{item.is_pinned ? "◆ " : ""}{item.title}</b><small><ContentScopeLabel subgroupId={item.subgroup_id} groups={groups} />{formatDate(item.published_at)}</small></div><AnnouncementActions user={user} groups={groups} announcement={item} onChanged={load} notify={notify} /></article>)}</section></aside>
    </div>
    <section className="admin-panel audit-panel"><div className="admin-panel-heading"><div><p className="eyebrow">SECURITY</p><h2>Recent admin activity</h2></div><span>Last 20 actions</span></div>{audit.length ? audit.map((entry) => <div className="audit-row" key={entry.id}><span>{adminActionLabels[entry.action] || "Admin action"}</span><b>{entry.target_email}</b><small>by {entry.actor_email} · {formatDate(entry.created_at)}</small></div>) : <p className="workspace-empty">No administrative changes recorded yet.</p>}</section>
    {editingMember && <AdminMemberEditor member={editingMember} groups={groups} memberships={memberships} saving={savingMember} onClose={() => setEditingMember(null)} onSubmit={saveMemberProfile} />}
  </section>;
}
