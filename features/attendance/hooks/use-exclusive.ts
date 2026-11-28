// The single-flight guard of every write on the attendance screen: while one request runs, a second call is dropped (a double
// click sends one), and `saving` (shown on the buttons) stays set for as long as it runs. `active` says which write it is (the key
// the caller gave), so the button that was pressed can show the pending state while the others are only off.
import { useRef, useState } from "react";

export type Exclusive = (work: () => Promise<void>, key?: string) => Promise<void>;

export function useExclusive() {
  const [active, setActive] = useState<string | null>(null);
  const inFlight = useRef(false);

  // One request at a time for anything that writes, so a double click sends one.
  async function exclusive(work: () => Promise<void>, key = "write") {
    if (inFlight.current) return;
    inFlight.current = true;
    setActive(key);
    try { await work(); } finally { inFlight.current = false; setActive(null); }
  }

  return { saving: active !== null, active, exclusive };
}
