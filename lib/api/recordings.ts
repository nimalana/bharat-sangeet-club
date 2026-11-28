// Every call the recordings screens make to Supabase: the recordings list (filtered and paged on the server), a recording's
// notation, the files in the `recordings` and `recording-notations` buckets (under the person's own folder), and the club
// archive (the older recordings that feed the public concert page, in the `club-archive` bucket). Plain async functions: no
// React, no toast, no sentences. A database or storage error is thrown as an ApiError; the screen turns it into the sentence
// the person sees. The order of operations that spans several files and rows (upload the take, save the row, upload the
// notation, save the note, clean up what no row refers to) is the caller's: it needs to know how far a save got.
//
// The table, function and bucket names stay literal here because the contract check (scripts/contract-check) reads them.
import { ApiError, toApiError } from "../errors";
import type { ArchiveVisibility, Tables, TablesUpdate } from "../db";
import { removeStoredFile } from "../storage";
import type { RemoveOptions } from "../storage-remove";
import { supabase } from "../supabase";
import { must } from "./_core";

function db() {
  if (!supabase) throw new ApiError("The portal is not connected.");
  return supabase;
}

const safeFileName = (file: File) => file.name.replace(/[^a-zA-Z0-9._-]/g, "-");

/** The bucket a recording's take is in: its own `storage_bucket` (a copy that still plays from the club archive) or `recordings`. */
export const recordingBucket = (recording: { storage_bucket?: string }) => recording.storage_bucket || "recordings";

// ---------------------------------------------------------------- the list

export const RECORDINGS_PAGE_SIZE = 24;

export type RecordingsView = "published" | "drafts" | "archived";
export type RecordingsQuery = {
  view: RecordingsView;
  /** "all", or one group. */
  scope: "all" | number;
  /** Already trimmed; empty means no search. */
  search: string;
  /** How many pages of RECORDINGS_PAGE_SIZE to return, from the first. */
  pages: number;
  userId: string;
  canManage: boolean;
};

/** One server-filtered, newest-first list of the first `pages` pages, with the exact number of matches. */
export async function listRecordings(query: RecordingsQuery): Promise<{ rows: Tables<"recordings">[]; total: number }> {
  const client = db();
  let request = client.from("recordings").select("*", { count: "exact" });
  if (query.view === "drafts") request = request.eq("status", "draft").eq("uploaded_by", query.userId);
  else if (query.view === "archived") { request = request.eq("status", "archived"); if (!query.canManage) request = request.eq("uploaded_by", query.userId); }
  else request = request.eq("status", "published");
  if (query.scope !== "all") request = request.eq("subgroup_id", query.scope);
  // Characters with a meaning in the filter syntax are dropped from the search text.
  const term = query.search.replace(/[,()%*\\]/g, " ").trim();
  if (term) request = request.or(["title", "description", "raga", "tala", "recording_kind"].map((column) => `${column}.ilike.%${term}%`).join(","));
  const answer = await request.order("created_at", { ascending: false }).order("id", { ascending: false }).range(0, RECORDINGS_PAGE_SIZE * query.pages - 1);
  const rows = must(answer) ?? [];
  return { rows, total: answer.count ?? rows.length };
}

// ---------------------------------------------------------------- one recording

export async function listRecordingNotes(recordingId: number): Promise<Tables<"recording_notes">[]> {
  const client = db();
  return must(await client.from("recording_notes").select("*").eq("recording_id", recordingId).order("created_at")) ?? [];
}

/** A link that plays the take for 30 minutes, or null when storage gave none. `bucket` is `recordingBucket(recording)`. */
export async function createRecordingUrl(bucket: string, path: string): Promise<string | null> {
  const client = db();
  const { data, error } = await client.storage.from(bucket).createSignedUrl(path, 1800);
  if (error) throw toApiError(error);
  return data?.signedUrl ?? null;
}

/** A link that opens a notation file for 15 minutes, or null when storage gave none. */
export async function createNotationUrl(path: string): Promise<string | null> {
  const client = db();
  const { data, error } = await client.storage.from("recording-notations").createSignedUrl(path, 900);
  if (error) throw toApiError(error);
  return data?.signedUrl ?? null;
}

// ---------------------------------------------------------------- saving from the studio

