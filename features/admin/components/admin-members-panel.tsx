"use client";

import type { User } from "@supabase/supabase-js";
import { useState } from "react";
import type { ClubRole, MemberProfile, Subgroup, SubgroupMembership } from "../../../lib/db";
import { useUrlState, type UrlStateOptions } from "../../../lib/hooks/use-url-state";
import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import type { AdminListStatus } from "../hooks/use-admin-data";
import { ListFailure } from "./list-failure";
import { MemberAccessActions } from "./member-access";

// The search and the "show deactivated" box are in the address (`?q=`, `?deactivated=1`) so that a reload or a link keeps the list as it
// was; they replace the current history entry (letters typed one by one are not steps to go Back through). Defined here, not in the
// component, because useUrlState compares its options between renders.
const SEARCH: UrlStateOptions<string> = { defaultValue: "", history: "replace" };
const DEACTIVATED: UrlStateOptions<boolean> = { defaultValue: false, parse: (raw) => (raw === "1" ? true : undefined), serialize: (value) => (value ? "1" : "0"), history: "replace" };

/**
 * "Manage members": a searchable list of every member with their groups, a permission select, Edit, and deactivate, reactivate and
 * delete. Deactivated members are listed only when asked for (and only when there are any).
 * Optional: `changingRoleOf` is the member whose permission is being saved (every select waits, that one says it is busy);
 * `membersStatus` / `membershipsStatus` say how the last reads went (a failed first read of the members is an error with Try again, in
 * the place of the list; a failed read of the groups, a warning that the Subgroups column may be wrong).
 */
export function AdminMembersPanel({ user, members, groups, memberships, onChangeRole, onEdit, onChanged, changingRoleOf = null, membersStatus = "ready", membershipsStatus = "ready", onRetry = () => {}, retrying = false }: {
  user: User; members: MemberProfile[]; groups: Subgroup[]; memberships: SubgroupMembership[];
  onChangeRole: (member: MemberProfile, nextRole: ClubRole) => void | Promise<void>; onEdit: (member: MemberProfile) => void; onChanged: () => void | Promise<void>;
  changingRoleOf?: string | null; membersStatus?: AdminListStatus; membershipsStatus?: AdminListStatus; onRetry?: () => void; retrying?: boolean;
}) {
  const [urlQuery, setUrlQuery] = useUrlState("q", SEARCH);
  const [showDeactivated, setShowDeactivated] = useUrlState("deactivated", DEACTIVATED);
  // What is typed is kept here, so the caret stays where it is; the address follows, and follows back when it changes by itself (Back, a link).
  const [query, setQuery] = useState(urlQuery);
  const [seen, setSeen] = useState(urlQuery);
  if (urlQuery !== seen) { setSeen(urlQuery); setQuery(urlQuery); }
  const search = (value: string) => { setQuery(value); setUrlQuery(value); };

  const activeMembers = members.filter((member) => member.status !== "deactivated");
  const deactivatedCount = members.length - activeMembers.length;
  const filtered = (showDeactivated ? members : activeMembers).filter((member) => `${member.full_name} ${member.email} ${member.role}`.toLowerCase().includes(query.toLowerCase()));
  const groupsWarning = membershipsStatus === "failed"
    ? "The groups of each member could not be loaded, so the Subgroups column may be wrong."
    : "The groups of each member could not be refreshed, so the Subgroups column may be out of date.";
  return <section className="admin-panel admin-members"><div className="admin-panel-heading"><div><p className="eyebrow">ACCESS & IDENTITIES</p><h2>Manage members</h2><p className="panel-note">Edit profile details and assign active subgroups from one place.</p></div><label className="search"><span aria-hidden="true">⌕</span><input aria-label="Search members" value={query} onChange={(event) => search(event.target.value)} placeholder="Search members" /></label></div>
    <ListFailure status={membersStatus} failed="The members could not be loaded." stale="The members could not be refreshed, so they may be out of date." onRetry={onRetry} busy={retrying} />
    {membersStatus !== "failed" && membershipsStatus !== "ready" && <p className="action-feedback error" role="alert">{groupsWarning} <Button variant="secondary" size="sm" onClick={onRetry} pending={retrying}>Try again</Button></p>}
    {membersStatus !== "failed" && <>
      {deactivatedCount > 0 && <label className="check-label admin-show-deactivated"><input type="checkbox" checked={showDeactivated} onChange={(event) => setShowDeactivated(event.target.checked)} /> Show {deactivatedCount} deactivated</label>}
      <div className="admin-member-head"><span>Member</span><span>Subgroups</span><span>Permission</span><span>Action</span></div>
      {filtered.map((member) => { const memberGroups = memberships.filter((item) => item.member_id === member.id && item.status === "active"); return <div className="admin-member-row" key={member.id}><div className="min-w-0"><b className="break-words">{member.full_name || member.email}{member.status === "deactivated" && <> <Badge variant="muted">Deactivated</Badge></>}</b><small className="break-all">{member.email}</small></div><div className="member-tags admin-member-tags">{memberGroups.length ? memberGroups.map((item) => <Badge key={item.subgroup_id}>{groups.find((group) => group.id === item.subgroup_id)?.name || "Subgroup"}</Badge>) : <Badge variant="muted">No subgroup</Badge>}</div><select className="max-w-full min-w-0" value={member.role} disabled={member.id === user.id || member.status === "deactivated" || changingRoleOf !== null} aria-busy={changingRoleOf === member.id || undefined} onChange={(event) => void onChangeRole(member, event.target.value as ClubRole)} aria-label={`Permission for ${member.full_name || member.email}`}><option value="member">Member</option><option value="executive">Executive</option><option value="admin">Admin</option></select><div className="admin-member-actions">{member.status !== "deactivated" && <Button variant="secondary" size="sm" onClick={() => onEdit(member)}>Edit</Button>}<MemberAccessActions member={member} isSelf={member.id === user.id} onChanged={onChanged} /></div></div>; })}
      {filtered.length === 0 && query && <p className="workspace-empty">No member matches “{query}”.</p>}
    </>}</section>;
}
