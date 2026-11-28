// What the detail dialog reads: the signed address of the take, and the notation attached to the recording. Every note change
// reloads the notation; only the newest answer may replace it, and a failed reload keeps the notation already shown.
import { useCallback, useEffect, useState } from "react";
import { attempt } from "../../../lib/api/attempt";
import { createNotationUrl, createRecordingUrl, listRecordingNotes, recordingBucket } from "../../../lib/api/recordings";
import { createRequestGate } from "../../../lib/request-gate";
import type { Notify } from "../../../lib/toast";
import type { Recording, RecordingNote } from "../model";

export function useRecordingDetail(recording: Recording, notify: Notify) {
  const [url, setUrl] = useState<string | null>(null);
  const [notes, setNotes] = useState<RecordingNote[]>([]);
  // Every note change reloads the list; only the newest answer may replace it.
  const [notesGate] = useState(createRequestGate);
  const recordingId = recording.id;
  const storagePath = recording.storage_path;
  const bucket = recordingBucket(recording);
  const loadNotes = useCallback(async () => {
    const isCurrent = notesGate.begin();
    const { data, error } = await attempt(() => listRecordingNotes(recordingId));
    if (!isCurrent()) return;
    // A failed reload keeps the notation already shown.
    if (error) { notify("The notation could not be refreshed, so the list may be out of date.", "error"); return; }
    setNotes((data || []) as RecordingNote[]);
  }, [notesGate, notify, recordingId]);
  useEffect(() => {
    let cancelled = false;
    void attempt(() => createRecordingUrl(bucket, storagePath)).then((fileResult) => { if (cancelled) return; if (fileResult.error || !fileResult.data) notify("This recording could not be opened", "error"); else setUrl(fileResult.data); });
    return () => { cancelled = true; };
  }, [notify, bucket, storagePath]);
  // The loader synchronizes remote Supabase state into this client component.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void loadNotes(); }, [loadNotes]);

  /** Opens an attached notation file in a new tab. */
  async function openNote(note: RecordingNote) {
    const path = note.storage_path;
    if (!path) return;
    const { data: noteUrl, error } = await attempt(() => createNotationUrl(path));
    if (error || !noteUrl) notify("This notation file could not be opened", "error"); else window.open(noteUrl, "_blank", "noopener,noreferrer");
  }

  return { url, notes, loadNotes, openNote };
}
