"use client";

import { initials } from "../../../lib/format";
import type { MemberProfile, Subgroup, SubgroupMembership } from "../../../lib/portal-types";
import { Badge } from "../../../components/ui/badge";

/** One member of the roster: initials, name and role, musical interests, the groups they are active in, and how to reach them. */
export function MemberCard({ member, groups, memberships }: { member: MemberProfile; groups: Subgroup[]; memberships: SubgroupMembership[] }) {
  const memberGroups = memberships.filter((item) => item.member_id === member.id && item.status === "active");
  return <article className="member-card"><div className="member-initials">{initials(member.full_name || member.email)}</div><div className="member-card-heading"><h3>{member.full_name || member.email.split("@")[0]}</h3><span className={`member-role ${member.role}`}>{member.role}</span></div><p>{member.specialty || "Musical interests not added yet"}</p><div className="member-tags">{memberGroups.length ? memberGroups.map((item) => <Badge key={item.subgroup_id}>{groups.find((group) => group.id === item.subgroup_id)?.name || "Subgroup"}</Badge>) : <Badge variant="muted">No subgroup yet</Badge>}</div><dl><div><dt>Email</dt><dd><a href={`mailto:${member.email}`}>{member.email}</a></dd></div>{member.phone && <div><dt>Phone</dt><dd><a href={`tel:${member.phone}`}>{member.phone}</a></dd></div>}{member.class_year && <div><dt>Class year</dt><dd>{member.class_year}</dd></div>}</dl></article>;
}
