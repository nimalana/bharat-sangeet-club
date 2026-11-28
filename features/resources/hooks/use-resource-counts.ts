// Whether anything is archived (the "Show archived" button) and how many live items there are (the dashboard's count), read
// without loading the library. A count that cannot be read changes nothing on screen; the other one is still used.
import { useEffect, useState } from "react";
import { countArchivedResources, countLiveResources, resourcesAvailable } from "../../../lib/api/resources";

export function useResourceCounts(version: number, onResourceCountChange?: (count: number) => void) {
  const [hasArchivedItems, setHasArchivedItems] = useState(false);

  useEffect(() => {
    if (!resourcesAvailable()) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      // A count that cannot be read changes nothing on screen; the other one is still used.
      const [archived, live] = await Promise.allSettled([countArchivedResources(), countLiveResources()]);
      if (cancelled) return;
      if (archived.status === "fulfilled") setHasArchivedItems((archived.value || 0) > 0);
      if (live.status === "fulfilled" && live.value !== null) onResourceCountChange?.(live.value);
    }, 0);
    return () => { cancelled = true; window.clearTimeout(timer); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);

  return hasArchivedItems;
}
