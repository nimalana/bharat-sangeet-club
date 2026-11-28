import type { FormEvent } from "react";
import { clubToday } from "../../../lib/dates";
import { incomeCategories } from "../constants";
import { ModalShell } from "./modal-shell";

// An executive records money the club received.
export function IncomeDialog({ saving, onSubmit, onClose }: { saving: boolean; onSubmit: (event: FormEvent<HTMLFormElement>) => void; onClose: () => void }) {
  return <ModalShell title="Record money received" eyebrow="INCOME" busy={saving} onClose={onClose}><form onSubmit={onSubmit}><label>Description<input name="description" required placeholder="Gig at Memorial Hall" /></label><div className="form-pair"><label>Amount<input name="amount" type="number" min="0.01" step="0.01" required /></label><label>Date received<input name="payment_date" type="date" defaultValue={clubToday()} required /></label></div><div className="form-pair"><label>Income source<select name="category" defaultValue="Gig revenue">{incomeCategories.map((category) => <option key={category}>{category}</option>)}</select></label><label>Paid by<input name="counterparty" placeholder="Client, donor, or customer" /></label></div><label>Deposited into<input name="account_name" defaultValue="Club bank account" required /></label><button className="primary modal-submit" disabled={saving} aria-busy={saving || undefined}>{saving ? "Saving…" : "Record income"}</button></form></ModalShell>;
}
