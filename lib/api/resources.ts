// Every Supabase call the resource library makes (features/resources): the folder and file rows (`resources`), the upload batches
// (`resource_imports`), the `club-resources` bucket (signed links, uploads, removes) and the three functions that change a row's
// visibility or archive state. The planner that decides WHAT a list asks for is lib/resources-query.ts (pure, no Supabase); this
// module is what runs it.
//
// Plain async functions: no React, no toast, no sentence for the person. A database or storage error is thrown as an ApiError that
// keeps the message and code (lib/errors.ts), so `friendlyError(error, fallback)` at the call site says what it said about the raw
// error. The order of the calls of one operation (a file row first, then the file, then the row marked ready) is the caller's: the
// screen shows each step as it happens, so it stays where the steps are shown (features/resources/upload-batch.ts).
import type { ArchiveVisibility, ResourceMediaKind, Tables, TablesUpdate } from "../db";
import { ApiError, toApiError } from "../errors";
import { THUMBNAIL_TTL_SECONDS, applyListPlan, type ListPlan } from "../resources-query";
import { removeStoredFile } from "../storage";
import { supabase } from "../supabase";
import { must, uploadWithProgress, type UploadProgress as BytesSent } from "./_core";

// Every column of a library row but `metadata`.
export const RESOURCE_FIELDS = "id,node_kind,media_kind,title,description,parent_id,subgroup_id,visibility,storage_bucket,storage_path,external_url,original_filename,mime_type,byte_size,checksum_sha256,event_id,occurred_on,season_label,status,is_pinned,import_id,created_by,created_at,updated_at";

/** A library row as RESOURCE_FIELDS reads it. */
export type ResourceRow = Omit<Tables<"resources">, "metadata">;

/** The bucket every uploaded library file goes to. */
const RESOURCE_BUCKET = "club-resources";

/** False when the portal has no Supabase configuration: the library says so and does nothing, as it always did. */
export const resourcesAvailable = (): boolean => supabase !== null;

function client() {
  if (!supabase) throw new ApiError("Resource storage is unavailable");
  return supabase;
}

// ------------------------------------------------------------------------------------------------ reads

/** One row by id; null when it does not exist or cannot be read. */
export async function fetchResource(id: number): Promise<ResourceRow | null> {
  return must(await client().from("resources").select(RESOURCE_FIELDS).eq("id", id).maybeSingle());
}

/** The ids of the folders directly under `parentIds` that are not archived (one level of a subtree). */
export async function listChildFolderIds(parentIds: number[]): Promise<number[]> {
  const rows = must(await client().from("resources").select("id").eq("node_kind", "folder").neq("status", "archived").in("parent_id", parentIds));
  return (rows || []).map((row) => row.id);
}

/** One page of a planned list (lib/resources-query.ts buildListPlan). The exact total is only asked for with the first page. */
export async function listResourcesPage(plan: ListPlan, withCount: boolean): Promise<{ rows: ResourceRow[]; count: number | null }> {
  const answer = await applyListPlan(client().from("resources").select(RESOURCE_FIELDS, { count: withCount ? "exact" : undefined }), plan);
  if (answer.error) throw toApiError(answer.error, answer.status);
  return { rows: (answer.data || []) as ResourceRow[], count: answer.count ?? null };
}

/** Which of `ids` are archived, from the status of each. */
export async function listArchivedAmong(ids: number[]): Promise<number[]> {
  const rows = must(await client().from("resources").select("id,status").in("id", ids));
  return (rows || []).filter((row) => row.status === "archived").map((row) => row.id);
}

/** How many items are archived (head request, no rows). Null when the server sends no count. */
export async function countArchivedResources(): Promise<number | null> {
  const answer = await client().from("resources").select("id", { count: "exact", head: true }).eq("status", "archived");
  if (answer.error) throw toApiError(answer.error, answer.status);
  return answer.count;
}

/** How many items are live, that is not archived (head request, no rows). Null when the server sends no count. */
export async function countLiveResources(): Promise<number | null> {
  const answer = await client().from("resources").select("id", { count: "exact", head: true }).neq("status", "archived");
  if (answer.error) throw toApiError(answer.error, answer.status);
  return answer.count;
}

/** How many items sit directly in a folder (head request, no rows). */
export async function countFolderChildren(folderId: number): Promise<number | null> {
  const answer = await client().from("resources").select("id", { count: "exact", head: true }).eq("parent_id", folderId);
  if (answer.error) throw toApiError(answer.error, answer.status);
  return answer.count;
}

