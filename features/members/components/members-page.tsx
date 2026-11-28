"use client";

import type { User } from "@supabase/supabase-js";
import { FormEvent, useState } from "react";
import { updateOwnContact } from "../../../lib/api/members";
import { settle } from "../../../lib/api/settle";
import type { ScopeFilter } from "../../../lib/portal-types";
import type { Notify } from "../../../lib/toast";
import { Button } from "../../../components/ui/button";
import { EmptyState } from "../../../components/ui/empty-state";
import { LoadErrorBanner } from "../../../components/ui/load-error";
import { LoadingBlock } from "../../../components/ui/loading-block";
import { PageTitle } from "../../../components/ui/page-title";
import { useToast } from "../../../components/ui/toast";
import { useMemberDirectory } from "../hooks/use-member-directory";
import { ContactDialog } from "./contact-dialog";
import { MemberCard } from "./member-card";

// `notify` is kept until the cleanup step removes it from every caller; the page reads the toast from useToast().
export function MembersPage({ user }: { user: User; notify?: Notify }) {
  const { notify } = useToast();
  const { members, groups, memberships, loading, failed: loadFailed, reload: loadMembers } = useMemberDirectory(user);
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
    event.preventDefault(); setSaving(true);
    const form = new FormData(event.currentTarget);
    const { error } = await settle(updateOwnContact(user.id, { fullName: String(form.get("full_name") || ""), phone: String(form.get("phone") || ""), classYear: String(form.get("class_year") || ""), specialty: String(form.get("specialty") || "") }));
    setSaving(false); if (error) notify(error.message, "error"); else { notify("Your contact information was updated"); setEditing(false); loadMembers(); }
  }
  if (loading) return <section className="section-shell page-section"><LoadingBlock>Loading the archive…</LoadingBlock></section>;
  return <section className="section-shell page-section"><PageTitle eyebrow="CLUB ROSTER" title="Member roster" text="Find the people who make music with Bharat Sangeet at UNC Chapel Hill, organized by the subgroups they are part of." /><div className="toolbar"><label className="search">⌕<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by name, year, or musical interest" /></label><label className="scope-picker roster-filter"><span>Group</span><select aria-label="Filter roster by subgroup" value={subgroupFilter === "all" ? "all" : String(subgroupFilter)} onChange={(event) => setSubgroupFilter(event.target.value === "all" ? "all" : Number(event.target.value))}><option value="all">Everyone</option>{groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label><Button onClick={() => setEditing(true)}>Edit my contact info</Button></div><p className="directory-note">This directory is visible only to signed-in club members. Subgroup tags show active memberships.</p>{loadFailed && <LoadErrorBanner message={members.length ? "The directory could not be refreshed, so it may be out of date." : "The member directory could not be loaded."} onRetry={() => void loadMembers()} />}{filtered.length ? <div className="member-grid">{filtered.map((member) => <MemberCard key={member.id} member={member} groups={groups} memberships={memberships} />)}</div> : loadFailed && !members.length ? null : <EmptyState title="No members found" text={subgroupFilter === "all" ? "Try another search." : "No members are active in this subgroup."} />}{editing && <ContactDialog ownProfile={ownProfile} email={user.email || ""} saving={saving} onClose={() => setEditing(false)} onSubmit={saveProfile} />}</section>;
}
