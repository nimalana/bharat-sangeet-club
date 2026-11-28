import { useRef, type ReactNode } from "react";
import { Dialog } from "../../../components/ui/dialog";
import { IconButton } from "../../../components/ui/icon-button";

// The frame of every finance form: the portal's Dialog (role, name from the title, focus kept inside, Escape, focus back to the button that
// opened it) with the title and the close button. `busy` is a save in progress: neither Escape nor Close ends it then, so what is being
// sent cannot be walked away from. A click beside the dialog never closes it: it holds a form, and what was typed would be lost.
export function ModalShell({ eyebrow, title, onClose, busy = false, children }: { eyebrow: string; title: string; onClose: () => void; busy?: boolean; children: ReactNode }) {
  // Focus starts on the first field, not on Close: the person came here to fill the form in. (Found from the title, which is inside the dialog.)
  const firstField = useRef<HTMLElement | null>(null);
  const findFirstField = (heading: HTMLElement | null) => {
    firstField.current = heading?.closest('[role="dialog"]')?.querySelector<HTMLElement>("input:not([type=hidden]):not(:disabled), select:not(:disabled), textarea:not(:disabled)") ?? null;
  };
  return <Dialog open onClose={onClose} dismissible={!busy} closeOnBackdrop={false} labelledBy="finance-modal-title" initialFocus={firstField} className="modal finance-modal"><IconButton className="modal-close" aria-label="Close" disabled={busy} onClick={onClose}>×</IconButton><p className="eyebrow">{eyebrow}</p><h2 id="finance-modal-title" ref={findFirstField}>{title}</h2>{children}</Dialog>;
}
