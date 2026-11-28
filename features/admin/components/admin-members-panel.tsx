"use client";

import type { User } from "@supabase/supabase-js";
import { useState } from "react";
import type { ClubRole } from "../../../lib/db";
import type { MemberProfile, Subgroup, SubgroupMembership } from "../../../lib/portal-types";
import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import { MemberAccessActions } from "./member-access";

/**
 * "Manage members": a searchable list of every member with their groups, a permission select, Edit, and deactivate, reactivate and
 * delete. Deactivated members are listed only when asked for (and only when there are any).
 */
export function AdminMembersPanel({ user, members, groups, memberships, onChangeRole, onEdit, onChanged }: {
  user: User; members: MemberProfile[]; groups: Subgroup[]; memberships: SubgroupMembership[];
  onChangeRole: (member: MemberProfile, nextRole: ClubRole) => void; onEdit: (member: MemberProfile) => void; onChanged: () => void | Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [showDeactivated, setShowDeactivated] = useState(false);
  const activeMembers = members.filter((member) => member.status !== "deactivated");
  const deactivatedCount = members.length - activeMembers.length;
  const filtered = (showDeactivated ? members : activeMembers).filter((member) => `${member.full_name} ${member.email} ${member.role}`.toLowerCase().includes(query.toLowerCase()));
  return <section className="admin-panel admin-members"><div className="admin-panel-heading"><div><p className="eyebrow">ACCESS & IDENTITIES</p><h2>Manage members</h2><p className="panel-note">Edit profile details and assign active subgroups from one place.</p></div><label className="search"><span aria-hidden="true">⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search members" /></label></div>{deactivatedCount > 0 && <label className="check-label admin-show-deactivated"><input type="checkbox" checked={showDeactivated} onChange={(event) => setShowDeactivated(event.target.checked)} /> Show {deactivatedCount} deactivated</label>}<div className="admin-member-head"><span>Member</span><span>Subgroups</span><span>Permission</span><span>Action</span></div>{filtered.map((member) => { const memberGroups = memberships.filter((item) => item.member_id === member.id && item.status === "active"); return <div className="admin-member-row" key={member.id}><div className="min-w-0"><b className="break-words">{member.full_name || member.email}{member.status === "deactivated" && <> <Badge variant="muted">Deactivated</Badge></>}</b><small className="break-all">{member.email}</small></div><div className="member-tags admin-member-tags">{memberGroups.length ? memberGroups.map((item) => <Badge key={item.subgroup_id}>{groups.find((group) => group.id === item.subgroup_id)?.name || "Subgroup"}</Badge>) : <Badge variant="muted">No subgroup</Badge>}</div><select className="max-w-full min-w-0" value={member.role} disabled={member.id === user.id || member.status === "deactivated"} onChange={(event) => onChangeRole(member, event.target.value as ClubRole)} aria-label={`Permission for ${member.full_name || member.email}`}><option value="member">Member</option><option value="executive">Executive</option><option value="admin">Admin</option></select><div className="admin-member-actions">{member.status !== "deactivated" && <Button variant="secondary" size="sm" onClick={() => onEdit(member)}>Edit</Button>}<MemberAccessActions member={member} isSelf={member.id === user.id} onChanged={onChanged} /></div></div>; })}</section>;
}