// ---------------------------------------------------------------------------------- the club-resources bucket

/**
 * Signed links for the pictures on screen, one request for the paths of one bucket. A failed request gives no links (a
 * thumbnail is only a nicety), it is not an error.
 */
export async function signResourceThumbnails(bucket: string, paths: string[]): Promise<Array<{ path: string | null; signedUrl: string | null }>> {
  const signed = await client().storage.from(bucket).createSignedUrls(paths, THUMBNAIL_TTL_SECONDS);
  return signed.data || [];
}

/** A link that opens one file for five minutes; null when none could be made. */
export async function signResourceFile(bucket: string, path: string): Promise<string | null> {
  const signed = await client().storage.from(bucket).createSignedUrl(path, 300);
  return signed.data?.signedUrl ?? null;
}

/**
 * Puts a file in the library's bucket under `path`. It never replaces a file that is already there. `onProgress` is told how many
 * bytes have left (uploadWithProgress: the request supabase-js sends, through XMLHttpRequest, which can say so).
 *
 * `contentType` is the type the storage object is stored with, and now it is the one that is sent. supabase-js ignored this option
 * for a File (the file part carries the file's own type), so the old call stored what the browser said. The same request goes now,
 * and when the file has no type of its own (a score such as .mxl or .musicxml) it is sent as `contentType` says
 * (application/octet-stream, what a browser writes for such a part anyway, and what the bucket accepts for scores).
 */
export async function uploadResourceFile(path: string, file: File, contentType: string, onProgress?: (progress: BytesSent) => void): Promise<void> {
  const sent = file.type === contentType ? file : new File([file], file.name, { type: contentType });
  const uploaded = await uploadWithProgress(client(), "club-resources", path, sent, { upsert: false }, onProgress);
  if (uploaded.error) throw storageRefusal(uploaded.error);
}

// A refusal of storage is shown to the person word for word (features/resources/upload-batch.ts `shownMessage` shows the message of an
// Error that an ApiError carries as its cause, and a database answer, which is a plain object, is never shown). storage-js made its
// error an Error; the upload request answers with the parsed body, so the sentence rides on an Error here as it did.
function storageRefusal(error: ApiError): ApiError {
  return new ApiError(error.message, { code: error.code, status: error.status, cause: Object.assign(new Error(error.message), { status: error.status }) });
}

/**
 * Deletes a stored file and answers null when it is gone, or the sentence that says why it is still there (lib/storage.ts).
 * An empty answer from storage is a refused delete, not a success, so it also checks that the file can no longer be signed.
 */
export async function removeResourceFile(bucket: string, path: string): Promise<string | null> {
  return removeStoredFile(bucket, path, { confirmGone: true });
}

// ------------------------------------------------------------------------------------------------ creating

type NewNode = {
  title: string;
  description: string;
  parentId: number | null;
  subgroupId: number | null;
  visibility: ArchiveVisibility;
  userId: string;
};

/** A folder made from the "Create folder" form. Null when the database sent no row back. */
export async function createResourceFolder(folder: NewNode): Promise<ResourceRow | null> {
  return must(await client().from("resources").insert({ node_kind: "folder", media_kind: null, title: folder.title, description: folder.description, parent_id: folder.parentId, subgroup_id: folder.subgroupId, visibility: folder.visibility, status: "ready", is_pinned: false, created_by: folder.userId }).select(RESOURCE_FIELDS).single());
}

/** A link made from the "Add link" form. Null when the database sent no row back. */
export async function createResourceLink(link: NewNode & { externalUrl: string }): Promise<ResourceRow | null> {
  return must(await client().from("resources").insert({ node_kind: "link", media_kind: null, title: link.title, description: link.description, parent_id: link.parentId, subgroup_id: link.subgroupId, visibility: link.visibility, external_url: link.externalUrl, status: "ready", is_pinned: false, created_by: link.userId }).select(RESOURCE_FIELDS).single());
}

/** A folder made while uploading a folder, tagged with the upload batch. Null when the database sent no row back. */
export async function createImportedFolder(folder: NewNode & { importId: string }): Promise<ResourceRow | null> {
  return must(await client().from("resources").insert({ node_kind: "folder", media_kind: null, title: folder.title, description: folder.description, parent_id: folder.parentId, subgroup_id: folder.subgroupId, visibility: folder.visibility, status: "ready", is_pinned: false, import_id: folder.importId, created_by: folder.userId }).select(RESOURCE_FIELDS).single());
}

