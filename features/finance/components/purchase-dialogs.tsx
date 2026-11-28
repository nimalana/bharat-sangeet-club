import type { FormEvent } from "react";
import type { EventOption, GroupOption } from "../../../lib/db";
import type { UploadItem } from "../../../components/ui/upload-progress";
import { ModalShell } from "./modal-shell";
import { PurchaseForm } from "./purchase-form";

type PurchaseDialogProps = {
  groups: GroupOption[]; events: EventOption[]; eventRelated: boolean; setEventRelated: (value: boolean) => void; saving: boolean;
  // The files being sent, whether the record is already saved (the button then says Upload again), and Retry for a failed file.
  uploads: UploadItem[]; recorded: boolean; onRetryUpload: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void; onClose: () => void;
};

// A member asks to be paid back for a purchase.
export function ReimbursementDialog({ groups, events, eventRelated, setEventRelated, saving, uploads, recorded, onRetryUpload, onSubmit, onClose }: PurchaseDialogProps) {
  return <ModalShell title="Request reimbursement" eyebrow="MEMBER PURCHASE" busy={saving} onClose={onClose}><PurchaseForm mode="member" groups={groups} events={events} eventRelated={eventRelated} setEventRelated={setEventRelated} saving={saving} uploads={uploads} recorded={recorded} onRetryUpload={onRetryUpload} onSubmit={onSubmit} /></ModalShell>;
}

// An executive records a purchase the club paid for itself.
export function ClubExpenseDialog({ groups, events, eventRelated, setEventRelated, saving, uploads, recorded, onRetryUpload, onSubmit, onClose }: PurchaseDialogProps) {
  return <ModalShell title="Record club expense" eyebrow="CLUB PURCHASE" busy={saving} onClose={onClose}><PurchaseForm mode="club" groups={groups} events={events} eventRelated={eventRelated} setEventRelated={setEventRelated} saving={saving} uploads={uploads} recorded={recorded} onRetryUpload={onRetryUpload} onSubmit={onSubmit} /></ModalShell>;
}
