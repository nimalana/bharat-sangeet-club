// Saving from the studio: upload the take, write the recording row (new, or the draft being finished), then attach the notation.
// A failure removes only the files that no row refers to; removing the take of a recording that was saved would leave a recording
// that cannot play.
import { useState } from "react";
import type { User } from "@supabase/supabase-js";
import {
  insertRecording, insertRecordingNote, removeAbandonedNotationFile, removeAbandonedTake, updateRecording, uploadNotationFile, uploadRecordingTake,
  type RecordingPayload,
} from "../../../lib/api/recordings";
import { friendlyError } from "../../../lib/errors";
import type { Notify } from "../../../lib/toast";
import type { Recording } from "../model";
import type { RecordingFields } from "./use-recording-fields";

/** What a save has put in storage and what the database now points at. */
type SaveProgress = { storagePath: string; uploadedTake: boolean; recordSaved: boolean; notationPath: string | null; notationUploaded: boolean; noteSaved: boolean };

/** Removes the files no row refers to. Storage answers a refused delete with an empty list, so say when one stays. */
async function removeAbandonedFiles(progress: SaveProgress) {
  const leftovers: string[] = [];
  if (progress.uploadedTake && !progress.recordSaved) { const problem = await removeAbandonedTake(progress.storagePath); if (problem) leftovers.push("The uploaded take could not be removed from storage."); }
  if (progress.notationUploaded && !progress.noteSaved && progress.notationPath) { const problem = await removeAbandonedNotationFile(progress.notationPath); if (problem) leftovers.push("The uploaded notation file could not be removed from storage."); }
  return leftovers.length ? ` ${leftovers.join(" ")} An administrator may need to clean up.` : "";
}

export function useRecordingSave({ user, draft, fields, file, mediaKind, recordingSeconds, notify, onSaved }: {
  user: User; draft: Recording | null; fields: RecordingFields; file: File | null; mediaKind: "audio" | "video"; recordingSeconds: number;
  notify: Notify; onSaved: () => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  const { title, description, groupId, recordingKind, raga, tala, sruthi, tempo, notationText, notationFile } = fields;

  async function save(status: "draft" | "published") {
    if (!title.trim()) { notify("Give this recording a title first", "error"); return; }
    if (!groupId) { notify("Choose a subgroup for this recording", "error"); return; }
    if (!file && !draft) { notify("Upload a file or record something before saving", "error"); return; }
    setSaving(true);
    const progress: SaveProgress = { storagePath: draft?.storage_path || "", uploadedTake: false, recordSaved: false, notationPath: null, notationUploaded: false, noteSaved: false };
    try {
      if (file) {
        progress.storagePath = await uploadRecordingTake(user.id, groupId, file);
        progress.uploadedTake = true;
      }
      const payload: RecordingPayload = { title: title.trim(), description: description.trim(), subgroup_id: groupId, storage_path: progress.storagePath, mime_type: file?.type || draft?.mime_type || (mediaKind === "video" ? "video/webm" : "audio/webm"), media_kind: mediaKind, status, audience: "subgroup", recording_kind: recordingKind, raga: raga.trim() || null, tala: tala.trim() || null, sruthi: sruthi.trim() || null, tempo: tempo.trim() || null, duration_seconds: recordingSeconds || draft?.duration_seconds || null, published_at: status === "published" ? new Date().toISOString() : null, updated_at: new Date().toISOString() };
      let recordingId: number;
      if (draft) { await updateRecording(draft.id, payload); recordingId = draft.id; }
      else recordingId = await insertRecording(payload, user.id);
      progress.recordSaved = true;
      if (recordingId && (notationText.trim() || notationFile)) {
        if (notationFile) {
          progress.notationPath = await uploadNotationFile(user.id, notationFile);
          progress.notationUploaded = true;
        }
        await insertRecordingNote({ recordingId, title: notationFile?.name || "Notation", noteType: notationFile ? "file" : "text", body: notationText.trim(), storagePath: progress.notationPath, mimeType: notationFile?.type || null, uploadedBy: user.id });
        progress.noteSaved = true;
      }
      notify(status === "published" ? "Published to your subgroup" : "Draft saved"); await onSaved();
    } catch (error) {
      const reason = friendlyError(error as { message?: string; code?: string }, "This recording could not be saved");
      const afterwards = await removeAbandonedFiles(progress);
      if (progress.recordSaved) {
        // The recording exists; closing the studio stops a second save from creating a duplicate.
        notify(`The recording was saved, but its notation could not be added: ${reason}${afterwards}`, "error");
        await onSaved();
      } else notify(`${reason}${afterwards}`, "error");
    } finally { setSaving(false); }
  }

  return { saving, save };
}
