// The single-flight guard of every write on the attendance screen: while one request runs, a second call is dropped (a double
// click sends one), and `saving` (shown on the buttons) stays set for as long as it runs.
import { useRef, useState } from "react";

export type Exclusive = (work: () => Promise<void>) => Promise<void>;

export function useExclusive() {
  const [saving, setSaving] = useState(false);
  const inFlight = useRef(false);

  // One request at a time for anything that writes, so a double click sends one.
  async function exclusive(work: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setSaving(true);
    try { await work(); } finally { inFlight.current = false; setSaving(false); }
  }

  return { saving, exclusive };
}
