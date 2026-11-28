// A read that a screen caches: the small piece over lib/cache.ts and lib/request-gate.ts that screens wrote by hand.
//
//   const { data, loading, failed, error, refetch, retry } = useQuery({ userId: user.id, key: "members", load, onError: () => notify("..."), enabled: Boolean(supabase) });
//
// - The first value is what the cache holds for this person and key (the last good read of an earlier visit), so a screen opened
//   again shows its last data at once and refreshes behind it. `loading` is true only while there is nothing to show yet.
// - A good read replaces `data`, clears `failed` and is written to the cache.
// - A failed read (`load` throws) keeps `data` as it is, sets `failed` and `error` (what `load` threw), ends `loading`, and calls
//   `onError` once. A failed first read leaves `data` undefined: `failed && data === undefined` is "show the error with Try again,
//   not an empty list". A good read clears `failed` and `error`.
// - Only the newest read may change anything: of two overlapping reads, the older answer arriving last is dropped.
// - It reads once on mount (and again when `userId`, `key` or `enabled` change); `refetch()` reads again and resolves when that
//   read has settled. `load` and `onError` are read at the moment they are needed, so passing new functions each render does
//   not start a read. While `enabled` is false nothing is read and `loading` stays as it was.
// - `retry()` is the Try again of a failed read: it clears `failed` and `error` at once, shows `loading` again when there is nothing
//   to show yet (so the screen can draw its skeleton instead of the error while it tries), then reads like `refetch()` and resolves when
//   that read has settled. The data already on screen (a failed refresh) is kept while it tries.
//
// `load` should throw an ApiError when the database answers with an error (lib/api/_core.ts `must`), and return the whole value
// the screen shows, so that a half-answer is never kept.
import { useCallback, useEffect, useRef, useState } from "react";
import { readCache, writeCache } from "../cache";
import { createRequestGate } from "../request-gate";

export type QueryOptions<T> = {
  userId: string;
  key: string;
  load: () => Promise<T>;
  onError?: (error: unknown) => void;
  enabled?: boolean;
};

type State<T> = { id: string; data: T | undefined; loading: boolean; failed: boolean; error?: unknown };

// What a screen knows about a read before it has asked: the remembered read of this person and key, if there is one.
function fromCache<T>(id: string, userId: string, key: string): State<T> {
  const cached = readCache<T>(userId, key);
  return { id, data: cached, loading: cached === undefined, failed: false };
}

export function useQuery<T>({ userId, key, load, onError, enabled = true }: QueryOptions<T>) {
  const id = `${userId}\u0000${key}`;
  const [state, setState] = useState<State<T>>(() => fromCache<T>(id, userId, key));
  // Another key (or person) starts from its own remembered read, never from the data of the one before.
  const shown = state.id === id ? state : fromCache<T>(id, userId, key);
  const [gate] = useState(createRequestGate);
  const latest = useRef({ load, onError });
  useEffect(() => { latest.current = { load, onError }; });

  const refetch = useCallback(async () => {
    if (!enabled) return;
    const isCurrent = gate.begin();
    let next: T;
    try {
      next = await latest.current.load();
    } catch (error) {
      if (!isCurrent()) return;
      setState((current) => ({ ...(current.id === id ? current : fromCache<T>(id, userId, key)), loading: false, failed: true, error }));
      latest.current.onError?.(error);
      return;
    }
    if (!isCurrent()) return;
    setState({ id, data: next, loading: false, failed: false });
    writeCache(userId, key, next);
  }, [enabled, gate, id, userId, key]);

  const retry = useCallback(async () => {
    setState((current) => {
      const now = current.id === id ? current : fromCache<T>(id, userId, key);
      return { ...now, loading: now.data === undefined, failed: false, error: undefined };
    });
    await refetch();
  }, [refetch, id, userId, key]);

  // The read synchronizes remote Supabase state into this component: it sets state after the awaited read, not in the effect body.
  useEffect(() => { void refetch(); }, [refetch]);
  return { data: shown.data, loading: shown.loading, failed: shown.failed, error: shown.error, refetch, retry };
}
