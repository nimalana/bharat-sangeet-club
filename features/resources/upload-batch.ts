// The steps of an upload batch that touch the library: making the folders a selection brings with it, and sending one file. The
// screen's hook (hooks/use-resource-uploads.ts) decides when to start, how many go at once and what the person is told; every
// row it adds or changes is handed back through `UploadSink`, so the list shows it at once.
//
// The order of one file is the order the library has always used: its row (pending_upload), then the file, then the row marked
// ready; a file that did not go up, or a row that could not be marked, is marked failed on the way out.
import {
  createImportedFolder, createPendingResourceFile, markResourceFailed, markResourceReady, resourcesAvailable, uploadResourceFile,
} from "../../lib/api/resources";
import type { ArchiveVisibility } from "../../lib/db";
import { ApiError } from "../../lib/errors";
import { mediaKindOf, splitRelativePath, storagePathOf } from "./model";
import type { ResourceItem, UploadEntry } from "./types";

export type UploadBatch = {
  userId: string;
  importId: string;
  /** The open folder: where the selection's top level goes. */
  folderId: number | null;
  destinationScope: number | null;
  visibility: ArchiveVisibility;
  /** The folders already made for this batch, by their path in the selection, so each is made once. */
  folderCache: Map<string, number>;
};

export type UploadSink = {
  addRow: (item: ResourceItem) => void;
  replaceRow: (id: number, change: (item: ResourceItem) => ResourceItem) => void;
};

// What the person is shown of a failure caught while uploading: the sentence of an Error. A database answer that is not an Error
// (PostgREST sends a plain object) is not shown, the caller's own sentence is. An ApiError remembers the raw answer as its `cause`.
export function shownMessage(error: unknown, fallback: string): string {
  const raw = error instanceof ApiError ? error.cause : error;
  return raw instanceof Error ? raw.message : fallback;
}

// Makes the folders of a path inside the selection (`Concert/Notes`), each once, and answers with the id of the last.
export async function ensureFolderPath(batch: UploadBatch, sink: UploadSink, path: string): Promise<number | null> {
  if (!resourcesAvailable()) throw new Error("Resource storage is unavailable");
  const segments = path.split("/").filter(Boolean);
  let parentId = batch.folderId;
  let parentPath = "";
  for (const segment of segments) {
    parentPath = parentPath ? `${parentPath}/${segment}` : segment;
    const existing = batch.folderCache.get(parentPath);
    if (existing) { parentId = existing; continue; }
    const created: ResourceItem | null = await createImportedFolder({ title: segment.slice(0, 160), description: "", parentId, subgroupId: batch.destinationScope, visibility: batch.visibility, importId: batch.importId, userId: batch.userId });
    if (!created) throw new Error(`Folder “${segment}” could not be created`);
    batch.folderCache.set(parentPath, created.id); sink.addRow(created); parentId = created.id;
  }
  return parentId;
}

// Sends one file of the batch. Throws what went wrong; the row is left marked failed when it got as far as having one.
export async function uploadOne(batch: UploadBatch, sink: UploadSink, entry: UploadEntry): Promise<void> {
  if (!resourcesAvailable()) throw new Error("Resource storage is unavailable");
  const { folders, fileName: named } = splitRelativePath(entry.relativePath);
  const fileName = named || entry.file.name;
  const parentId = await ensureFolderPath(batch, sink, folders.join("/"));
  const path = storagePathOf(batch.userId, batch.importId, folders, fileName);
  const mimeType = entry.file.type || "application/octet-stream";
  const pendingItem: ResourceItem | null = await createPendingResourceFile({ mediaKind: mediaKindOf(entry.file), title: fileName.slice(0, 160), description: "", parentId, subgroupId: batch.destinationScope, visibility: batch.visibility, storagePath: path, originalFilename: fileName, mimeType, byteSize: entry.file.size, importId: batch.importId, userId: batch.userId });
  if (!pendingItem) throw new Error("File record could not be created");
  sink.addRow(pendingItem);
  // The marks below are best effort: what the person is told is why the upload itself failed.
  const markFailed = async () => {
    await markResourceFailed(pendingItem.id).catch(() => undefined);
    sink.replaceRow(pendingItem.id, (item) => ({ ...item, status: "failed" }));
  };
  try { await uploadResourceFile(path, entry.file, mimeType); } catch (uploadError) {
    await markFailed();
    throw uploadError;
  }
  let ready: ResourceItem | null;
  try { ready = await markResourceReady(pendingItem.id); } catch (readyError) {
    await markFailed();
    throw readyError;
  }
  if (!ready) {
    await markFailed();
    throw new Error("File record could not be finalized");
  }
  const finished = ready;
  sink.replaceRow(pendingItem.id, () => finished);
}
