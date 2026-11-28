// lib/permissions.ts encodes the table of plan section 1.1 once. This file is the table, cell by cell, written out
// independently of the code: one row per action, one column per person (Member, Leader, Manager, Executive), plus the
// administrator (every executive right), someone who is not in the group, and the club-level helpers the screens used
// to write as `role !== "member"` or `role === "executive" || role === "admin"`.
import assert from "node:assert/strict";
import test from "node:test";
import {
  canAddGroupMembers, canArchiveGroup, canChangeGroupEnrollment, canChangeGroupRoles, canEditGroupDetails, canLeaveGroup, canManageClub,
  canManageGroupResources, canPostToGroup, canRemoveGroupMember, canReviewGroupRequests, groupCapabilities, isAdmin, isExecutive,
} from "../lib/permissions.ts";

// A person is a club role plus their role in the group (null: not a member of it).
const PEOPLE = {
  member: ["member", "member"],
  leader: ["member", "leader"],
  manager: ["member", "manager"],
  executive: ["executive", null],
  "executive in the group": ["executive", "member"],
  admin: ["admin", null],
  outsider: ["member", null],
  "pending or former member": ["member", null], // an inactive or pending membership is not a role in the group
};
const table = (member, leader, manager, executive) => ({
  member, leader, manager, executive, "executive in the group": executive, admin: executive, outsider: false, "pending or former member": false,
});

// The table of plan 1.1. Each row: [Member, Leader, Manager, Executive].
const ROWS = {
  "approve, waitlist or decline a request": { cells: table(false, true, true, true), ask: (role, groupRole) => canReviewGroupRequests(role, groupRole) },
  "remove a plain member": { cells: table(false, false, true, true), ask: (role, groupRole) => canRemoveGroupMember(role, groupRole, "member") },
  "remove a leader": { cells: table(false, false, false, true), ask: (role, groupRole) => canRemoveGroupMember(role, groupRole, "leader") },
  "remove a manager": { cells: table(false, false, false, true), ask: (role, groupRole) => canRemoveGroupMember(role, groupRole, "manager") },
  "change a member's group role": { cells: table(false, false, false, true), ask: (role) => canChangeGroupRoles(role) },
  "add a member directly": { cells: table(false, false, false, true), ask: (role) => canAddGroupMembers(role) },
  "rename or edit the description": { cells: table(false, false, true, true), ask: (role, groupRole) => canEditGroupDetails(role, groupRole) },
  "change the enrollment mode": { cells: table(false, false, false, true), ask: (role) => canChangeGroupEnrollment(role) },
  "archive the group": { cells: table(false, false, false, true), ask: (role) => canArchiveGroup(role) },
  "post a group announcement, add a date, run attendance": { cells: table(false, false, false, true), ask: (role) => canPostToGroup(role) },
};

for (const [action, { cells, ask }] of Object.entries(ROWS)) {
  test(`plan 1.1, ${action}`, () => {
    for (const [person, [role, groupRole]] of Object.entries(PEOPLE)) {
      assert.equal(ask(role, groupRole), cells[person], `${action}: ${person}`);
    }
  });
}

test("plan 1.1, leave the group: any member of it, but not the last manager", () => {
  const leaves = { member: true, leader: true, manager: true, "executive in the group": true, executive: false, admin: false, outsider: false, "pending or former member": false };
  for (const [person, [, groupRole]] of Object.entries(PEOPLE)) assert.equal(canLeaveGroup(groupRole), leaves[person], person);
  assert.equal(canLeaveGroup("manager", true), false, "the last manager");
  assert.equal(canLeaveGroup("manager", false), true);
  assert.equal(canLeaveGroup("leader", true), true, "a leader is never the last manager");
  assert.equal(canLeaveGroup("member", true), true);
});

test("an executive does not need to be in the group; being in it adds nothing; a group role never lifts a plain member to executive rights", () => {
  for (const groupRole of [null, "member", "leader", "manager"]) {
    for (const role of ["executive", "admin"]) {
      assert.equal(canReviewGroupRequests(role, groupRole), true);
      assert.equal(canRemoveGroupMember(role, groupRole, "manager"), true);
      assert.equal(canEditGroupDetails(role, groupRole), true);
    }
  }
  for (const groupRole of [null, "member", "leader", "manager"]) {
    assert.equal(canChangeGroupRoles("member"), false, `club member, ${groupRole}`);
    assert.equal(canAddGroupMembers("member"), false);
    assert.equal(canChangeGroupEnrollment("member"), false);
    assert.equal(canArchiveGroup("member"), false);
    assert.equal(canPostToGroup("member"), false);
  }
});

