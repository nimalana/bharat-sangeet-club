// A value that follows another one after it has been still for `delayMs` (the search box that asks the database after a pause).
//
//   const [search] = useDebounced(query, 250);                        // what is sent to the database
//   const [search] = useDebounced(query, 250, () => setPages(1));     // and reset what depends on it, in the same batch
//   const [search, setSearchNow] = useDebounced(query, 250);          // "Clear search" sets it at once, without the wait
//
// Every change of `value` restarts the wait. `onSettled` runs in the same timer callback as the update (so React batches them),
// each time the wait ends, including the first one after mount. The first returned value is the first `value`.
import { useEffect, useRef, useState } from "react";

export function useDebounced<T>(value: T, delayMs: number, onSettled?: (settled: T) => void): readonly [settled: T, setNow: (value: T) => void] {
  const [settled, setSettled] = useState(value);
  const onSettledRef = useRef(onSettled);
  useEffect(() => { onSettledRef.current = onSettled; });
  useEffect(() => {
    const timer = window.setTimeout(() => { setSettled(value); onSettledRef.current?.(value); }, delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);
  return [settled, setSettled];
}
