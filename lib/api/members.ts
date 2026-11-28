// The member directory: who is in the club, the groups, and who is in which group; a member's own contact details; and the list of
// active members a group can add from. Plain async functions with literal table names; a failed call throws an ApiError
// (lib/errors.ts). No React, no toast, no sentences.
import type { MemberProfile, Subgroup, SubgroupMembership } from "../portal-types";
import type { Tables } from "../db";
import { ApiError } from "../errors";
import { supabase } from "../supabase";
import { must } from "./_core";

function client() {
  if (!supabase) throw new ApiError("Supabase is not configured");
  return supabase;
}

/** What the Members page shows: the active members (at most 2000), the groups, and the memberships (at most 5000). */
export type MemberDirectory = { members: MemberProfile[]; groups: Subgroup[]; memberships: SubgroupMembership[] };

/**
 * The three reads of the directory, asked together. All three are answered before the first failure is thrown (members, then
 * groups, then memberships): a half-answer is never returned.
 */
export async function getMemberDirectory(): Promise<MemberDirectory> {
  const db = client();
  const [memberResult, groupResult, membershipResult] = await Promise.all([
    db.from("profiles").select("id,full_name,email,role,phone,class_year,specialty,joined_at").eq("status", "active").order("full_name").limit(2000),
    db.from("subgroups").select("id,name,description,enrollment_mode").order("name"),
    db.from("subgroup_memberships").select("subgroup_id,member_id,status,membership_role").limit(5000),
  ]);
  return { members: (must(memberResult) || []) as MemberProfile[], groups: (must(groupResult) || []) as Subgroup[], memberships: (must(membershipResult) || []) as SubgroupMembership[] };
}

/** Saves the signed-in member's own contact details (the database lets a member change only these columns of their own row). */
export async function updateOwnContact(memberId: string, fields: { fullName: string; phone: string; classYear: string; specialty: string }): Promise<void> {
  must(await client().from("profiles").update({ full_name: fields.fullName, phone: fields.phone, class_year: fields.classYear, specialty: fields.specialty }).eq("id", memberId));
}

/** An active member as the "add a member to a group" picker lists them. */
export type MemberCandidate = Pick<Tables<"profiles">, "id" | "full_name" | "email">;

/** The active members a group can add, by name, at most 1000. */
export async function listAddableMembers(): Promise<MemberCandidate[]> {
  return must(await client().from("profiles").select("id,full_name,email").eq("status", "active").order("full_name").limit(1000)) || [];
}
