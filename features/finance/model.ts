// What the finance screen works out from the rows it loaded. Pure: no React, no Supabase.
//
// The totals here are the FALLBACK of the cards: when the database's own totals (get_finance_summary) are missing, the cards show
// sums of the loaded lists, which are capped at the latest 500 rows. The totals themselves are read in use-finance-data.ts.

import type { Expense, FinanceDocument, FinanceWave, FundingClaim, Payment, Reimbursement } from "../../lib/api/finance";
import type { Profile } from "../../lib/db";
import type { FinanceSnapshot, FinanceSummary } from "./types";

/** The snapshot of a screen opened again: the cached lists, an empty one for anything the cache does not hold. */
export function snapshotFromCache(cached: FinanceSnapshot | undefined): FinanceSnapshot {
  return {
    expenses: cached?.expenses || [],
    reimbursements: cached?.reimbursements || [],
    payments: cached?.payments || [],
    documents: cached?.documents || [],
    expenseDocuments: cached?.expenseDocuments || [],
    reimbursementDocuments: cached?.reimbursementDocuments || [],
    claims: cached?.claims || [],
    claimExpenses: cached?.claimExpenses || [],
    claimDocuments: cached?.claimDocuments || [],
    profiles: cached?.profiles || [],
    summary: cached?.summary ?? null,
  };
}

/** The snapshot a wave of answers comes to. Call it only for a wave that passed the failure check (lib/finance-load.ts). */
export function buildSnapshot(wave: FinanceWave): FinanceSnapshot {
  return {
    expenses: wave.expenses.data || [],
    reimbursements: wave.reimbursements.data || [],
    payments: wave.payments.data || [],
    documents: wave.documents.data || [],
    expenseDocuments: wave.expenseDocuments.data || [],
    reimbursementDocuments: wave.reimbursementDocuments.data || [],
    claims: wave.claims.data || [],
    claimExpenses: wave.claimExpenses.data || [],
    claimDocuments: wave.claimDocuments.data || [],
    profiles: wave.profiles.data || [],
    // The totals arrive as a JSON object whose numbers may be text.
    summary: wave.summary.error || !wave.summary.data ? null : Object.fromEntries(Object.entries(wave.summary.data as Record<string, unknown>).map(([key, value]) => [key, Number(value)])) as FinanceSummary,
  };
}

type ChecklistItem = { label: string; done: boolean };
export type ClaimChecklist = { checks: ChecklistItem[]; complete: boolean; linkedExpenses: Expense[] };

// A claim can be edited (documents, expenses) until the funder has it.
export const claimEditable = (claim: FundingClaim) => ["draft", "incomplete", "ready", "changes_requested"].includes(claim.status);

