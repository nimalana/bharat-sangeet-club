"use client";

// The toast. A confirmation shows for 2.8 s and fades. A failure stays until the person dismisses it (its Dismiss button) or the next
// failure replaces it: it says what to do next, and a person who looked away must still find it. Several toasts stack, at most 3 on
// screen, the oldest confirmation going first (lib/toast.ts `pushToast` decides). The tone rules (a failure never wears the tick of a
// success) are lib/toast.ts, unchanged.
//
//   <ToastProvider>              once, above everything that notifies
//     ...screens call  const { notify } = useToast();  notify("Saved");  notify(friendlyError(error), "error");
//     <ToastViewport />          where the toasts are drawn (the shell puts it inside its <main>, as a direct child)
//   </ToastProvider>
//
// What a screen reader gets: the viewport is a polite live region that is in the page from the start (a live region added together
// with its first message is not reliably announced), a confirmation is a role="status" inside it, a failure is a role="alert"
// (announced at once). The Dismiss button of a failure is next to the alert, not inside it, so the announcement is the message only.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { pushToast, toastDuration, toastMark, toastTone, type Notify, type ToastItem } from "../../lib/toast";

type Shown = { items: readonly ToastItem[]; dismiss: (id: number) => void };

// Two contexts so that a toast appearing re-draws only the viewport, not every component that can notify.
const ToastApi = createContext<{ notify: Notify } | null>(null);
const ToastShown = createContext<Shown>({ items: [], dismiss: () => {} });

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<readonly ToastItem[]>([]);
  // The list is kept in a ref as well, so that notify() and dismiss() decide from the latest list without being re-made.
  const list = useRef<readonly ToastItem[]>([]);
  const timers = useRef(new Map<number, number>());
  const lastId = useRef(0);

  const forget = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer !== undefined) { window.clearTimeout(timer); timers.current.delete(id); }
  }, []);
  const show = useCallback((next: readonly ToastItem[]) => { list.current = next; setItems(next); }, []);
  const dismiss = useCallback((id: number) => { forget(id); show(list.current.filter((item) => item.id !== id)); }, [forget, show]);

  const notify = useCallback<Notify>((message, tone) => {
    const item: ToastItem = { id: (lastId.current += 1), message, tone: toastTone(message, tone) };
    const { list: next, removed } = pushToast(list.current, item);
    removed.forEach(forget);
    const wait = toastDuration(item.tone);
    if (Number.isFinite(wait)) timers.current.set(item.id, window.setTimeout(() => dismiss(item.id), wait));
    show(next);
  }, [dismiss, forget, show]);

  useEffect(() => { const pending = timers.current; return () => { pending.forEach((timer) => window.clearTimeout(timer)); pending.clear(); }; }, []);
  const api = useMemo(() => ({ notify }), [notify]);
  const shown = useMemo(() => ({ items, dismiss }), [items, dismiss]);
  return <ToastApi.Provider value={api}><ToastShown.Provider value={shown}>{children}</ToastShown.Provider></ToastApi.Provider>;
}

/** `notify(message, tone?)`: the same function every render. Throws outside a ToastProvider. */
export function useToast(): { notify: Notify } {
  const api = useContext(ToastApi);
  if (!api) throw new Error("useToast must be used inside a ToastProvider");
  return api;
}

/** Draws the toasts that are showing: an alert (with Dismiss) for a failure, a status for anything else, in a live region that is always there. */
export function ToastViewport() {
  const { items, dismiss } = useContext(ToastShown);
  return <div className="toast-stack" aria-live="polite">
    {items.map((item) => <div className="toast-item" key={item.id}>
      <div className={`toast ${item.tone}`} role={item.tone === "error" ? "alert" : "status"}>{toastMark[item.tone]} {item.message}</div>
      {item.tone === "error" && <button type="button" className="toast-close" aria-label="Dismiss message" onClick={() => dismiss(item.id)}>×</button>}
    </div>)}
  </div>;
}
