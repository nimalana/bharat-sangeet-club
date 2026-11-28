"use client";

import { useRef } from "react";
import { UploadProgress, type UploadItem } from "../../../components/ui/upload-progress";
import { useResourceUploads } from "../hooks/use-resource-uploads";
import type { UploadEntry } from "../types";
import { ResourceIcon } from "./resource-icon";
import styles from "./resources.module.css";

// What each file of the batch shows: waiting, its bar while its bytes are on the way, saving, uploaded, or why it failed (UploadProgress).
const ROW_STATUS: Record<UploadEntry["state"], UploadItem["status"]> = { queued: "waiting", uploading: "uploading", ready: "done", failed: "failed" };
const rowsOf = (entries: UploadEntry[]): UploadItem[] => entries.map((entry, index) => ({ id: String(index), name: entry.relativePath, status: ROW_STATUS[entry.state], loaded: entry.loaded, total: entry.total, error: entry.error }));

// The upload branch of the add-resource panel: who may see the files, the picker (files, or a whole folder), how far each file got,
// and the buttons that start the batch, reset the failed files or leave.
export function ResourceUploadPanel({ mode, uploads, hasOpenFolder, canManageClub, onClose }: {
  mode: "files" | "folder-upload";
  uploads: ReturnType<typeof useResourceUploads>;
  /** A folder is open: what goes in it takes the folder's visibility, so there is nothing to choose. */
  hasOpenFolder: boolean;
  canManageClub: boolean;
  onClose: () => void;
}) {
  const { uploadEntries, uploadVisibility, setUploadVisibility, uploadTotal, uploadDone, uploading, failedUploadCount, handleFileSelection, startUploads, retryFailedUploads } = uploads;
  const fileInputRef = useRef<HTMLInputElement>(null);
  return <div className={styles.uploadPanel}>{!hasOpenFolder ? <label className={styles.uploadVisibility}>Visibility<select value={uploadVisibility} disabled={!canManageClub} onChange={(event) => setUploadVisibility(event.target.value as "members" | "executives")}><option value="members">Members</option>{canManageClub ? <option value="executives">Executives only</option> : null}</select></label> : null}<input ref={fileInputRef} type="file" multiple={mode === "files"} className={styles.hiddenInput} tabIndex={-1} aria-label={mode === "folder-upload" ? "Folder to upload" : "Files to upload"} {...(mode === "folder-upload" ? { webkitdirectory: "" } : {})} onChange={handleFileSelection} /><button type="button" className={styles.dropzone} onClick={() => fileInputRef.current?.click()} disabled={uploading}><ResourceIcon name={mode === "folder-upload" ? "folder" : "upload"} size={22} /><strong>{uploadEntries.length ? "Choose a different set" : mode === "folder-upload" ? "Choose a folder" : "Choose files"}</strong><span>{mode === "folder-upload" ? "The folder structure will be kept" : "Up to three files upload at once"}</span></button>{uploadEntries.length ? <><div className={styles.progressRow}><span>{uploadDone} of {uploadTotal} complete</span><span>{failedUploadCount ? `${failedUploadCount} failed` : uploading ? "Uploading…" : "Ready to upload"}</span></div><div className={styles.progressTrack}><span style={{ width: "100%", transform: `scaleX(${uploadTotal ? uploadDone / uploadTotal : 0})` }} /></div><UploadProgress items={rowsOf(uploadEntries)} label="Files being uploaded" className={styles.uploadList} /><div className={styles.formActions}><button type="button" className={styles.secondaryButton} onClick={onClose} disabled={uploading}>Cancel</button>{failedUploadCount > 0 && !uploading ? <button type="button" className={styles.secondaryButton} onClick={() => void retryFailedUploads()}>Reset failed</button> : null}<button type="button" className={styles.primaryButton} onClick={() => void startUploads()} disabled={uploading || !uploadEntries.some((entry) => entry.state === "queued")}>{uploading ? "Uploading…" : "Start upload"}</button></div></> : null}</div>;
}
