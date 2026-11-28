// Every Supabase call the announcement controls make (features/announcements): create, edit, pin and delete one announcement.
//
// Plain async functions: no React, no toast, no sentence for the person. A database error is thrown as an ApiError that keeps the
// database's message and code (lib/errors.ts), so `friendlyError(error, fallback)` at the call site says what it said about the raw
// error. Row-level security lets executives and admins write announcements; the database enforces it either way.
import { ApiError } from "../errors";
import { supabase } from "../supabase";
import { must } from "./_core";

export type AnnouncementFields = { title: string; body: string; is_pinned: boolean; subgroup_id: number | null };

/** False when the portal has no Supabase configuration: the controls do nothing then, as they always did. */
export const announcementsAvailable = (): boolean => supabase !== null;

function client() {
  if (!supabase) throw new ApiError("The portal is not connected.");
  return supabase;
}

/**
 * Saves the edited fields of an announcement and answers with the rows it changed. An update that matches no row (the
 * announcement was deleted, or row-level security hides it) is not an error for the database: it answers with an empty
 * list, and the caller must treat that as a failure.
 */
export async function updateAnnouncement(id: number, fields: AnnouncementFields): Promise<Array<{ id: number }>> {
  return must(await client().from("announcements").update({ title: fields.title, body: fields.body, is_pinned: fields.is_pinned, subgroup_id: fields.subgroup_id }).eq("id", id).select("id")) ?? [];
}

/** Publishes an announcement for `userId` and answers with the rows it created (an empty list means nothing was written). */
export async function createAnnouncement(fields: AnnouncementFields, userId: string): Promise<Array<{ id: number }>> {
  return must(await client().from("announcements").insert({ title: fields.title, body: fields.body, is_pinned: fields.is_pinned, subgroup_id: fields.subgroup_id, created_by: userId }).select("id")) ?? [];
}

export async function setAnnouncementPinned(id: number, pinned: boolean): Promise<void> {
  must(await client().from("announcements").update({ is_pinned: pinned }).eq("id", id));
}

export async function deleteAnnouncement(id: number): Promise<void> {
  must(await client().from("announcements").delete().eq("id", id));
}
