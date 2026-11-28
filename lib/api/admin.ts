// What the Admin page asks of the database: the member list (active and deactivated members), the announcements and audit log it shows,
// the administrator-only changes to a member (permission, profile, deactivate, reactivate, delete), and its announcement form.
// The sign-up queue (people who signed in and wait for an executive) is here too: listPendingMembers and reviewPendingMember.
// Plain async functions with literal table and RPC names; a failed call throws an ApiError (lib/errors.ts). No React, no toast.
import type { ClubRole, Tables, TablesInsert, Announcement, MemberProfile } from "../db";
import { ApiError } from "../errors";
import { supabase } from "../supabase";
import { must } from "./_core";

function client() {
  if (!supabase) throw new ApiError("Supabase is not configured");
  return supabase;
}

/** One line of the audit log, as the Admin page lists it. */
export type AuditEntry = Pick<Tables<"admin_audit_log">, "id" | "action" | "actor_email" | "target_email" | "details" | "created_at">;

/**
 * Every member, deactivated ones included, by name, at most 2000. People whose sign-up is pending or was declined are not members
 * and are not here (listPendingMembers has them); without the filter an administrator would count and edit them as members.
 */
export async function listAdminMembers(): Promise<MemberProfile[]> {
  return must(await client().from("profiles").select("id,full_name,email,role,status,phone,class_year,specialty,joined_at").in("status", ["active", "deactivated"]).order("full_name").limit(2000)) as MemberProfile[];
}

/** The latest announcements of the club and of every group, pinned first, at most 50. */
export async function listAdminAnnouncements(): Promise<Announcement[]> {
  return must(await client().from("announcements").select("*").order("is_pinned", { ascending: false }).order("published_at", { ascending: false }).limit(50));
}

/** The 20 latest administrator actions, newest first. */
export async function listAuditLog(): Promise<AuditEntry[]> {
  return must(await client().from("admin_audit_log").select("id,action,actor_email,target_email,details,created_at").order("created_at", { ascending: false }).limit(20));
}

/**
 * One line of the sign-up queue. `status` is "pending" (waiting) or "rejected" (declined, kept so an executive can undo it).
 * `decided_at`, `decided_by_name` and the `reason` are only filled for a declined sign-up (the reason is empty when none was given);
 * the person who signed up never sees the reason.
 */
export type SignupRequest = {
  member_id: string; full_name: string; email: string; status: "pending" | "rejected";
  requested_at: string; decided_at: string | null; decided_by_name: string | null; reason: string;
};

/** The sign-ups waiting for approval (oldest first, at most 500) and the 50 most recently declined. Executives and administrators only. */
export async function listPendingMembers(): Promise<SignupRequest[]> {
  return (must(await client().rpc("list_pending_members")) ?? []) as SignupRequest[];
}

/**
 * Approves or declines a sign-up. A declined sign-up can be approved afterwards (the undo); the reason is for executives only.
 * The database refuses, in words, a review of someone who is no longer waiting (already approved, already declined, deactivated)
 * and a review of your own sign-up.
 */
export async function reviewPendingMember(memberId: string, approved: boolean, reason = ""): Promise<void> {
  must(await client().rpc("review_pending_member", { p_member_id: memberId, p_approved: approved, p_reason: reason }));
}

/** Changes a member's club permission. */
export async function changeMemberRole(memberId: string, nextRole: ClubRole): Promise<void> {
  must(await client().rpc("admin_change_member_role", { p_target_id: memberId, p_new_role: nextRole }));
}

/** Saves a member's directory details and sets the groups they are active in. */
export async function updateMemberProfile(memberId: string, fields: { fullName: string; phone: string; classYear: string; specialty: string; subgroupIds: number[] }): Promise<void> {
  must(await client().rpc("admin_update_member_profile", {
    p_target_id: memberId,
    p_full_name: fields.fullName,
    p_phone: fields.phone,
    p_class_year: fields.classYear,
    p_specialty: fields.specialty,
    p_subgroup_ids: fields.subgroupIds,
  }));
}

/** Deactivates an account (it keeps its history); the reason is shown to administrators. */
export async function deactivateMember(memberId: string, reason: string): Promise<void> {
  must(await client().rpc("admin_deactivate_member", { p_target_id: memberId, p_reason: reason }));
}

/** Lets a deactivated account sign in again. */
export async function reactivateMember(memberId: string): Promise<void> {
  must(await client().rpc("admin_reactivate_member", { p_target_id: memberId }));
}

/** Deletes a deactivated account for good (the database refuses when it has finance or recording history). */
export async function deleteMember(memberId: string): Promise<void> {
  must(await client().rpc("admin_delete_member", { p_target_id: memberId }));
}

/**
 * Publishes an announcement from the Admin page's form: to the whole club, or to one group.
 * (features/announcements has its own editor; this is the Admin page's separate form and is not merged with it.)
 */
export async function publishAnnouncement(fields: { title: string; body: string; isPinned: boolean; createdBy: string; subgroupId: number | null }): Promise<void> {
  const row: TablesInsert<"announcements"> = { title: fields.title, body: fields.body, is_pinned: fields.isPinned, created_by: fields.createdBy };
  if (fields.subgroupId !== null) row.subgroup_id = fields.subgroupId;
  must(await client().from("announcements").insert(row));
}
