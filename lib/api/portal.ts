// What the portal shell itself reads and writes, that is not one area's own data: the bootstrap answer, the lists the
// shell keeps for every page (archive, events, announcements, resource count, groups and memberships) and the name a
// new member chose at sign-up.
//
// The reads hand back the answers as the database gave them ({ data, error }): the shell decides, list by list, what to
// keep and what to tell the person when one of them fails (a list that failed keeps what is shown).
import type { PostgrestError } from "@supabase/supabase-js";
import { ApiError } from "../errors";
import type { Announcement, ArchiveItem, ClubEvent, Subgroup, SubgroupMembership } from "../db";
import { supabase } from "../supabase";
import { upcomingEventsQuery } from "./events";

function client() {
  if (!supabase) throw new ApiError("Supabase is not configured");
  return supabase;
}

type ListAnswer<T> = { data: T[] | null; error: PostgrestError | null };

/** get_portal_bootstrap: the profile and everything the first screen needs, in one request. The answer is judged by lib/bootstrap.ts. */
export async function getPortalBootstrap() {
  return await client().rpc("get_portal_bootstrap");
}

/** The lists the shell reloads: the club's recordings, the calendar, the newest announcements and how many resources there are. */
export async function loadPortalLists() {
  const db = client();
  const [archive, events, announcements, resourceCount] = await Promise.all([
    db.from("archive_items").select("*").eq("type", "recording").order("created_at", { ascending: false }),
    upcomingEventsQuery(),
    db.from("announcements").select("*").order("is_pinned", { ascending: false }).order("published_at", { ascending: false }).limit(12),
    db.from("resources").select("id", { count: "exact", head: true }).neq("status", "archived"),
  ]);
  return { archive: archive as ListAnswer<ArchiveItem>, events: events as ListAnswer<ClubEvent>, announcements: announcements as ListAnswer<Announcement>, resourceCount };
}

/** The groups the portal lists (not archived) and this person's own memberships. */
export async function loadWorkspaceLists(userId: string) {
  const db = client();
  const [groups, memberships] = await Promise.all([
    db.from("subgroups").select("id,name,description,enrollment_mode,archived_at").is("archived_at", null).order("name"),
    db.from("subgroup_memberships").select("subgroup_id,member_id,status,membership_role").eq("member_id", userId),
  ]);
  return { groups: groups as ListAnswer<Subgroup>, memberships: memberships as ListAnswer<SubgroupMembership> };
}

/** Saves the name a new member typed on the sign-in screen as their profile name. */
export async function updateOwnFullName(userId: string, fullName: string) {
  return await client().from("profiles").update({ full_name: fullName }).eq("id", userId);
}