test("club level: executive and admin are officers, a member is not; only the admin is admin", () => {
  for (const [role, executive, admin] of [["member", false, false], ["executive", true, false], ["admin", true, true]]) {
    assert.equal(isExecutive(role), executive, role);
    assert.equal(canManageClub(role), executive, role);
    assert.equal(isAdmin(role), admin, role);
  }
  // The answer the old comparisons gave for the three roles: `role !== "member"`, `role === "executive" || role === "admin"`.
  for (const role of ["member", "executive", "admin"]) {
    assert.equal(isExecutive(role), role !== "member");
    assert.equal(isExecutive(role), role === "executive" || role === "admin");
  }
  // Anything that is not a known officer role is not an officer (the old `role !== "member"` would have said yes).
  for (const unknown of ["treasurer", undefined, null, ""]) {
    for (const ask of [isExecutive, canManageClub, canChangeGroupRoles, canAddGroupMembers, canChangeGroupEnrollment, canArchiveGroup, canPostToGroup]) assert.equal(ask(unknown), false, `${ask.name} for ${String(unknown)}`);
    assert.equal(canReviewGroupRequests(unknown, null), false);
    assert.equal(canRemoveGroupMember(unknown, null, "member"), false);
    assert.equal(canEditGroupDetails(unknown, null), false);
    assert.equal(canManageGroupResources(unknown, []), false);
  }
});

test("group resources: executives, and a group's active leaders and managers; a pending or former leader, or a plain member, may not", () => {
  const rows = (...items) => items.map(([status, membership_role]) => ({ status, membership_role }));
  assert.equal(canManageGroupResources("executive", []), true);
  assert.equal(canManageGroupResources("admin", []), true);
  assert.equal(canManageGroupResources("member", rows(["active", "leader"])), true);
  assert.equal(canManageGroupResources("member", rows(["active", "manager"])), true);
  assert.equal(canManageGroupResources("member", rows(["active", "member"])), false);
  assert.equal(canManageGroupResources("member", rows(["pending", "leader"])), false);
  assert.equal(canManageGroupResources("member", rows(["inactive", "manager"])), false);
  assert.equal(canManageGroupResources("member", rows(["removed", "manager"])), false);
  assert.equal(canManageGroupResources("member", rows(["waitlisted", "leader"])), false);
  assert.equal(canManageGroupResources("member", []), false);
  assert.equal(canManageGroupResources("member", rows(["active", "member"], ["active", "leader"])), true);
});

test("the bundle the roster screen reads is the same answers (and the shape it always had)", () => {
  assert.deepEqual(Object.keys(groupCapabilities("member", null)).sort(), ["canAddMembers", "canArchive", "canChangeEnrollment", "canChangeRoles", "canEditGroup", "canRemoveMembers", "canReviewRequests", "isExecutive"]);
  assert.deepEqual(groupCapabilities("member", "leader"), { isExecutive: false, canReviewRequests: true, canRemoveMembers: false, canEditGroup: false, canChangeRoles: false, canAddMembers: false, canChangeEnrollment: false, canArchive: false });
  assert.deepEqual(groupCapabilities("member", "manager"), { isExecutive: false, canReviewRequests: true, canRemoveMembers: true, canEditGroup: true, canChangeRoles: false, canAddMembers: false, canChangeEnrollment: false, canArchive: false });
  assert.deepEqual(groupCapabilities("executive", null), { isExecutive: true, canReviewRequests: true, canRemoveMembers: true, canEditGroup: true, canChangeRoles: true, canAddMembers: true, canChangeEnrollment: true, canArchive: true });
  assert.deepEqual(groupCapabilities("member", "member"), { isExecutive: false, canReviewRequests: false, canRemoveMembers: false, canEditGroup: false, canChangeRoles: false, canAddMembers: false, canChangeEnrollment: false, canArchive: false });
  assert.deepEqual(groupCapabilities("admin", "member"), groupCapabilities("executive", null));
});
