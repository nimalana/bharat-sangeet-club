// Everything the group pages ask of the database: the group lists, a person's memberships, a group's roster, joining and leaving,
// reviewing requests, the group settings, and the group's own announcements. Plain async functions with literal table and RPC
// names (the contract check reads them); a failed call throws an ApiError (lib/errors.ts). No React, no toast, no sentences:
// the screens (features/groups) decide what a failure says.
import type { EnrollmentMode, GroupRole, RpcReturns, TablesInsert } from "../db";
import { ApiError } from "../errors";
import type { Announcement, ArchiveItem, Subgroup, SubgroupMembership } from "../portal-types";
import { supabase } from "../supabase";
import { must } from "./_core";

// The screens only open when the client exists (the shell shows the set-up screen otherwise); this keeps a missing client from
// being a null dereference if one is ever called without it.
function client() {
  if (!supabase) throw new ApiError("Supabase is not configured");
  return supabase;
}

/** One row of a group's roster, as `list_subgroup_roster` returns it. */
export type RosterRow = RpcReturns<"list_subgroup_roster">[number];

// ---------------------------------------------------------------- the groups page (SubgroupSpaces)

/** Every group the person's role lets them see (archived ones too: the screen decides who may see them), by name. */
export async function listSubgroups(): Promise<Subgroup[]> {
  return must(await client().from("subgroups").select("id,name,description,enrollment_mode,archived_at").order("name"));
}

/** The person's own memberships, whatever their status. */
export async function listMyMemberships(memberId: string): Promise<SubgroupMembership[]> {
  return must(await client().from("subgroup_memberships").select("subgroup_id,member_id,status,membership_role").eq("member_id", memberId));
}

/** Every membership the person may read (their own, and the others of the groups they lead; everyone's for an executive), at most 5000. */
export async function listAllMemberships(): Promise<SubgroupMembership[]> {
  return must(await client().from("subgroup_memberships").select("subgroup_id,member_id,status,membership_role").limit(5000));
}

/** The recordings that belong to a group, newest first, at most 500. */
export async function listGroupRecordings(): Promise<ArchiveItem[]> {
  return must(await client().from("archive_items").select("*").eq("type", "recording").not("subgroup_id", "is", null).order("created_at", { ascending: false }).limit(500)) as ArchiveItem[];
}

/** The announcements that belong to a group, newest first, at most 300. */
export async function listGroupAnnouncements(): Promise<Announcement[]> {
  return must(await client().from("announcements").select("*").not("subgroup_id", "is", null).order("published_at", { ascending: false }).limit(300));
}

/**
 * The waiting requests (pending or waitlisted) of other people, one row per request. Row-level security returns them only to
 * executives and to that group's leaders and managers, so for anyone else the list is empty.
 */
export async function listOthersWaitingRequests(memberId: string): Promise<Array<{ subgroup_id: number }>> {
  return must(await client().from("subgroup_memberships").select("subgroup_id").in("status", ["pending", "waitlisted"]).neq("member_id", memberId));
}

/** Asks to join a group (or joins it at once, when it is open). The answer is the person's membership row. */
export async function requestSubgroupEnrollment(groupId: number): Promise<SubgroupMembership> {
  return must(await client().rpc("request_subgroup_enrollment", { target_subgroup_id: groupId })) as SubgroupMembership;
}

/** Creates a group (executives). The answer is the new group row. */
export async function createSubgroup(fields: { name: string; description: string; mode: EnrollmentMode }): Promise<Subgroup> {
  return must(await client().rpc("create_subgroup", { subgroup_name: fields.name, subgroup_description: fields.description, subgroup_mode: fields.mode })) as Subgroup;
}

/** Posts an announcement to one group. */
export async function postGroupAnnouncement(fields: { title: string; body: string; isPinned: boolean; subgroupId: number; createdBy: string }): Promise<void> {
  const row: TablesInsert<"announcements"> = { title: fields.title, body: fields.body, is_pinned: fields.isPinned, subgroup_id: fields.subgroupId, created_by: fields.createdBy };
  must(await client().from("announcements").insert(row));
}

// ---------------------------------------------------------------- one group's people (GroupPeople)

/** A group's roster: its members and the people waiting to join. */
export async function listSubgroupRoster(groupId: number): Promise<RosterRow[]> {
  return must(await client().rpc("list_subgroup_roster", { p_subgroup_id: groupId })) || [];
}

/** Approves, waitlists or declines a request to join. */
export async function reviewSubgroupRequest(groupId: number, memberId: string, decision: "approve" | "waitlist" | "decline"): Promise<void> {
  must(await client().rpc("review_subgroup_request", { p_subgroup_id: groupId, p_member_id: memberId, p_decision: decision }));
}

/** Changes a member's role in the group. */
export async function setSubgroupMemberRole(groupId: number, memberId: string, nextRole: GroupRole): Promise<void> {
  must(await client().rpc("set_subgroup_member_role", { target_subgroup_id: groupId, target_member_id: memberId, next_role: nextRole }));
}

/** Removes a member from the group (their attendance is kept). */
export async function removeSubgroupMember(groupId: number, memberId: string): Promise<void> {
  must(await client().rpc("remove_subgroup_member", { p_subgroup_id: groupId, p_member_id: memberId }));
}

/** The signed-in person leaves the group. */
export async function leaveSubgroup(groupId: number): Promise<void> {
  must(await client().rpc("leave_subgroup", { p_subgroup_id: groupId }));
}

/** Archives a group (true) or restores it (false). */
export async function setSubgroupArchived(groupId: number, archived: boolean): Promise<void> {
  must(await client().rpc("set_subgroup_archived", { p_subgroup_id: groupId, p_archived: archived }));
}

/** Adds a club member to the group at once, with no request. */
export async function addSubgroupMember(groupId: number, memberId: string): Promise<void> {
  must(await client().rpc("add_subgroup_member", { p_subgroup_id: groupId, p_member_id: memberId }));
}

/** Saves a group's name and description. */
export async function updateSubgroup(groupId: number, name: string, description: string): Promise<void> {
  must(await client().rpc("update_subgroup", { p_subgroup_id: groupId, p_name: name, p_description: description }));
}

/** Changes how people join a group (executives). */
export async function setSubgroupEnrollmentMode(groupId: number, mode: EnrollmentMode): Promise<void> {
  must(await client().rpc("set_subgroup_enrollment_mode", { p_subgroup_id: groupId, p_mode: mode }));
}
