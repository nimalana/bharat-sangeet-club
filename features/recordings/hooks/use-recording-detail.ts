// What the detail dialog reads: the signed address of the take, and the notation attached to the recording. Every note change
// reloads the notation; only the newest answer may replace it, and a failed reload keeps the notation already shown. A first read
// that fails is said (with Try again) instead of being shown as "nothing attached".
import { useCallback, useEffect, useRef, useState } from "react";
import { attempt } from "../../../lib/api/attempt";
import { createNotationUrl, createRecordingUrl, listRecordingNotes, recordingBucket } from "../../../lib/api/recordings";
import { createRequestGate } from "../../../lib/request-gate";
import { useToast } from "../../../components/ui/toast";
import type { PreviewFile } from "../../../components/ui/preview-dialog";
import type { Recording, RecordingNote } from "../model";

export function useRecordingDetail(recording: Recording) {
  const { notify } = useToast();
  const [url, setUrl] = useState<string | null>(null);
  const [urlFailed, setUrlFailed] = useState(false);
  const [urlAttempt, setUrlAttempt] = useState(0);
  const [notes, setNotes] = useState<RecordingNote[]>([]);
  // Where the notation stands: still being read the first time, read, or the first read failed.
  const [notesState, setNotesState] = useState<"loading" | "ready" | "failed">("loading");
  // Every note change reloads the list; only the newest answer may replace it.
  const [notesGate] = useState(createRequestGate);
  const notesRead = useRef(false);
  const recordingId = recording.id;
  const storagePath = recording.storage_path;
  const bucket = recordingBucket(recording);
  const loadNotes = useCallback(async () => {
    const isCurrent = notesGate.begin();
    const { data, error } = await attempt(() => listRecordingNotes(recordingId));
    if (!isCurrent()) return;
    if (error) {
      // A failed reload keeps the notation already shown; a first read that failed has nothing to keep.
      if (notesRead.current) notify("The notation could not be refreshed, so the list may be out of date.", "error");
      else setNotesState("failed");
      return;
    }
    notesRead.current = true;
    setNotes((data || []) as RecordingNote[]);
    setNotesState("ready");
  }, [notesGate, notify, recordingId]);
  useEffect(() => {
    let cancelled = false;
    void attempt(() => createRecordingUrl(bucket, storagePath)).then((fileResult) => { if (cancelled) return; if (fileResult.error || !fileResult.data) setUrlFailed(true); else setUrl(fileResult.data); });
    return () => { cancelled = true; };
  }, [bucket, storagePath, urlAttempt]);
  // The loader synchronizes remote Supabase state into this client component.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void loadNotes(); }, [loadNotes]);

  /** Signs the address of the take again after it could not be read. */
  function retryUrl() { setUrlFailed(false); setUrlAttempt((count) => count + 1); }
  /** Reads the notation again after the first read failed. */
  function retryNotes() { setNotesState("loading"); void loadNotes(); }

  /** What PreviewDialog needs to show an attached notation file: its signed address, type and name. Throws when no address could be made. */
  async function signNote(note: RecordingNote): Promise<PreviewFile> {
    const path = note.storage_path;
    const signed = path ? await createNotationUrl(path) : null;
    if (!signed) throw new Error("");
    return { url: signed, mime: note.mime_type || "", name: note.title };
  }

  return { url, urlFailed, retryUrl, notes, notesState, loadNotes, retryNotes, signNote };
}
