import type { FormEvent } from "react";
import { clubToday, formatDay } from "../../../lib/dates";
import { formatMoney } from "../../../lib/format";
import type { Expense } from "../../../lib/api/finance";
import { ModalShell } from "./modal-shell";

// An executive groups expenses into a funding claim and attaches the funder's approval.
export function NewClaimDialog({ unclaimedExpenses, expenses, selectedClaimExpenses, setSelectedClaimExpenses, saving, onSubmit, onClose }: {
  unclaimedExpenses: Expense[]; expenses: Expense[]; selectedClaimExpenses: Set<number>; setSelectedClaimExpenses: (update: (current: Set<number>) => Set<number>) => void;
  saving: boolean; onSubmit: (event: FormEvent<HTMLFormElement>) => void; onClose: () => void;
}) {
  return <ModalShell title="Build a funding claim" eyebrow="SENATE / EXTERNAL FUNDING" onClose={onClose}><form onSubmit={onSubmit}><label>Claim title<input name="title" required placeholder="Fall concert food reimbursement" /></label><div className="form-pair"><label>Funding organization<input name="funder_name" defaultValue="GPSG Senate" required /></label><label>Submission deadline<input name="submission_deadline" type="date" /></label></div><div className="form-pair"><label>Award reference<input name="award_reference" placeholder="Award letter or request ID" /></label><label>HeelLife reference<input name="heellife_reference" placeholder="Form or submission ID" /></label></div><fieldset className="claim-expense-picker"><legend>Expenses included</legend>{unclaimedExpenses.length ? unclaimedExpenses.map((expense) => <label key={expense.id}><input type="checkbox" aria-label={`Include ${expense.description}`} checked={selectedClaimExpenses.has(expense.id)} onChange={(event) => setSelectedClaimExpenses((current) => { const next = new Set(current); if (event.target.checked) next.add(expense.id); else next.delete(expense.id); return next; })} /><span><b>{expense.description}</b><small>{formatDay(expense.purchase_date)} · {formatMoney(Number(expense.amount))}</small></span></label>) : <p>No unclaimed expenses are available.</p>}</fieldset><label>Proof of funding approval<input name="funding_approval" type="file" accept="application/pdf,image/jpeg,image/png" required /></label><label>Notes<textarea name="notes" rows={3} /></label><button className="primary modal-submit" disabled={saving || selectedClaimExpenses.size === 0}>{saving ? "Creating…" : `Create claim · ${formatMoney(expenses.filter((expense) => selectedClaimExpenses.has(expense.id)).reduce((sum, expense) => sum + Number(expense.amount), 0))}`}</button></form></ModalShell>;
}

// Money received from the funder against an approved claim.
export function ClaimPaymentDialog({ saving, onSubmit, onClose }: { saving: boolean; onSubmit: (event: FormEvent<HTMLFormElement>) => void; onClose: () => void }) {
  return <ModalShell title="Record funding payment" eyebrow="MONEY RECEIVED" onClose={onClose}><form onSubmit={onSubmit}><label>Amount received<input name="amount" type="number" min="0.01" step="0.01" required /></label><label>Date received<input name="payment_date" type="date" defaultValue={clubToday()} required /></label><label>Deposited into<input name="account_name" defaultValue="Club bank account" required /></label><button className="primary modal-submit" disabled={saving}>{saving ? "Saving…" : "Record payment"}</button></form></ModalShell>;
}
