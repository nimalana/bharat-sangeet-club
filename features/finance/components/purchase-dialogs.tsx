import type { FormEvent } from "react";
import type { EventOption, GroupOption } from "../../../lib/db";
import { ModalShell } from "./modal-shell";
import { PurchaseForm } from "./purchase-form";

type PurchaseDialogProps = {
  groups: GroupOption[]; events: EventOption[]; eventRelated: boolean; setEventRelated: (value: boolean) => void; saving: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void; onClose: () => void;
};

// A member asks to be paid back for a purchase.
export function ReimbursementDialog({ groups, events, eventRelated, setEventRelated, saving, onSubmit, onClose }: PurchaseDialogProps) {
  return <ModalShell title="Request reimbursement" eyebrow="MEMBER PURCHASE" onClose={onClose}><PurchaseForm mode="member" groups={groups} events={events} eventRelated={eventRelated} setEventRelated={setEventRelated} saving={saving} onSubmit={onSubmit} /></ModalShell>;
}

// An executive records a purchase the club paid for itself.
export function ClubExpenseDialog({ groups, events, eventRelated, setEventRelated, saving, onSubmit, onClose }: PurchaseDialogProps) {
  return <ModalShell title="Record club expense" eyebrow="CLUB PURCHASE" onClose={onClose}><PurchaseForm mode="club" groups={groups} events={events} eventRelated={eventRelated} setEventRelated={setEventRelated} saving={saving} onSubmit={onSubmit} /></ModalShell>;
}
