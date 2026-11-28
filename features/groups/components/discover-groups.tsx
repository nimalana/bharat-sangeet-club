"use client";

import { initials } from "../../../lib/format";
import type { Subgroup, SubgroupMembership } from "../../../lib/db";
import { Button } from "../../../components/ui/button";

/** The groups the person is not in yet, each with what they can do about it: join, ask, wait, or be invited. */
export function DiscoverGroups({ groups, membershipFor, joining, onJoin }: {
  groups: Subgroup[]; membershipFor: (groupId: number) => SubgroupMembership | undefined; joining: number | null; onJoin: (group: Subgroup) => void;
}) {
  return <>
    <div className="group-list-heading discover"><div><h2>Discover groups</h2><p>Find another ensemble to join.</p></div><span>{groups.length}</span></div>
    <div className="discover-grid">{groups.map((group) => { const membership = membershipFor(group.id); return <article className="discover-card" key={group.id}><span className="workspace-seal subgroup">{initials(group.name)}</span><h2>{group.name}</h2><p>{group.description || "A Bharat Sangeet group at UNC Chapel Hill."}</p>{membership?.status === "pending" ? <span className="enrollment-status">Request pending</span> : membership?.status === "waitlisted" ? <span className="enrollment-status">Waitlisted</span> : membership?.status === "removed" ? <span className="enrollment-status muted">Ask an executive to add you back</span> : group.enrollment_mode === "invite" ? <span className="enrollment-status muted">Invitation required</span> : <Button variant="secondary" pending={joining === group.id} onClick={() => onJoin(group)}>{joining === group.id ? "Sending…" : group.enrollment_mode === "open" ? "Join group" : "Request to join"}</Button>}</article>; })}</div>
  </>;
}
