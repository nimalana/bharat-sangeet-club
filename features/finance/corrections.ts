// The correction dialogs of the finance screen, one per audited change. Each builder says what the dialog shows (title, wording,
// fields) and what pressing its button does (`run`: one function of lib/api/finance.ts, which throws an ApiError when the database
// refuses). Pure: nothing is sent until the dialog is submitted. Their sentences are what the person reads; do not reword them.
import type { FormField } from "../../components/ui/form-dialog";
import { formatMoney } from "../../lib/format";
import {
  addFundingClaimExpense, approveFundingClaim, approveReimbursement, declineReimbursement, recordFundingClaimDecision, removeFinanceDocument,
  removeFundingClaimExpense, requestReimbursementChanges, updateFinanceExpense, updateMemberReimbursement, voidFinanceExpense, voidFinancePayment,
  voidFundingClaim, withdrawMemberReimbursement,
} from "../../lib/api/finance";
import type { Expense, FinanceDocument, FundingClaim, Payment, Reimbursement } from "../../lib/api/finance";
import { FILE_LEFT_IN_STORAGE, expenseCategories } from "./constants";
import type { FinanceAction } from "./types";

const reasonField = (label = "Reason"): FormField => ({ name: "reason", label, type: "textarea", required: true, minLength: 3, maxLength: 500, placeholder: "Kept in the audit trail" });

export function voidPaymentAction(payment: Payment): FinanceAction {
  const effect = payment.purpose === "member_reimbursement" ? "The reimbursement goes back to approved so it can be paid again."
    : payment.purpose === "external_reimbursement" ? "The funding claim's received amount is reduced."
    : payment.purpose === "direct_expense" ? "The club expense it paid for is voided too." : "It stops counting toward available cash.";
  return { title: "Void this payment?", description: `${payment.description} · ${formatMoney(Number(payment.amount))}. ${effect} Nothing is deleted.`, fields: [reasonField()], submitLabel: "Void payment", danger: true, success: "Payment voided",
    run: (values) => voidFinancePayment(payment.id, values.reason) };
}

export function voidExpenseAction(expense: Expense): FinanceAction {
  return { title: "Void this expense?", description: `${expense.description} · ${formatMoney(Number(expense.amount))}. ${expense.paid_by === "club" ? "Its payment is voided with it." : "The member's reimbursement request is voided with it."} Nothing is deleted.`, fields: [reasonField()], submitLabel: "Void expense", danger: true, success: "Expense voided",
    run: (values) => voidFinanceExpense(expense.id, values.reason) };
}

function expenseFields(expense: Expense, withMoney: boolean): FormField[] {
  return [
    { name: "description", label: "What was purchased?", defaultValue: expense.description, required: true, minLength: 2, maxLength: 500 },
    { name: "vendor", label: "Vendor", defaultValue: expense.vendor, maxLength: 200 },
    ...(withMoney ? [{ name: "amount", label: "Amount", type: "number" as const, defaultValue: String(expense.amount), required: true, min: 0.01, step: 0.01 }, { name: "purchase_date", label: "Exact purchase date", type: "date" as const, defaultValue: expense.purchase_date, required: true }] : []),
    { name: "category", label: "Category", type: "select", defaultValue: expense.category, options: [...new Set([expense.category, ...expenseCategories])].map((category) => ({ value: category, label: category })) },
    { name: "last4", label: "Card last four digits", defaultValue: expense.payment_card_last4 || "", pattern: "[0-9]{4}", maxLength: 4, required: withMoney },
  ];
}

// The details of an expense that an edit keeps (everything a correction form does not ask for stays as the expense has it).
const expenseDetails = (expense: Expense, values: Record<string, string>) => ({
  description: values.description, vendor: values.vendor, category: values.category, cardLast4: values.last4 || null,
  subgroupId: expense.subgroup_id, clubEventId: expense.club_event_id, eventRelated: expense.event_related, eventName: expense.event_name,
  eventStartsAt: expense.event_starts_at, eventAttendeeCount: expense.event_attendee_count, eventSchedule: expense.event_schedule,
});

export function editExpenseAction(expense: Expense): FinanceAction {
  return { title: "Edit expense details", description: "The amount and date cannot be changed here. To correct those, void the expense and enter it again.", fields: expenseFields(expense, false), submitLabel: "Save changes", success: "Expense updated",
    run: (values) => updateFinanceExpense(expense.id, expenseDetails(expense, values)) };
}

export function editRequestAction(request: Reimbursement, expense: Expense): FinanceAction {
  return { title: "Edit my request", description: request.status === "changes_requested" ? "Saving sends the request back for review." : undefined,
    fields: [...expenseFields(expense, true), { name: "note", label: "Note for the reviewer", type: "textarea", defaultValue: request.member_note, maxLength: 1000 }], submitLabel: request.status === "changes_requested" ? "Save and resubmit" : "Save changes", success: "Request updated",
    run: (values) => updateMemberReimbursement(request.id, { ...expenseDetails(expense, values), cardLast4: values.last4 }, { amount: Number(values.amount), purchaseDate: values.purchase_date, memberNote: values.note }) };
}