/** Uploads a take under the person's folder and the group's; resolves to the stored path. */
export async function uploadRecordingTake(userId: string, groupId: number, file: File): Promise<string> {
  const client = db();
  const path = `${userId}/subgroups/${groupId}/${crypto.randomUUID()}-${safeFileName(file)}`;
  const upload = await client.storage.from("recordings").upload(path, file, { contentType: file.type, upsert: false });
  if (upload.error) throw toApiError(upload.error);
  return path;
}

/** The columns a save writes, the same for a new recording and for a draft that is being finished. */
export type RecordingPayload = {
  title: string; description: string; subgroup_id: number; storage_path: string; mime_type: string; media_kind: "audio" | "video";
  status: "draft" | "published"; audience: "subgroup"; recording_kind: string; raga: string | null; tala: string | null; sruthi: string | null;
  tempo: string | null; duration_seconds: number | null; published_at: string | null; updated_at: string;
};

const recordingColumns = (payload: RecordingPayload) => ({
  title: payload.title, description: payload.description, subgroup_id: payload.subgroup_id, storage_path: payload.storage_path, mime_type: payload.mime_type,
  media_kind: payload.media_kind, status: payload.status, audience: payload.audience, recording_kind: payload.recording_kind, raga: payload.raga, tala: payload.tala,
  sruthi: payload.sruthi, tempo: payload.tempo, duration_seconds: payload.duration_seconds, published_at: payload.published_at, updated_at: payload.updated_at,
});

/** Saves a draft that is being finished (published or kept as a draft again). */
export async function updateRecording(id: number, payload: RecordingPayload): Promise<void> {
  const client = db();
  must(await client.from("recordings").update(recordingColumns(payload)).eq("id", id));
}

/** Saves a new recording; resolves to its id. */
export async function insertRecording(payload: RecordingPayload, uploadedBy: string): Promise<number> {
  const client = db();
  return must(await client.from("recordings").insert({ ...recordingColumns(payload), uploaded_by: uploadedBy }).select("id").single()).id;
}

/** Uploads a notation file under the person's folder; resolves to the stored path. */
export async function uploadNotationFile(userId: string, file: File): Promise<string> {
  const client = db();
  const path = `${userId}/${crypto.randomUUID()}-${safeFileName(file)}`;
  const upload = await client.storage.from("recording-notations").upload(path, file, { contentType: file.type, upsert: false });
  if (upload.error) throw toApiError(upload.error);
  return path;
}

export type NewRecordingNote = { recordingId: number; title: string; noteType: "text" | "file"; body: string; storagePath: string | null; mimeType: string | null; uploadedBy: string };

export async function insertRecordingNote(note: NewRecordingNote): Promise<void> {
  const client = db();
  must(await client.from("recording_notes").insert({
    recording_id: note.recordingId, title: note.title, note_type: note.noteType, body: note.body, storage_path: note.storagePath, mime_type: note.mimeType, uploaded_by: note.uploadedBy,
  }));
}

/**
 * Removes a take that no recording row refers to (the row could not be saved). Resolves to null when it is gone, or to the
 * sentence that says why it is still stored. A refused delete is not an empty success (lib/storage-remove.ts).
 */
export function removeAbandonedTake(path: string): Promise<string | null> {
  return removeStoredFile("recordings", path);
}

/** Like removeAbandonedTake, for a notation file whose note could not be saved. */
export function removeAbandonedNotationFile(path: string): Promise<string | null> {
  return removeStoredFile("recording-notations", path);
}

// ---------------------------------------------------------------- managing a recording and its notation

export type RecordingDetails = { title: string; description: string; recording_kind: string; raga: string | null; tala: string | null; sruthi: string | null; tempo: string | null };

/** The rows the update changed: none when a policy hid the recording from this person. */
export async function updateRecordingDetails(id: number, details: RecordingDetails): Promise<{ id: number }[] | null> {
  const client = db();
  return must(await client.from("recordings").update({
    title: details.title, description: details.description, recording_kind: details.recording_kind,
    raga: details.raga, tala: details.tala, sruthi: details.sruthi, tempo: details.tempo,
  }).eq("id", id).select("id"));
}

export async function setRecordingStatus(id: number, status: "archived" | "published"): Promise<{ id: number }[] | null> {
  const client = db();
  return must(await client.from("recordings").update({ status }).eq("id", id).select("id"));
}

