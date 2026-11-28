"use client";

// "Are you sure?" as an awaited question, for a destructive or hard-to-undo action that needs no dialog state of its own.
//
//   const { confirm } = useConfirm();
//   async function remove() {
//     if (!(await confirm({ title: "Delete this announcement?", message: "It disappears for everyone.", confirmLabel: "Delete announcement", tone: "destructive" }))) return;
//     await run(() => deleteAnnouncement(id), { success: "Announcement deleted" });
//   }
//
// It resolves true on Confirm and false on Cancel, Escape or a click on the backdrop. Focus starts on Cancel (whatever the tone), so Enter
// never confirms by accident; `tone: "destructive"` makes the Confirm button the danger button. The dialog is the ConfirmDialog of this
// folder (so the Dialog's focus trap, name, focus return and inert page), closed before the promise resolves; the action runs after it in
// the caller, which shows its own pending state on its own button. Two questions asked together are asked one after the other.
//
// When the action should run INSIDE the dialog (a "Working..." button, the failure shown before it closes), keep using ConfirmDialog
// (`open`, `busy`, `onConfirm`, `onCancel`) controlled by the screen.
//
// `ConfirmProvider` sits once above the screens, next to ToastProvider (features/shell/components/home.tsx). In a test, wrap what you render
// in it (tests/support/confirm.tsx `withConfirm`).
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ConfirmDialog } from "./confirm-dialog";

export type ConfirmOptions = {
  title: string;
  /** What happens and what is kept. */
  message: ReactNode;
  /** The Confirm button's words, default "Confirm": name the action ("Delete announcement"), not "OK". */
  confirmLabel?: string;
  /** "destructive" makes Confirm the danger button. Default "default". */
  tone?: "default" | "destructive";
};

type Request = ConfirmOptions & { id: number; answer: (confirmed: boolean) => void };

const ConfirmApi = createContext<{ confirm: (options: ConfirmOptions) => Promise<boolean> } | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<Request[]>([]);
  const lastId = useRef(0);
  const latest = useRef(queue);
  useEffect(() => { latest.current = queue; });
  // A question still open when the provider goes away is a No: nothing is run on a screen that is no longer there.
  useEffect(() => () => latest.current.forEach((request) => request.answer(false)), []);

  const confirm = useCallback((options: ConfirmOptions) => new Promise<boolean>((resolve) => {
    setQueue((current) => [...current, { ...options, id: (lastId.current += 1), answer: resolve }]);
  }), []);
  const api = useMemo(() => ({ confirm }), [confirm]);

  const [asked, ...waiting] = queue;
  const reply = (confirmed: boolean) => { asked?.answer(confirmed); setQueue(waiting); };
  return <ConfirmApi.Provider value={api}>
    {children}
    <ConfirmDialog key={asked?.id ?? 0} open={Boolean(asked)} title={asked?.title ?? ""} confirmLabel={asked?.confirmLabel ?? "Confirm"} danger={asked?.tone === "destructive"}
      onConfirm={() => reply(true)} onCancel={() => reply(false)}>{asked?.message}</ConfirmDialog>
  </ConfirmApi.Provider>;
}

/** `{ confirm }`: the same function every render. Throws outside a ConfirmProvider. */
export function useConfirm(): { confirm: (options: ConfirmOptions) => Promise<boolean> } {
  const api = useContext(ConfirmApi);
  if (!api) throw new Error("useConfirm must be used inside a ConfirmProvider");
  return api;
}
