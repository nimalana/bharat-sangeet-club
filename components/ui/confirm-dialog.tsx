"use client";

import { useRef, type ReactNode } from "react";
import { Button } from "./button";
import { Dialog } from "./dialog";

// The confirmation dialog for a destructive or hard-to-undo action, controlled by the screen (`open`, and `busy` while the action runs
// inside the dialog). `children` should say what happens and what is kept. Focus starts on Cancel, Escape and the backdrop cancel (not while
// `busy`). For a plain "are you sure?" that needs no state of its own, `useConfirm()` (components/ui/confirm.tsx) is shorter.
export function ConfirmDialog({ open, title, children, confirmLabel, danger = false, busy = false, onConfirm, onCancel }: {
  open: boolean; title: string; children: ReactNode; confirmLabel: string; danger?: boolean; busy?: boolean;
  onConfirm: () => void; onCancel: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  return <Dialog open={open} onClose={onCancel} dismissible={!busy} labelledBy="confirm-dialog-title" describedBy="confirm-dialog-text" initialFocus={cancelRef} className="max-w-[460px]">
    <h2 id="confirm-dialog-title" className="m-0 text-2xl">{title}</h2>
    <div id="confirm-dialog-text" className="mt-3 text-sm leading-relaxed text-[#4c5f6b]">{children}</div>
    <div className="mt-6 flex flex-wrap justify-end gap-2">
      <Button ref={cancelRef} variant="secondary" onClick={onCancel} disabled={busy}>Cancel</Button>
      <Button variant={danger ? "danger" : "primary"} onClick={onConfirm} disabled={busy}>{busy ? "Working…" : confirmLabel}</Button>
    </div>
  </Dialog>;
}
