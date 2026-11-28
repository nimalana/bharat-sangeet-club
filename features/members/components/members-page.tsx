"use client";

import type { User } from "@supabase/supabase-js";
import { useState, type FormEvent } from "react";
import { Button } from "../../../components/ui/button";
import { EmptyState } from "../../../components/ui/empty-state";
import { ErrorBlock } from "../../../components/ui/error-block";
import { LoadErrorBanner } from "../../../components/ui/load-error";
import { PageTitle } from "../../../components/ui/page-title";
import { Skeleton } from "../../../components/ui/skeleton";
import { positiveInteger, useUrlState } from "../../../lib/hooks/use-url-state";
import { useMemberDirectory } from "../hooks/use-member-directory";
import { useProfileSave } from "../hooks/use-profile-save";
import { ContactDialog } from "./contact-dialog";
import { MemberCard } from "./member-card";

// The roster's search and group filter are in the address, so that a link or a reload opens the same view: ?q=veena and ?group=7.
// A search is typed letter by letter, so it rewrites the current entry ("replace": Back leaves the page, it does not undo a letter); a group is
// a choice, so it is a history entry of its own ("push"). Neither is there when it has its usual value (empty, everyone).
const QUERY = { defaultValue: "", history: "replace" } as const;
const GROUP = { parse: positiveInteger, defaultValue: null, history: "push" } as const;

export function MembersPage({ user }: { user: User }) {
  const { members, groups, memberships, loading, failed: loadFailed, reload: loadMembers } = useMemberDirectory(user);
  const [urlQuery, setUrlQuery] = useUrlState<string>("q", QUERY);
  const [groupParam, setGroupParam] = useUrlState<number | null>("group", GROUP);
  // What is typed is shown at once; the address follows it a moment later. A new address (Back, Forward, a link) shows in the field.
  const [query, setQuery] = useState(urlQuery);
  const [seenQuery, setSeenQuery] = useState(urlQuery);
  if (urlQuery !== seenQuery) { setSeenQuery(urlQuery); setQuery(urlQuery); }
  // A group that is not (or not yet) in the list is Everyone, and the address is left as it is.
  const groupId = groupParam !== null && groups.some((group) => group.id === groupParam) ? groupParam : null;
  const [editing, setEditing] = useState(false);
  const { saving, save } = useProfileSave(user);
  const ownProfile = members.find((member) => member.id === user.id);
  const filtered = members.filter((member) => {
    const matchesSearch = `${member.full_name} ${member.email} ${member.specialty || ""} ${member.class_year || ""}`.toLowerCase().includes(query.toLowerCase());
    const matchesGroup = groupId === null || memberships.some((item) => item.member_id === member.id && item.subgroup_id === groupId && item.status === "active");
    return matchesSearch && matchesGroup;
  });
  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const outcome = await save(form);
    if (outcome.ok) { setEditing(false); loadMembers(); }
  }
  const roster = loadFailed && !members.length
    ? <ErrorBlock message="The member directory could not be loaded." onRetry={() => void loadMembers()} role="alert" />
    : filtered.length
      ? <div className="member-grid">{filtered.map((member) => <MemberCard key={member.id} member={member} groups={groups} memberships={memberships} />)}</div>
      : <EmptyState title="No members found" text={groupId === null ? "Try another search." : "No members are active in this subgroup."} />;
  // Until the first read answers the page is its own placeholder (a title bar, a toolbar bar and the grid of cards), so that it does not jump
  // when the members arrive, announced once as Loading the members.
  if (loading) return <section className="section-shell page-section"><span className="sr-only" role="status">Loading the members</span><div aria-hidden="true"><Skeleton className="roster-skeleton-title" /><Skeleton className="roster-skeleton-toolbar" /><div className="member-grid">{Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="member-skeleton" />)}</div></div></section>;
  return <section className="section-shell page-section"><PageTitle eyebrow="CLUB ROSTER" title="Member roster" text="Find the people who make music with Bharat Sangeet at UNC Chapel Hill, organized by the subgroups they are part of." /><div className="toolbar"><label className="search">⌕<input aria-label="Search members" value={query} onChange={(event) => { setQuery(event.target.value); setUrlQuery(event.target.value); }} placeholder="Search by name, year, or musical interest" /></label><label className="scope-picker roster-filter"><span>Group</span><select aria-label="Filter roster by subgroup" value={groupId === null ? "all" : String(groupId)} onChange={(event) => setGroupParam(event.target.value === "all" ? null : Number(event.target.value))}><option value="all">Everyone</option>{groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label><Button onClick={() => setEditing(true)} disabled={loadFailed && !ownProfile}>Edit my contact info</Button></div><p className="directory-note">This directory is visible only to signed-in club members. Subgroup tags show active memberships.</p>{loadFailed && members.length > 0 && <LoadErrorBanner message="The directory could not be refreshed, so it may be out of date." onRetry={() => void loadMembers()} />}{roster}{editing && <ContactDialog ownProfile={ownProfile} email={user.email || ""} saving={saving} onClose={() => setEditing(false)} onSubmit={saveProfile} />}</section>;
}