export function withdrawRequestAction(request: Reimbursement): FinanceAction {
  return { title: "Withdraw this request?", description: "It will not be reviewed or paid. You can submit a new request later.", fields: [], submitLabel: "Withdraw request", danger: true, success: "Request withdrawn",
    run: () => withdrawMemberReimbursement(request.id) };
}

export function approveRequestAction(request: Reimbursement): FinanceAction {
  return { title: "Approve reimbursement", description: `Requested: ${formatMoney(Number(request.requested_amount))}. Lower the amount to approve part of it.`,
    fields: [{ name: "amount", label: "Amount to approve", type: "number", defaultValue: String(request.requested_amount), required: true, min: 0.01, max: Number(request.requested_amount), step: 0.01 }, { name: "note", label: "Note to the member (optional)", type: "textarea", maxLength: 1000 }], submitLabel: "Approve", success: "Reimbursement approved",
    run: (values) => approveReimbursement(request.id, Number(values.amount), values.note) };
}

export function declineRequestAction(request: Reimbursement): FinanceAction {
  return { title: "Decline this request?", fields: [{ ...reasonField("Reason shown to the member"), name: "note" }], submitLabel: "Decline", danger: true, success: "Reimbursement declined",
    run: (values) => declineReimbursement(request.id, values.note) };
}

export function requestChangesAction(request: Reimbursement): FinanceAction {
  return { title: "Ask the member for changes", description: "The member can edit the request or replace the receipt and send it back.", fields: [{ ...reasonField("What needs to change?"), name: "note" }], submitLabel: "Request changes", success: "Changes requested",
    run: (values) => requestReimbursementChanges(request.id, values.note) };
}

export function removeDocumentAction(document: FinanceDocument): FinanceAction {
  return { title: "Remove this document?", description: `"${document.title}" will be deleted. Add the replacement first if this is the only receipt.`, fields: [], submitLabel: "Remove document", danger: true, success: "Document removed",
    run: async () => {
      // The record goes first; the file is cleaned up after. Storage answers a refused delete with an
      // empty list and no error, so an empty answer is a failure to report, not a success. The record
      // is already gone by now, so the dialog still closes. Whatever went wrong with the file (refused,
      // a storage error, no network), the warning says the record is removed and the file is still
      // stored; the person is never told to retry. A deleted file (the usual case: the uploader and
      // the executives can delete an unregistered object) gives no warning.
      const { fileLeft } = await removeFinanceDocument(document.id, { refusedMessage: FILE_LEFT_IN_STORAGE, failedMessage: FILE_LEFT_IN_STORAGE });
      return { warning: fileLeft ?? undefined };
    } };
}

export function claimDecisionAction(claim: FundingClaim, status: "approved" | "changes_requested" | "denied"): FinanceAction {
  if (status === "approved") {
    return { title: "Record the funder's approval", description: `Requested: ${formatMoney(Number(claim.requested_amount))}.`, fields: [{ name: "amount", label: "Amount approved", type: "number", defaultValue: String(claim.requested_amount), required: true, min: 0.01, max: Number(claim.requested_amount), step: 0.01 }, { name: "note", label: "Note (optional)", type: "textarea" }], submitLabel: "Mark approved", success: "Claim approved",
      run: (values) => approveFundingClaim(claim.id, Number(values.amount), values.note) };
  }
  return { title: status === "denied" ? "Mark this claim denied?" : "The funder asked for changes", fields: [{ ...reasonField(status === "denied" ? "What did the funder say?" : "What do they need?"), name: "note" }], submitLabel: status === "denied" ? "Mark denied" : "Reopen claim", danger: status === "denied", success: "Funding claim updated",
    run: (values) => recordFundingClaimDecision(claim.id, status, values.note) };
}

export function voidClaimAction(claim: FundingClaim): FinanceAction {
  return { title: "Void this funding claim?", description: "Its expenses are released so they can go on another claim. A claim with money received must have those payments voided first.", fields: [reasonField()], submitLabel: "Void claim", danger: true, success: "Funding claim voided",
    run: (values) => voidFundingClaim(claim.id, values.reason) };
}

export function removeClaimExpenseAction(claim: FundingClaim, expense: Expense): FinanceAction {
  return { title: "Remove this expense from the claim?", description: `${expense.description} · ${formatMoney(Number(expense.amount))}. The claim total is reduced.`, fields: [], submitLabel: "Remove from claim", success: "Expense removed from the claim",
    run: () => removeFundingClaimExpense(claim.id, expense.id) };
}

export function addClaimExpenseAction(claim: FundingClaim, unclaimedExpenses: Expense[]): FinanceAction {
  return { title: "Add an expense to this claim", fields: [{ name: "expense_id", label: "Expense", type: "select", required: true, options: unclaimedExpenses.map((expense) => ({ value: String(expense.id), label: `${expense.description} · ${formatMoney(Number(expense.amount))}` })) }], submitLabel: "Add to claim", success: "Expense added to the claim",
    run: (values) => addFundingClaimExpense(claim.id, Number(values.expense_id)) };
}
