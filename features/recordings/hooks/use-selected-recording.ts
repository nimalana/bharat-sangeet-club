// The recording whose detail is open, kept in the address (?recording=<id>): a reload keeps it, a link opens it, and Back closes it.
//
// Opening pushes a history entry (Back closes the dialog) and closing replaces it (Back does not reopen it). The recording itself comes
// from the list already on screen; a link to one that is not in that list (another view, another group, a reload) is read on its own.
// An id that is not valid, or that no recording the person may read has, is dropped from the address with a toast and nothing opens.
import { useEffect, useState } from "react";
import { attempt } from "../../../lib/api/attempt";
import { fetchRecording } from "../../../lib/api/recordings";
import { positiveInteger, useUrlState } from "../../../lib/hooks/use-url-state";
import { useToast } from "../../../components/ui/toast";
import type { Recording } from "../model";

const NONE: number | null = null;

export function useSelectedRecording({ recordings, loading }: { recordings: Recording[]; /** The list is still being read for the first time. */ loading: boolean }) {
  const { notify } = useToast();
  const [selectedId, open] = useUrlState<number | null>("recording", { parse: positiveInteger, defaultValue: NONE, history: "push" });
  // The same parameter, written without a new history entry: closing, and dropping an id that opens nothing.
  const [, close] = useUrlState<number | null>("recording", { parse: positiveInteger, defaultValue: NONE, history: "replace" });
  const [fetched, setFetched] = useState<Recording | null>(null);
  const [reload, setReload] = useState(0);

  const listed = selectedId === null ? null : recordings.find((item) => item.id === selectedId) ?? null;
  const needsRead = selectedId !== null && listed === null && !loading;
  useEffect(() => {
    if (selectedId === null || !needsRead) return;
    let cancelled = false;
    void attempt(() => fetchRecording(selectedId)).then(({ data, error }) => {
      if (cancelled) return;
      if (error || !data) { notify("That recording could not be found"); close(NONE); return; }
      setFetched(data as Recording);
    });
    return () => { cancelled = true; };
  }, [selectedId, needsRead, reload, notify, close]);

  // What the list says is the newest; the single read stands in for a recording the list does not hold.
  const recording = listed ?? (fetched && fetched.id === selectedId ? fetched : null);
  return {
    recording,
    open: (id: number) => open(id),
    close: () => close(NONE),
    /** After a change made to the open recording: a recording that is not in the list is read again. */
    refresh: () => setReload((count) => count + 1),
  };
}
