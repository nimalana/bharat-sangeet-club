"use client";

import type { ClubRole, Announcement, ArchiveItem, Subgroup } from "../../../lib/db";
import { initials } from "../../../lib/format";
import { canManageClub } from "../../../lib/permissions";
import { Button } from "../../../components/ui/button";
import { EmptyState } from "../../../components/ui/empty-state";

/** The groups the person can open (all of them for an executive): a heading with the count, one row per group, or an empty state. */
export function GroupList({ role, joinedGroups, items, announcements, requestCounts, onOpen, onCreate }: {
  role: ClubRole; joinedGroups: Subgroup[]; items: ArchiveItem[]; announcements: Announcement[]; requestCounts: Record<number, number>;
  onOpen: (groupId: number) => void; onCreate: () => void;
}) {
  return <>
    <div className="group-list-heading"><div><h2>{!canManageClub(role) ? "Your groups" : "Groups you manage"}</h2><p>Open a group to see its latest activity.</p></div><div><span>{joinedGroups.length}</span>{canManageClub(role) && <Button onClick={onCreate}>＋ New group</Button>}</div></div>
    {joinedGroups.length ? <div className="group-list">{joinedGroups.map((group) => { const resourceCount = items.filter((item) => item.subgroup_id === group.id).length; const updateCount = announcements.filter((item) => item.subgroup_id === group.id).length; return <button type="button" key={group.id} onClick={() => onOpen(group.id)}><span className="workspace-seal subgroup">{initials(group.name)}</span><span><b>{group.name}{group.archived_at ? " (archived)" : ""}</b><small>{requestCounts[group.id] ? `${requestCounts[group.id]} ${requestCounts[group.id] === 1 ? "request" : "requests"} to review` : group.description || "Bharat Sangeet group"}</small></span><span><b>{updateCount}</b><small>updates</small></span><span><b>{resourceCount}</b><small>resources</small></span><i>Open →</i></button>; })}</div> : <EmptyState title="No groups yet" text={!canManageClub(role) ? "Join an open group or ask an executive for an invitation." : "Create the first group to organize rehearsals and resources."} />}
  </>;
}
