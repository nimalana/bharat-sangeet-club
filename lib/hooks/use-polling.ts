// Calls `callback` every `intervalMs` while `enabled` and the page is not hidden, and once when the page becomes visible again
// (a tab that was in the background is stale). The wait restarts whenever `callback`, `intervalMs` or `enabled` changes, so pass a
// callback that is stable (useCallback) unless a restart is what you want. Nothing runs after unmount or after `enabled` turns false.
import { useEffect } from "react";

export function usePolling(callback: () => void, intervalMs: number, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const tick = () => { if (document.visibilityState !== "hidden") callback(); };
    const onVisibility = () => { if (document.visibilityState === "visible") callback(); };
    const timer = window.setInterval(tick, intervalMs);
    document.addEventListener("visibilitychange", onVisibility);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", onVisibility); };
  }, [callback, intervalMs, enabled]);
}
