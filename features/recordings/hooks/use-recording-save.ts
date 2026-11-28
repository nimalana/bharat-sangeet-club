// Saving from the studio: upload the take, write the recording row (new, or the draft being finished), then attach the notation.
// A failure removes only the files that no row refers to; removing the take of a recording that was saved would leave a recording
// that cannot play. The take and the notation file are uploaded with progress (`uploads`, drawn by UploadProgress); a second press of
// Save while one is running does nothing (exclusive), and what was typed is never cleared by a failure.
import { useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import {
  insertRecording, insertRecordingNote, removeAbandonedNotationFile, removeAbandonedTake, updateRecording, uploadNotationFile, uploadRecordingTake,
  type RecordingPayload,
} from "../../../lib/api/recordings";
import { friendlyError } from "../../../lib/errors";
import { useAsyncAction } from "../../../lib/hooks/use-async-action";
import { useToast } from "../../../components/ui/toast";
import type { UploadItem } from "../../../components/ui/upload-progress";
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

export function useRecordingSave({ user, draft, fields, file, mediaKind, recordingSeconds, onSaved }: {
  user: User; draft: Recording | null; fields: RecordingFields; file: File | null; mediaKind: "audio" | "video"; recordingSeconds: number;
  onSaved: () => Promise<void>;
}) {
  const { notify } = useToast();
  const { pending: saving, run } = useAsyncAction(notify, { exclusive: true });
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const lastStatus = useRef<"draft" | "published">("published");
  const { title, description, groupId, recordingKind, raga, tala, sruthi, tempo, notationText, notationFile } = fields;

  const patch = (id: string, change: Partial<UploadItem>) => setUploads((list) => list.map((item) => (item.id === id ? { ...item, ...change } : item)));

  async function store(status: "draft" | "published") {
    if (!title.trim()) { notify("Give this recording a title first", "error"); return; }
    if (!groupId) { notify("Choose a subgroup for this recording", "error"); return; }
    if (!file && !draft) { notify("Upload a file or record something before saving", "error"); return; }
    setUploads([
      ...(file ? [{ id: "take", name: file.name, status: "waiting" as const }] : []),
      ...(notationFile ? [{ id: "notation", name: notationFile.name, status: "waiting" as const }] : []),
    ]);
    // The file that is on its way, so a failure marks its row.
    let sending: "take" | "notation" | null = null;
    const progress: SaveProgress = { storagePath: draft?.storage_path || "", uploadedTake: false, recordSaved: false, notationPath: null, notationUploaded: false, noteSaved: false };
    try {
      if (file) {
        sending = "take";
        patch("take", { status: "uploading", loaded: 0, total: file.size });
        progress.storagePath = await uploadRecordingTake(user.id, groupId, file, ({ loaded, total }) => patch("take", { status: "uploading", loaded, total }));
        progress.uploadedTake = true;
        patch("take", { status: "done" });
        sending = null;
      }
      const payload: RecordingPayload = { title: title.trim(), description: description.trim(), subgroup_id: groupId, storage_path: progress.storagePath, mime_type: file?.type || draft?.mime_type || (mediaKind === "video" ? "video/webm" : "audio/webm"), media_kind: mediaKind, status, audience: "subgroup", recording_kind: recordingKind, raga: raga.trim() || null, tala: tala.trim() || null, sruthi: sruthi.trim() || null, tempo: tempo.trim() || null, duration_seconds: recordingSeconds || draft?.duration_seconds || null, published_at: status === "published" ? new Date().toISOString() : null, updated_at: new Date().toISOString() };
      let recordingId: number;
      if (draft) { await updateRecording(draft.id, payload); recordingId = draft.id; }
      else recordingId = await insertRecording(payload, user.id);
      progress.recordSaved = true;
      if (recordingId && (notationText.trim() || notationFile)) {
        if (notationFile) {
          sending = "notation";
          patch("notation", { status: "uploading", loaded: 0, total: notationFile.size });
          progress.notationPath = await uploadNotationFile(user.id, notationFile, ({ loaded, total }) => patch("notation", { status: "uploading", loaded, total }));
          progress.notationUploaded = true;
          patch("notation", { status: "done" });
          sending = null;
        }
        await insertRecordingNote({ recordingId, title: notationFile?.name || "Notation", noteType: notationFile ? "file" : "text", body: notationText.trim(), storagePath: progress.notationPath, mimeType: notationFile?.type || null, uploadedBy: user.id });
        progress.noteSaved = true;
      }
      notify(status === "published" ? "Published to your subgroup" : "Draft saved"); await onSaved();
    } catch (error) {
      const reason = friendlyError(error as { message?: string; code?: string }, "This recording could not be saved");
      // The file that was on its way failed; so did a take that went up but whose recording could not be written (it is removed again below).
      // The row says "Failed" with Retry; the sentence is the toast's below (it stays until it is closed), so it is not on the screen twice.
      if (sending) patch(sending, { status: "failed" });
      else if (progress.uploadedTake && !progress.recordSaved) patch("take", { status: "failed" });
      setUploads((list) => list.filter((item) => item.status !== "waiting"));
      const afterwards = await removeAbandonedFiles(progress);
      if (progress.recordSaved) {
        // The recording exists; closing the studio stops a second save from creating a duplicate.
        notify(`The recording was saved, but its notation could not be added: ${reason}${afterwards}`, "error");
        await onSaved();
      } else notify(`${reason}${afterwards}`, "error");
    }
  }

  function save(status: "draft" | "published") {
    lastStatus.current = status;
    return run(() => store(status));
  }
  /** Sends the same save again (Retry on a file that did not go up). */
  const retry = () => { void save(lastStatus.current); };

  return { saving, save, uploads, retry };
}
