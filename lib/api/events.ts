// The events table: what the calendar reads, adds, changes and removes.
//
// The writes hand back the answer as the database gave it ({ data, error }), because the screen branches on both: an
// update that matches no row returns no error and no rows, which is a failure the person must be told about.
import { ApiError } from "../errors";
import { supabase } from "../supabase";

function client() {
  if (!supabase) throw new ApiError("Supabase is not configured");
  return supabase;
}

/** What the form of an important date writes. */
export type EventFields = { title: string; description: string; starts_at: string; location: string; subgroup_id: number | null };

/**
 * The shell's read of the calendar: dates from a year ago onwards, soonest first. This returns the query itself, not yet
 * sent (awaiting it sends it), so that the caller's Promise.all starts its requests in the order it lists them.
 */
export function upcomingEventsQuery() {
  return client().from("events").select("*").gte("starts_at", new Date(Date.now() - 365 * 86400000).toISOString()).order("starts_at", { ascending: true });
}

/** Adds a date; `created_by` is the person adding it. The answer lists the id of the row written. */
export async function createEvent(fields: EventFields, createdBy: string) {
  return await client().from("events").insert({ ...fields, created_by: createdBy }).select("id");
}

/** Changes a date. The answer lists the ids of the rows changed: none when the date was removed meanwhile. */
export async function updateEvent(eventId: number, fields: EventFields) {
  return await client().from("events").update(fields).eq("id", eventId).select("id");
}

/** Removes a date. */
export async function deleteEvent(eventId: number) {
  return await client().from("events").delete().eq("id", eventId);
}
