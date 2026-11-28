"use client";

import { useRef } from "react";
import { useResourceUploads } from "../hooks/use-resource-uploads";
import { ResourceIcon } from "./resource-icon";
import styles from "./resources.module.css";

// The upload branch of the add-resource panel: who may see the files, the picker (files, or a whole folder), how far each file got,
// and the buttons that start the batch, retry the failed files or leave.
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
  return <div className={styles.uploadPanel}>{!hasOpenFolder ? <label className={styles.uploadVisibility}>Visibility<select value={uploadVisibility} disabled={!canManageClub} onChange={(event) => setUploadVisibility(event.target.value as "members" | "executives")}><option value="members">Members</option>{canManageClub ? <option value="executives">Executives only</option> : null}</select></label> : null}<input ref={fileInputRef} type="file" multiple={mode === "files"} className={styles.hiddenInput} {...(mode === "folder-upload" ? { webkitdirectory: "" } : {})} onChange={handleFileSelection} /><button type="button" className={styles.dropzone} onClick={() => fileInputRef.current?.click()} disabled={uploading}><ResourceIcon name={mode === "folder-upload" ? "folder" : "upload"} size={22} /><strong>{uploadEntries.length ? "Choose a different set" : mode === "folder-upload" ? "Choose a folder" : "Choose files"}</strong><span>{mode === "folder-upload" ? "The folder structure will be kept" : "Up to three files upload at once"}</span></button>{uploadEntries.length ? <><div className={styles.progressRow}><span>{uploadDone} of {uploadTotal} complete</span><span>{failedUploadCount ? `${failedUploadCount} failed` : uploading ? "Uploading…" : "Ready to upload"}</span></div><div className={styles.progressTrack}><span style={{ width: "100%", transform: `scaleX(${uploadTotal ? uploadDone / uploadTotal : 0})` }} /></div><ul className={styles.uploadList}>{uploadEntries.map((entry, index) => <li key={`${entry.relativePath}-${index}`}><span className={entry.state === "failed" ? styles.uploadFailed : entry.state === "ready" ? styles.uploadReady : ""}><ResourceIcon name={entry.state === "failed" ? "close" : entry.state === "ready" ? "arrow" : "file"} size={15} /></span><span title={entry.relativePath}>{entry.relativePath}</span><small>{entry.error || entry.state}</small></li>)}</ul><div className={styles.formActions}><button type="button" className={styles.secondaryButton} onClick={onClose} disabled={uploading}>Cancel</button>{failedUploadCount > 0 && !uploading ? <button type="button" className={styles.secondaryButton} onClick={() => void retryFailedUploads()}>Reset failed</button> : null}<button type="button" className={styles.primaryButton} onClick={() => void startUploads()} disabled={uploading || !uploadEntries.some((entry) => entry.state === "queued")}>{uploading ? "Uploading…" : "Start upload"}</button></div></> : null}</div>;
}
