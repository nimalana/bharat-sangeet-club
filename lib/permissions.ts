// Who may do what, written down once. Components ask these functions; they do not compare `role === "..."`.
//
// This decides which controls the screen shows. The database enforces the same rules (row-level security and the
// functions in supabase/migrations); a control shown by mistake is refused there, a control hidden by mistake cannot
// be used. The group rules are the table of the implementation plan, section 1.1:
//
//   | Action                                                  | Member | Leader | Manager | Executive |
//   | Approve, waitlist, decline a pending or waitlisted request |        | yes    | yes     | yes       |
//   | Remove a plain member from the group                    |        |        | yes     | yes       |
//   | Remove or change a leader or manager                    |        |        |         | yes       |
//   | Change a member's group role                            |        |        |         | yes       |
//   | Add a member directly                                   |        |        |         | yes       |
//   | Rename, edit description                                |        |        | yes     | yes       |
//   | Change enrollment mode, archive group                   |        |        |         | yes       |
//   | Leave the group                                         | yes    | yes    | yes, unless last manager | yes |
//   | Post group announcement, add date, run attendance       |        |        |         | yes       |
//
// "Executive" is the club role executive or admin: an administrator has every executive right. "Member", "Leader" and
// "Manager" are the person's role in THAT group (an active membership); a club executive needs no membership.
//
// Type-only imports: node's test runner loads this file (tests/permissions.test.mjs).
import type { ClubRole, GroupRole, MembershipStatus } from "./db";

// ---------------------------------------------------------------- club level

/** An executive or an administrator: everything a club officer may do in the portal. */
export function isExecutive(role: ClubRole): boolean {
  return role === "executive" || role === "admin";
}

/** An administrator only (the Admin page, roles, deactivating members). */
export function isAdmin(role: ClubRole): boolean {
  return role === "admin";
}

/** Club-wide screens that members see in a reduced form (finances, attendance, calendar and recording management). */
export const canManageClub = isExecutive;

/** Post a group announcement, add an important date, run attendance: executive only. */
export function canPostToGroup(role: ClubRole): boolean {
  return isExecutive(role);
}

// ---------------------------------------------------------------- one group
// `groupRole` is the person's role in the group, null when they are not an active member of it.

/** Approve, waitlist or decline a pending or waitlisted request. */
export function canReviewGroupRequests(role: ClubRole, groupRole: GroupRole | null): boolean {
  return isExecutive(role) || groupRole === "leader" || groupRole === "manager";
}

/** Remove a member. `target` is the role of the person being removed: a manager removes plain members only. */
export function canRemoveGroupMember(role: ClubRole, groupRole: GroupRole | null, target: GroupRole): boolean {
  if (isExecutive(role)) return true;
  return groupRole === "manager" && target === "member";
}

/** Rename the group, edit its description. */
export function canEditGroupDetails(role: ClubRole, groupRole: GroupRole | null): boolean {
  return isExecutive(role) || groupRole === "manager";
}

/** Change a member's group role (this includes making or removing a leader or manager). */
export function canChangeGroupRoles(role: ClubRole): boolean {
  return isExecutive(role);
}

/** Add a member directly, without a request. */
export function canAddGroupMembers(role: ClubRole): boolean {
  return isExecutive(role);
}

/** Change the enrollment mode (open, approval, invitation only). */
export function canChangeGroupEnrollment(role: ClubRole): boolean {
  return isExecutive(role);
}

/** Archive or restore the group. */
export function canArchiveGroup(role: ClubRole): boolean {
  return isExecutive(role);
}

/**
 * Leave the group: any member of it, except the last manager (a group must keep one). `lastManager` is only known to
 * the database, which refuses it; a screen that cannot tell passes false and lets the database answer.
 */
export function canLeaveGroup(groupRole: GroupRole | null, lastManager = false): boolean {
  if (groupRole === null) return false;
  return !(groupRole === "manager" && lastManager);
}

/**
 * Manage the member-visible library items of a group: executives, and the group's leaders and managers.
 * `memberships` are the person's own memberships in that group.
 */
export function canManageGroupResources(role: ClubRole, memberships: ReadonlyArray<{ status: MembershipStatus; membership_role: GroupRole }>): boolean {
  return isExecutive(role) || memberships.some((membership) => membership.status === "active" && (membership.membership_role === "leader" || membership.membership_role === "manager"));
}

/** What the group roster screen shows, for one person in one group. */
export function groupCapabilities(role: ClubRole, groupRole: GroupRole | null) {
  return {
    isExecutive: isExecutive(role),
    canReviewRequests: canReviewGroupRequests(role, groupRole),
    // Whether the person may remove anyone at all; canRemoveGroupMember says whom.
    canRemoveMembers: isExecutive(role) || groupRole === "manager",
    canEditGroup: canEditGroupDetails(role, groupRole),
    canChangeRoles: canChangeGroupRoles(role),
    canAddMembers: canAddGroupMembers(role),
    canChangeEnrollment: canChangeGroupEnrollment(role),
    canArchive: canArchiveGroup(role),
  };
}
