// The pending flag, the failure sentence and the toast that every "press a button, wait for the database" handler writes by hand.
//
//   const { pending, run } = useAsyncAction(notify);
//   const outcome = await run(() => must(await supabase.from("announcements").delete().eq("id", id)), { fallback: "It could not be deleted.", success: "Deleted" });
//   if (outcome.ok) await onChanged();
//
// run() sets `pending` before the call and clears it when the call settles (also when it throws). A failure becomes the sentence the
// person sees (friendlyError, with the call's own `fallback`), is kept in `error` until the next run, and is sent to `notify` as an
// error toast. A success sends `success` as a toast, after `pending` is cleared. What the action returned comes back as `value`.
//
// The action should throw an ApiError (lib/api, or lib/api/_core.ts `must`) when the database answers with an error: a Supabase answer
// that carries `{ error }` and is returned as it is counts as a success here.
import { useCallback, useRef, useState } from "react";
import { friendlyError, toApiError } from "../errors";
import type { Notify } from "../toast";

export type AsyncOutcome<T> = { ok: true; value: T } | { ok: false; error: unknown; message: string };
export type RunOptions = { fallback?: string; success?: string };

export function useAsyncAction(notify?: Notify) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  // Two overlapping runs keep `pending` up until the last one settles.
  const inFlight = useRef(0);

  const run = useCallback(async <T,>(action: () => Promise<T>, options: RunOptions = {}): Promise<AsyncOutcome<T>> => {
    inFlight.current += 1;
    setPending(true);
    setError("");
    let outcome: AsyncOutcome<T>;
    try {
      outcome = { ok: true, value: await action() };
    } catch (caught) {
      outcome = { ok: false, error: caught, message: friendlyError(toApiError(caught), options.fallback) };
    } finally {
      inFlight.current -= 1;
      if (inFlight.current === 0) setPending(false);
    }
    if (outcome.ok) {
      if (options.success) notify?.(options.success);
    } else {
      setError(outcome.message);
      notify?.(outcome.message, "error");
    }
    return outcome;
  }, [notify]);

  const clearError = useCallback(() => setError(""), []);
  return { pending, error, run, clearError };
}