/** Deletes the row (its notes go with it). Delete the files first: storage only lets a file go while its row exists. */
export async function deleteRecordingRow(id: number): Promise<{ id: number }[] | null> {
  const client = db();
  return must(await client.from("recordings").delete().eq("id", id).select("id"));
}

/**
 * Deletes a stored take or notation file and resolves to null when it is gone, or to the sentence that says why it is not. An
 * empty answer from storage counts as a failure unless the file can no longer be signed (a retry after a partly finished delete).
 */
export function removeRecordingTake(path: string): Promise<string | null> {
  return removeStoredFile("recordings", path, { confirmGone: true });
}

export function removeNotationFile(path: string): Promise<string | null> {
  return removeStoredFile("recording-notations", path, { confirmGone: true });
}

/** A text note changes its title and body; a file note only its title (`body` left out). */
export async function updateRecordingNote(id: number, changes: { title: string; body?: string }): Promise<{ id: number }[] | null> {
  const client = db();
  const columns: TablesUpdate<"recording_notes"> = { title: changes.title };
  if (changes.body !== undefined) columns.body = changes.body;
  return must(await client.from("recording_notes").update(columns).eq("id", id).select("id"));
}

export async function deleteRecordingNote(id: number): Promise<{ id: number }[] | null> {
  const client = db();
  return must(await client.from("recording_notes").delete().eq("id", id).select("id"));
}

// ---------------------------------------------------------------- the club archive

/** True when a group's recording room plays the same file (a copy of a club recording points at the same object). */
export async function isInRecordingRoom(storagePath: string): Promise<boolean> {
  const client = db();
  const rows = must(await client.from("recordings").select("id").eq("storage_path", storagePath).limit(1));
  return Boolean(rows?.length);
}

/** A link that opens a club recording for 5 minutes, or null when storage gave none. */
export async function createClubArchiveUrl(path: string): Promise<string | null> {
  const client = db();
  const { data, error } = await client.storage.from("club-archive").createSignedUrl(path, 300);
  if (error) throw toApiError(error);
  return data?.signedUrl ?? null;
}

export type ClubArchiveChanges = {
  title: string; description: string; raga: string | null; tala: string | null; event_date: string | null;
  visibility: "members" | "executives"; is_public: boolean;
};

export async function updateClubArchiveItem(id: number, changes: ClubArchiveChanges): Promise<{ id: number }[] | null> {
  const client = db();
  return must(await client.from("archive_items").update({
    title: changes.title, description: changes.description, raga: changes.raga, tala: changes.tala, event_date: changes.event_date,
    visibility: changes.visibility, is_public: changes.is_public,
  }).eq("id", id).select("id"));
}

export async function deleteClubArchiveItem(id: number): Promise<{ id: number }[] | null> {
  const client = db();
  return must(await client.from("archive_items").delete().eq("id", id).select("id"));
}

/**
 * Deletes a club recording's file and resolves to null when it is gone, or to the sentence that says why it is not.
 * `options` is passed on to the storage helper: `{ confirmGone: true }` for a delete the person asked for (as
 * removeRecordingTake), `{ refusedMessage }` for the clean-up after a failed save, which says what to tell the person when
 * the file stays.
 */
export function removeClubArchiveFile(path: string, options: Pick<RemoveOptions, "confirmGone" | "refusedMessage" | "failedMessage">): Promise<string | null> {
  return removeStoredFile("club-archive", path, options);
}

/** Uploads a club recording under the person's folder; resolves to the stored path. */
export async function uploadClubArchiveFile(userId: string, file: File): Promise<string> {
  const client = db();
  const path = `${userId}/${crypto.randomUUID()}-${safeFileName(file)}`;
  const upload = await client.storage.from("club-archive").upload(path, file, { upsert: false });
  if (upload.error) throw toApiError(upload.error);
  return path;
}

export type NewClubArchiveItem = {
  title: string;
  description: string;
  storagePath: string;
  visibility: ArchiveVisibility;
  isPublic: boolean;
  raga: string | null;
  tala: string | null;
  uploadedBy: string;
};

/** Adds the row that points at a file just uploaded. */
export async function insertClubArchiveItem(item: NewClubArchiveItem): Promise<void> {
  const client = db();
  must(await client.from("archive_items").insert({ title: item.title, description: item.description, type: "recording", storage_path: item.storagePath, visibility: item.visibility, is_public: item.isPublic, raga: item.raga, tala: item.tala, uploaded_by: item.uploadedBy }));
}