export type PendingFile = NewNode & {
  mediaKind: ResourceMediaKind;
  storagePath: string;
  originalFilename: string;
  mimeType: string;
  byteSize: number;
  importId: string;
};

/** The row of a file that is about to be uploaded (status pending_upload). Null when the database sent no row back. */
export async function createPendingResourceFile(file: PendingFile): Promise<ResourceRow | null> {
  return must(await client().from("resources").insert({ node_kind: "file", media_kind: file.mediaKind, title: file.title, description: file.description, parent_id: file.parentId, subgroup_id: file.subgroupId, visibility: file.visibility, storage_bucket: RESOURCE_BUCKET, storage_path: file.storagePath, original_filename: file.originalFilename, mime_type: file.mimeType, byte_size: file.byteSize, status: "pending_upload", is_pinned: false, import_id: file.importId, created_by: file.userId }).select(RESOURCE_FIELDS).single());
}

/** Marks an uploaded file's row ready and answers with it. Null when the database sent no row back. */
export async function markResourceReady(id: number): Promise<ResourceRow | null> {
  return must(await client().from("resources").update({ status: "ready", updated_at: new Date().toISOString() }).eq("id", id).select(RESOURCE_FIELDS).single());
}

/** Marks a file's row failed (the upload did not complete). */
export async function markResourceFailed(id: number): Promise<void> {
  must(await client().from("resources").update({ status: "failed" }).eq("id", id));
}

// ----------------------------------------------------------------------------------------- upload batches

/** Records an upload batch before any file of it is sent. Null when the database sent no row back. */
export async function createResourceImport(batch: {
  name: string; rootParentId: number | null; subgroupId: number | null; visibility: ArchiveVisibility; totalFiles: number; totalBytes: number; userId: string;
}): Promise<{ id: string } | null> {
  return must(await client().from("resource_imports").insert({ name: batch.name, root_parent_id: batch.rootParentId, subgroup_id: batch.subgroupId, visibility: batch.visibility, status: "uploading", total_files: batch.totalFiles, completed_files: 0, failed_files: 0, total_bytes: batch.totalBytes, uploaded_bytes: 0, created_by: batch.userId }).select("id").single());
}

/** Closes a batch that never got as far as uploading a file (its folders could not be made). */
export async function failResourceImport(importId: string, failedFiles: number): Promise<void> {
  must(await client().from("resource_imports").update({ status: "failed", failed_files: failedFiles }).eq("id", importId));
}

/** Closes a batch with what came of it. */
export async function finishResourceImport(importId: string, result: { completedFiles: number; failedFiles: number; uploadedBytes: number; status: "completed" | "partial" | "failed" }): Promise<void> {
  must(await client().from("resource_imports").update({ completed_files: result.completedFiles, failed_files: result.failedFiles, uploaded_bytes: result.uploadedBytes, status: result.status }).eq("id", importId));
}

// ------------------------------------------------------------------------------- changing one item

/**
 * Renames or edits one item and answers with the rows it changed. An update that matches no row (row-level security hides it,
 * or it was deleted) is not an error for the database: it answers with an empty list, and the caller must treat that as a failure.
 */
export async function updateResourceDetails(id: number, details: { title: string; description: string; external_url?: string }): Promise<Array<{ id: number }>> {
  const changes: TablesUpdate<"resources"> = { title: details.title, description: details.description };
  if (details.external_url !== undefined) changes.external_url = details.external_url;
  return must(await client().from("resources").update(changes).eq("id", id).select("id")) ?? [];
}

/** Pins or unpins one item. Answers with the rows it changed (an empty list means nothing was written). */
export async function setResourcePinned(id: number, pinned: boolean): Promise<Array<{ id: number }>> {
  return must(await client().from("resources").update({ is_pinned: pinned }).eq("id", id).select("id")) ?? [];
}

/** Limits an item to executives, or shares it with members. The database applies it to everything inside a folder. */
export async function setResourceVisibility(id: number, visibility: ArchiveVisibility): Promise<void> {
  must(await client().rpc("set_resource_visibility", { p_resource_id: id, p_visibility: visibility }));
}

/** Archives an item (and everything inside a folder), or restores it. */
export async function setResourceArchived(id: number, archived: boolean): Promise<void> {
  must(await client().rpc("set_resource_archived", { p_resource_id: id, p_archived: archived }));
}

/** Deletes one row for good and answers with the rows it deleted (an empty list means nothing was deleted). */
export async function deleteResource(id: number): Promise<Array<{ id: number }>> {
  return must(await client().from("resources").delete().eq("id", id).select("id")) ?? [];
}
