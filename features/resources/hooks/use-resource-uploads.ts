// Uploading files and folders from the add-resource panel: the chosen files and how far each got, and the batch itself. Up to three
// files go at once; the folders a selection brings are made first so that two files never race to make the same one. The batch is
// recorded before anything else is created, and closed with what came of it.
import { useState, type ChangeEvent, type Dispatch, type SetStateAction } from "react";
import { createResourceImport, failResourceImport, finishResourceImport, resourcesAvailable } from "../../../lib/api/resources";
import type { ArchiveVisibility } from "../../../lib/db";
import { ApiError, toApiError } from "../../../lib/errors";
import { useToast } from "../../../components/ui/toast";
import { deepestFolderLevel, splitRelativePath, tooDeepMessage, uploadBatchName, uploadBatchStatus, uploadFailedSentence, uploadToastMessage } from "../model";
import { ensureFolderPath, shownMessage, uploadOne, type UploadBatch } from "../upload-batch";
import type { ComposerMode, ResourceItem, UploadEntry, Visibility } from "../types";

export type ResourceUploadsOptions = {
  userId: string;
  folderId: number | null;
  /** How many folder levels the open folder is already inside. */
  folderDepth: number;
  destinationScope: number | null;
  currentFolderVisibility: ArchiveVisibility | undefined;
  canManageClub: boolean;
  canWriteScope: (subgroupId: number | null) => boolean;
  addRow: (item: ResourceItem) => void;
  replaceRow: (id: number, change: (item: ResourceItem) => ResourceItem) => void;
  refreshAll: () => void;
  setComposer: Dispatch<SetStateAction<ComposerMode>>;
  setComposerError: Dispatch<SetStateAction<string>>;
};

export function useResourceUploads({ userId, folderId, folderDepth, destinationScope, currentFolderVisibility, canManageClub, canWriteScope, addRow, replaceRow, refreshAll, setComposer, setComposerError }: ResourceUploadsOptions) {
  const { notify } = useToast();
  const [uploadEntries, setUploadEntries] = useState<UploadEntry[]>([]);
  const [uploadMode, setUploadMode] = useState<"files" | "folder-upload">("files");
  const [uploadVisibility, setUploadVisibility] = useState<Visibility>("members");
  const [uploadTotal, setUploadTotal] = useState(0);
  const [uploadDone, setUploadDone] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [failedUploadCount, setFailedUploadCount] = useState(0);

  // A folder keeps the visibility it was made with; at the top it is the person's choice (only an executive may choose).
  const uploadDestinationVisibility = currentFolderVisibility || (canManageClub ? uploadVisibility : "members");

  // The panel opens on the files or the folder choice: nothing is chosen yet.
  function chooseMode(mode: "files" | "folder-upload") { setUploadMode(mode); setUploadEntries([]); }
  function clearEntries() { setUploadEntries([]); }

  function handleFileSelection(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || []);
    const folderInput = uploadMode === "folder-upload";
    if (!files.length) return;
    setUploadEntries(files.map((file) => ({ file, relativePath: folderInput ? ((file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name) : file.name, state: "queued" })));
    setUploadTotal(files.length); setUploadDone(0); setFailedUploadCount(0);
    event.target.value = "";
  }

  async function startUploads(entriesToUpload = uploadEntries) {
    if (!entriesToUpload.length || uploading || !canWriteScope(destinationScope)) return;
    const tooDeep = tooDeepMessage(folderDepth, deepestFolderLevel(entriesToUpload.map((entry) => entry.relativePath)));
    if (tooDeep) { setComposerError(tooDeep); return; }
    setUploading(true); setComposerError("");
    if (!resourcesAvailable()) { setUploading(false); setComposerError("Resource storage is not configured in this environment."); return; }
    let importRecord: { id: string } | null = null;
    let importError: ApiError | null = null;
    try { importRecord = await createResourceImport({ name: uploadBatchName(entriesToUpload.map((entry) => entry.file)), rootParentId: folderId, subgroupId: destinationScope, visibility: uploadDestinationVisibility, totalFiles: entriesToUpload.length, totalBytes: entriesToUpload.reduce((total, entry) => total + entry.file.size, 0), userId }); } catch (caught) { importError = toApiError(caught); }
    if (importError || !importRecord) { setUploading(false); setComposerError(importError?.message || "The upload batch could not be started."); return; }
    const importId = String(importRecord.id);
    const batch: UploadBatch = { userId, importId, folderId, destinationScope, visibility: uploadDestinationVisibility, folderCache: new Map<string, number>() };
    const sink = { addRow, replaceRow };
    try {
      // Resolve the complete tree before workers start so concurrent files
      // never race to create the same relative folder.
      for (const entry of entriesToUpload) await ensureFolderPath(batch, sink, splitRelativePath(entry.relativePath).folders.join("/"));
    } catch (error) {
      await failResourceImport(importId, entriesToUpload.length).catch(() => undefined);
      setUploading(false);
      setComposerError(shownMessage(error, "The folder structure could not be created."));
      return;
    }
    let next = 0; let processed = 0; let completed = 0; let failed = 0; let uploadedBytes = 0;
    const entries = [...entriesToUpload];
    const worker = async () => {
      while (next < entries.length) {
        const index = next++;
        setUploadEntries((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, state: "uploading" } : entry));
        try { await uploadOne(batch, sink, entries[index]); completed += 1; uploadedBytes += entries[index].file.size; setUploadEntries((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, state: "ready" } : entry)); }
        catch (error) { failed += 1; const message = shownMessage(error, "Upload failed"); setUploadEntries((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, state: "failed", error: message } : entry)); }
        processed += 1; setUploadDone(processed); setFailedUploadCount(failed);
      }
    };
    await Promise.all(Array.from({ length: Math.min(3, entries.length) }, () => worker()));
    await finishResourceImport(importId, { completedFiles: completed, failedFiles: failed, uploadedBytes, status: uploadBatchStatus(completed, failed) }).catch(() => undefined);
    setUploading(false);
    refreshAll();
    if (failed) { setComposerError(uploadFailedSentence(failed)); notify(uploadToastMessage(completed, failed), "error"); }
    else { notify(uploadToastMessage(completed, failed)); setComposer(null); setUploadEntries([]); }
  }

  async function retryFailedUploads() {
    const failedEntries = uploadEntries.filter((entry) => entry.state === "failed");
    if (!failedEntries.length) return;
    const retryEntries = failedEntries.map((entry) => ({ ...entry, state: "queued" as const, error: undefined }));
    setUploadEntries(retryEntries);
    setUploadTotal(failedEntries.length); setUploadDone(0); setFailedUploadCount(0);
    await startUploads(retryEntries);
  }

  return {
    uploadEntries, uploadMode, uploadVisibility, setUploadVisibility, uploadTotal, uploadDone, uploading, failedUploadCount,
    chooseMode, clearEntries, handleFileSelection, startUploads, retryFailedUploads,
  };
}
