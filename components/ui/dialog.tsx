"use client";

import { useEffect, type ReactNode } from "react";
import { cn } from "../../lib/utils";

export function Dialog({ open, onClose, children, className }: { open: boolean; onClose: () => void; children: ReactNode; className?: string }) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose, open]);

  if (!open) return null;
  return <div className="fixed inset-0 z-[60] grid place-items-center bg-[rgba(23,37,47,.72)] p-4"><div role="dialog" aria-modal="true" className={cn("max-h-[calc(100vh-2rem)] w-full max-w-[700px] overflow-y-auto border border-[var(--ink)] bg-[var(--ivory)] p-6 text-[var(--ink)] shadow-[14px_18px_40px_rgba(23,37,47,.2)] sm:p-9", className)}>{children}</div></div>;
}
