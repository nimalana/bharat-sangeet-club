"use client";

// The toast: one message at a time, shown for 2.8 s (6 s for a failure, which says what to do next). A newer message replaces the
// older one and takes over its timer. The tone rules (a failure never wears the tick of a success) are lib/toast.ts, unchanged.
//
//   <ToastProvider>              once, above everything that notifies
//     ...screens call  const { notify } = useToast();  notify("Saved");  notify(friendlyError(error), "error");
//     <ToastViewport />          where the toast is drawn (the shell puts it inside its <main>, as a direct child)
//   </ToastProvider>
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toastDuration, toastMark, toastTone, type Notify, type ToastTone } from "../../lib/toast";

type Shown = { message: string; tone: ToastTone } | null;

// Two contexts so that a toast appearing re-draws only the viewport, not every component that can notify.
const ToastApi = createContext<{ notify: Notify } | null>(null);
const ToastShown = createContext<Shown>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [shown, setShown] = useState<Shown>(null);
  const timer = useRef<number | null>(null);
  const notify = useCallback<Notify>((message, tone) => {
    const resolved = toastTone(message, tone);
    setShown({ message, tone: resolved });
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => { setShown(null); timer.current = null; }, toastDuration(resolved));
  }, []);
  useEffect(() => () => { if (timer.current !== null) window.clearTimeout(timer.current); }, []);
  const api = useMemo(() => ({ notify }), [notify]);
  return <ToastApi.Provider value={api}><ToastShown.Provider value={shown}>{children}</ToastShown.Provider></ToastApi.Provider>;
}

/** `notify(message, tone?)`: the same function every render. Throws outside a ToastProvider. */
export function useToast(): { notify: Notify } {
  const api = useContext(ToastApi);
  if (!api) throw new Error("useToast must be used inside a ToastProvider");
  return api;
}

/** Draws the toast that is showing, if any: an alert for a failure, a status for anything else. */
export function ToastViewport() {
  const shown = useContext(ToastShown);
  if (!shown) return null;
  return <div className={`toast ${shown.tone}`} role={shown.tone === "error" ? "alert" : "status"}>{toastMark[shown.tone]} {shown.message}</div>;
}
