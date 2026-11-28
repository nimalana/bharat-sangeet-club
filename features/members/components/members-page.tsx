"use client";

import type { User } from "@supabase/supabase-js";
import { FormEvent, useState } from "react";
import { must } from "../../../lib/api/_core";
import { initials } from "../../../lib/format";
import { useQuery } from "../../../lib/hooks/use-query";
import type { MemberProfile, ScopeFilter, Subgroup, SubgroupMembership } from "../../../lib/portal-types";
import { supabase } from "../../../lib/supabase";
import type { Notify } from "../../../lib/toast";
import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import { EmptyState } from "../../../components/ui/empty-state";
import { LoadErrorBanner } from "../../../components/ui/load-error";
import { LoadingBlock } from "../../../components/ui/loading-block";
import { PageTitle } from "../../../components/ui/page-title";

type MemberDirectory = { members: MemberProfile[]; groups: Subgroup[]; memberships: SubgroupMembership[] };

export function MembersPage({ user, notify }: { user: User; notify: Notify }) {
  // Reopening the directory shows the last data at once and refreshes behind it; a failed refresh keeps the directory already
  // shown instead of emptying it (lib/hooks/use-query.ts).
  const directory = useQuery<MemberDirectory>({
    userId: user.id,
    key: "members",
    enabled: Boolean(supabase),
    load: async () => {
      const client = supabase;
      if (!client) throw new Error("Supabase is not configured");
      const [memberResult, groupResult, membershipResult] = await Promise.all([
        client.from("profiles").select("id,full_name,email,role,phone,class_year,specialty,joined_at").eq("status", "active").order("full_name").limit(2000),
        client.from("subgroups").select("id,name,description,enrollment_mode").order("name"),
        client.from("subgroup_memberships").select("subgroup_id,member_id,status,membership_role").limit(5000),
      ]);
      return { members: (must(memberResult) || []) as MemberProfile[], groups: (must(groupResult) || []) as Subgroup[], memberships: (must(membershipResult) || []) as SubgroupMembership[] };
    },
    onError: () => notify("The member directory could not be loaded"),
  });
  const { members, groups, memberships } = directory.data || { members: [], groups: [], memberships: [] };
  const loading = directory.loading;
  const loadFailed = directory.failed;
  const loadMembers = directory.refetch;
  const [query, setQuery] = useState("");
  const [subgroupFilter, setSubgroupFilter] = useState<ScopeFilter>("all");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const ownProfile = members.find((member) => member.id === user.id);
  const filtered = members.filter((member) => {
    const matchesSearch = `${member.full_name} ${member.email} ${member.specialty || ""} ${member.class_year || ""}`.toLowerCase().includes(query.toLowerCase());
    const matchesGroup = subgroupFilter === "all" || memberships.some((item) => item.member_id === member.id && item.subgroup_id === subgroupFilter && item.status === "active");
    return matchesSearch && matchesGroup;
  });
  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!supabase) return; setSaving(true);
    const form = new FormData(event.currentTarget);
    const { error } = await supabase.from("profiles").update({ full_name: String(form.get("full_name") || ""), phone: String(form.get("phone") || ""), class_year: String(form.get("class_year") || ""), specialty: String(form.get("specialty") || "") }).eq("id", user.id);
    setSaving(false); if (error) notify(error.message, "error"); else { notify("Your contact information was updated"); setEditing(false); loadMembers(); }
  }
  if (loading) return <section className="section-shell page-section"><LoadingBlock>Loading the archive…</LoadingBlock></section>;
  return <section className="section-shell page-section"><PageTitle eyebrow="CLUB ROSTER" title="Member roster" text="Find the people who make music with Bharat Sangeet at UNC Chapel Hill, organized by the subgroups they are part of." /><div className="toolbar"><label className="search">⌕<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by name, year, or musical interest" /></label><label className="scope-picker roster-filter"><span>Group</span><select aria-label="Filter roster by subgroup" value={subgroupFilter === "all" ? "all" : String(subgroupFilter)} onChange={(event) => setSubgroupFilter(event.target.value === "all" ? "all" : Number(event.target.value))}><option value="all">Everyone</option>{groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label><Button onClick={() => setEditing(true)}>Edit my contact info</Button></div><p className="directory-note">This directory is visible only to signed-in club members. Subgroup tags show active memberships.</p>{loadFailed && <LoadErrorBanner message={members.length ? "The directory could not be refreshed, so it may be out of date." : "The member directory could not be loaded."} onRetry={() => void loadMembers()} />}{filtered.length ? <div className="member-grid">{filtered.map((member) => { const memberGroups = memberships.filter((item) => item.member_id === member.id && item.status === "active"); return <article className="member-card" key={member.id}><div className="member-initials">{initials(member.full_name || member.email)}</div><div className="member-card-heading"><h3>{member.full_name || member.email.split("@")[0]}</h3><span className={`member-role ${member.role}`}>{member.role}</span></div><p>{member.specialty || "Musical interests not added yet"}</p><div className="member-tags">{memberGroups.length ? memberGroups.map((item) => <Badge key={item.subgroup_id}>{groups.find((group) => group.id === item.subgroup_id)?.name || "Subgroup"}</Badge>) : <Badge variant="muted">No subgroup yet</Badge>}</div><dl><div><dt>Email</dt><dd><a href={`mailto:${member.email}`}>{member.email}</a></dd></div>{member.phone && <div><dt>Phone</dt><dd><a href={`tel:${member.phone}`}>{member.phone}</a></dd></div>}{member.class_year && <div><dt>Class year</dt><dd>{member.class_year}</dd></div>}</dl></article>; })}</div> : loadFailed && !members.length ? null : <EmptyState title="No members found" text={subgroupFilter === "all" ? "Try another search." : "No members are active in this subgroup."} />}{editing && <div className="modal-backdrop" onMouseDown={() => setEditing(false)}><form className="modal" onSubmit={saveProfile} onMouseDown={(event) => event.stopPropagation()}><button type="button" className="modal-close" onClick={() => setEditing(false)}>×</button><p className="eyebrow">MY MEMBER PROFILE</p><h2>Contact information</h2><label>Preferred name<input name="full_name" required defaultValue={ownProfile?.full_name || ""} /></label><label>Email<input value={ownProfile?.email || user.email || ""} disabled /></label><label>Phone number<input name="phone" type="tel" defaultValue={ownProfile?.phone || ""} placeholder="Optional" /></label><div className="form-pair"><label>Class year<input name="class_year" defaultValue={ownProfile?.class_year || ""} placeholder="2028" /></label><label>Voice / instrument<input name="specialty" defaultValue={ownProfile?.specialty || ""} placeholder="Vocal, violin, mridangam…" /></label></div><button className="primary" disabled={saving}>{saving ? "Saving…" : "Save profile"}</button></form></div>}</section>;
}