/** Everything the screen derives from a snapshot, in one pass (memoize on the snapshot). */
export function deriveFinance(snapshot: FinanceSnapshot) {
  const { expenses, reimbursements, payments, documents, expenseDocuments, claims, claimExpenses, claimDocuments, profiles } = snapshot;
  const expenseById = new Map<number, Expense>(expenses.map((expense) => [expense.id, expense]));
  const profileById = new Map<string, Profile>(profiles.map((profile) => [profile.id, profile]));
  const documentById = new Map<number, FinanceDocument>(documents.map((document) => [document.id, document]));
  // Expenses on a claim the funder has (submitted, decided or paid): their details are locked in the database.
  const statusByClaim = new Map(claims.map((claim) => [claim.id, claim.status]));
  const open = ["draft", "incomplete", "ready", "changes_requested", "voided"];
  const lockedExpenseIds = new Set(claimExpenses.filter((link) => { const status = statusByClaim.get(link.claim_id); return Boolean(status) && !open.includes(status as string); }).map((link) => link.expense_id));
  const activePayments = payments.filter((payment) => payment.status !== "voided");
  const countedPayments = activePayments.filter((payment) => ["posted", "cleared"].includes(payment.status));
  const balance = countedPayments.reduce((total, payment) => total + (payment.direction === "inflow" ? Number(payment.amount) : -Number(payment.amount)), 0);
  const income = countedPayments.filter((payment) => payment.direction === "inflow").reduce((total, payment) => total + Number(payment.amount), 0);
  const spending = expenses.filter((expense) => ["approved", "settled"].includes(expense.status)).reduce((total, expense) => total + Number(expense.amount), 0);
  const pendingReimbursements: Reimbursement[] = reimbursements.filter((request) => ["submitted", "changes_requested", "approved"].includes(request.status));
  const pendingTotal = pendingReimbursements.reduce((total, request) => total + Number(request.approved_amount || request.requested_amount), 0);
  const expectedFunding = claims.filter((claim) => ["approved", "partially_paid"].includes(claim.status)).reduce((total, claim) => total + Math.max(0, Number(claim.approved_amount || 0) - Number(claim.received_amount)), 0);
  // Only approved or settled purchases can go on a claim (the database enforces the same rule).
  const unclaimedExpenses = expenses.filter((expense) => ["approved", "settled"].includes(expense.status) && !claimExpenses.some((item) => item.expense_id === expense.id && claims.some((claim) => claim.id === item.claim_id && claim.status !== "voided")));

  // The six things a claim needs before it can be marked ready.
  function claimChecklist(claim: FundingClaim): ClaimChecklist {
    const linkedExpenses = claimExpenses.filter((item) => item.claim_id === claim.id).map((item) => expenseById.get(item.expense_id)).filter(Boolean) as Expense[];
    const claimDocumentIds = new Set(claimDocuments.filter((item) => item.claim_id === claim.id).map((item) => item.document_id));
    const claimDocumentTypes = new Set([...claimDocumentIds].map((id) => documentById.get(id)?.document_type));
    const expenseDocumentTypes = (expenseId: number) => new Set(expenseDocuments.filter((item) => item.expense_id === expenseId).map((item) => documentById.get(item.document_id)?.document_type));
    const checks = [
      { label: "Exact purchase date on every expense", done: linkedExpenses.length > 0 && linkedExpenses.every((expense) => Boolean(expense.purchase_date)) },
      { label: "Receipt for every transaction", done: linkedExpenses.length > 0 && linkedExpenses.every((expense) => expenseDocumentTypes(expense.id).has("receipt")) },
      { label: "Payment card last four recorded", done: linkedExpenses.length > 0 && linkedExpenses.every((expense) => /^\d{4}$/.test(expense.payment_card_last4 || "")) },
      { label: "Bank or card statement PDF", done: claimDocumentTypes.has("bank_statement") || claimDocumentTypes.has("card_statement") },
      { label: "Event flyer/agenda and event details", done: linkedExpenses.filter((expense) => expense.event_related).every((expense) => Boolean(claimDocumentTypes.has("event_support") && expense.event_name && expense.event_starts_at && expense.event_attendee_count !== null && expense.event_schedule)) },
      { label: "GPSG/Senate funding approval", done: claimDocumentTypes.has("funding_approval") },
    ];
    return { checks, complete: checks.every((check) => check.done), linkedExpenses };
  }

  return { expenseById, profileById, documentById, lockedExpenseIds, activePayments, balance, income, spending, pendingReimbursements, pendingTotal, expectedFunding, unclaimedExpenses, claimChecklist };
}

export type FinanceDerived = ReturnType<typeof deriveFinance>;

/** The cash ledger's rows for a search text and a filter (a direction or a purpose, or "all"). */
export function filterPayments(activePayments: Payment[], query: string, flowFilter: string): Payment[] {
  return activePayments.filter((payment) => {
    const matchesQuery = `${payment.description} ${payment.category} ${payment.counterparty}`.toLowerCase().includes(query.toLowerCase());
    return matchesQuery && (flowFilter === "all" || payment.direction === flowFilter || payment.purpose === flowFilter);
  });
}
