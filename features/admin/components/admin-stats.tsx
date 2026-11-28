"use client";

import type { MemberProfile } from "../../../lib/portal-types";

/** The four numbers at the top of the Admin page, counted over the active members. */
export function AdminStats({ activeMembers }: { activeMembers: MemberProfile[] }) {
  return <div className="admin-stats"><div><strong>{activeMembers.length}</strong><span>Active members</span></div><div><strong>{activeMembers.filter((member) => member.role === "executive").length}</strong><span>Executives</span></div><div><strong>{activeMembers.filter((member) => member.role === "admin").length}</strong><span>Administrators</span></div><div><strong>{activeMembers.filter((member) => !member.phone || !member.specialty).length}</strong><span>Incomplete profiles</span></div></div>;
}
