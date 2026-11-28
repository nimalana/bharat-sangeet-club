"use client";

import type { User } from "@supabase/supabase-js";
import { FormEvent, useState } from "react";
import type { ScopeFilter } from "../../../lib/db";
import { Button } from "../../../components/ui/button";
import { EmptyState } from "../../../components/ui/empty-state";
import { LoadErrorBanner } from "../../../components/ui/load-error";
import { LoadingBlock } from "../../../components/ui/loading-block";
import { PageTitle } from "../../../components/ui/page-title";
import { useMemberDirectory } from "../hooks/use-member-directory";
import { useProfileSave } from "../hooks/use-profile-save";
import { ContactDialog } from "./contact-dialog";
import { MemberCard } from "./member-card";

export function MembersPage({ user }: { user: User }) {
  const { members, groups, memberships, loading, failed: loadFailed, reload: loadMembers } = useMemberDirectory(user);
  const [query, setQuery] = useState("");
  const [subgroupFilter, setSubgroupFilter] = useState<ScopeFilter>("all");
  const [editing, setEditing] = useState(false);
  const { saving, save } = useProfileSave(user);
  const ownProfile = members.find((member) => member.id === user.id);
  const filtered = members.filter((member) => {
    const matchesSearch = `${member.full_name} ${member.email} ${member.specialty || ""} ${member.class_year || ""}`.toLowerCase().includes(query.toLowerCase());
    const matchesGroup = subgroupFilter === "all" || memberships.some((item) => item.member_id === member.id && item.subgroup_id === subgroupFilter && item.status === "active");
    return matchesSearch && matchesGroup;
  });
  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const outcome = await save(form);
    if (outcome.ok) { setEditing(false); loadMembers(); }
  }
  if (loading) return <section className="section-shell page-section"><LoadingBlock>Loading the archive…</LoadingBlock></section>;
  return <section className="section-shell page-section"><PageTitle eyebrow="CLUB ROSTER" title="Member roster" text="Find the people who make music with Bharat Sangeet at UNC Chapel Hill, organized by the subgroups they are part of." /><div className="toolbar"><label className="search">⌕<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by name, year, or musical interest" /></label><label className="scope-picker roster-filter"><span>Group</span><select aria-label="Filter roster by subgroup" value={subgroupFilter === "all" ? "all" : String(subgroupFilter)} onChange={(event) => setSubgroupFilter(event.target.value === "all" ? "all" : Number(event.target.value))}><option value="all">Everyone</option>{groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label><Button onClick={() => setEditing(true)}>Edit my contact info</Button></div><p className="directory-note">This directory is visible only to signed-in club members. Subgroup tags show active memberships.</p>{loadFailed && <LoadErrorBanner message={members.length ? "The directory could not be refreshed, so it may be out of date." : "The member directory could not be loaded."} onRetry={() => void loadMembers()} />}{filtered.length ? <div className="member-grid">{filtered.map((member) => <MemberCard key={member.id} member={member} groups={groups} memberships={memberships} />)}</div> : loadFailed && !members.length ? null : <EmptyState title="No members found" text={subgroupFilter === "all" ? "Try another search." : "No members are active in this subgroup."} />}{editing && <ContactDialog ownProfile={ownProfile} email={user.email || ""} saving={saving} onClose={() => setEditing(false)} onSubmit={saveProfile} />}</section>;
}
