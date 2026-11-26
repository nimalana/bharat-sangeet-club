"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { Button } from "./button";
import { Dialog } from "./dialog";

// One confirmation dialog for every destructive or hard-to-undo action.
// `children` should say what happens and what is kept.
export function ConfirmDialog({ open, title, children, confirmLabel, danger = false, busy = false, onConfirm, onCancel }: {
  open: boolean; title: string; children: ReactNode; confirmLabel: string; danger?: boolean; busy?: boolean;
  onConfirm: () => void; onCancel: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (open) cancelRef.current?.focus(); }, [open]);
  return <Dialog open={open} onClose={busy ? () => {} : onCancel} className="max-w-[460px]">
    <h2 id="confirm-dialog-title" className="m-0 text-2xl">{title}</h2>
    <div className="mt-3 text-sm leading-relaxed text-[#4c5f6b]">{children}</div>
    <div className="mt-6 flex flex-wrap justify-end gap-2">
      <Button ref={cancelRef} variant="secondary" onClick={onCancel} disabled={busy}>Cancel</Button>
      <Button variant={danger ? "danger" : "primary"} onClick={onConfirm} disabled={busy}>{busy ? "Working…" : confirmLabel}</Button>
    </div>
  </Dialog>;
}
