import type { ReactNode } from "react";
import { Button } from "../../../components/ui/button";
import { Dialog } from "../../../components/ui/dialog";

export function ModalShell({ eyebrow, title, onClose, children }: { eyebrow: string; title: string; onClose: () => void; children: ReactNode }) {
  return <Dialog open onClose={onClose} className="modal finance-modal"><Button variant="ghost" size="sm" className="modal-close" aria-label="Close" onClick={onClose}>×</Button><p className="eyebrow">{eyebrow}</p><h2 id="finance-modal-title">{title}</h2>{children}</Dialog>;
}
