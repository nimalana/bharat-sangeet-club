// What the detail dialog of a request, an expense or a payment says (plan 3.3): the facts of the record, who did what and when, and its
// documents. Pure: no React, no Supabase.
//
// The steps are read from the record's own columns (requested, reviewed, approved, declined, paid, voided: each with who and when). A member's
// timeline is built from their request's row alone (and the payment that settled it, which they may read), never from the audit log: that
// table is for executives (row-level security), and only the executive's dialog asks for it (lib/api/finance.ts, listFinanceAudit).
import { formatDateTime, formatDay } from "../../lib/dates";
import { formatMoney } from "../../lib/format";
import type { Expense, FinanceAuditEntity, FinanceAuditRow, Payment, Reimbursement } from "../../lib/api/finance";
import type { Profile } from "../../lib/db";
import type { FinanceSnapshot } from "./types";

type DetailKind = "request" | "expense" | "payment";
export type DetailTarget = { kind: DetailKind; id: number };

/** One step of a record's life. `pending` is the step that has not happened yet (what it is waiting for), not a fact about the past. */
type DetailStep = { id: string; label: string; who: string | null; at: string | null; note?: string; pending?: boolean };

export type Detail = {
  kind: DetailKind;
  id: number;
  eyebrow: string;
  title: string;
  status: string;
  /** The headline amount, as money. */
  amount: string;
  facts: Array<{ label: string; value: string }>;
  steps: DetailStep[];
  documentIds: number[];
  /** Which audit rows belong to this record (executives only). */
  audit: { entity: FinanceAuditEntity; id: number };
};

/** A person's name as the dialog shows it: you, a name from the profiles (an executive's screen has them), or what the role says. */
export type Who = (id: string | null | undefined) => string | null;

export function whoIs({ userId, canManage, profileById }: { userId: string; canManage: boolean; profileById: Map<string, Profile> }): Who {
  return (id) => {
    if (!id) return null;
    if (id === userId) return "You";
    const profile = profileById.get(id);
    if (profile) return profile.full_name || profile.email || "A member";
    // A member's screen has no profiles: whoever else acted on their request is an executive (only an executive can review, pay or void).
    return canManage ? "Another person" : "An executive";
  };
}

const DAY_ONLY = /^\d{4}-\d{2}-\d{2}$/;
/** A calendar day or an instant, as a sentence part. */
export const when = (value: string | null | undefined): string => (!value ? "" : DAY_ONLY.test(value) ? formatDay(value) : formatDateTime(value));

const money = (value: unknown) => formatMoney(Number(value));
const text = (value: string | null | undefined) => (value && value.trim() ? value.trim() : undefined);

/** Oldest first; a step with no time keeps its place after the ones that have one. */
function inOrder(steps: DetailStep[]): DetailStep[] {
  const time = (step: DetailStep) => (step.at ? new Date(DAY_ONLY.test(step.at) ? `${step.at}T12:00:00Z` : step.at).getTime() : Number.POSITIVE_INFINITY);
  return steps.map((step, index) => ({ step, index })).sort((a, b) => (time(a.step) - time(b.step)) || (a.index - b.index)).map((entry) => entry.step);
}

type Names = { who: Who; groupName: (id: number | null | undefined) => string | null };

function purchaseFacts(expense: Expense, names: Names, payerName: string): Detail["facts"] {
  const group = names.groupName(expense.subgroup_id);
  return [
    { label: "Purchased", value: `${expense.vendor || expense.category} · ${when(expense.purchase_date)}` },
    { label: "Category", value: expense.category },
    ...(expense.payment_card_last4 ? [{ label: "Card", value: `•••• ${expense.payment_card_last4}` }] : []),
    { label: "Paid by", value: payerName },
    ...(group ? [{ label: "Group", value: group }] : []),
    ...(expense.event_related && expense.event_name ? [{ label: "Event", value: expense.event_name }] : []),
  ];
}

/** The payments that settled a request or an expense, and the ones that were voided: each is a step. */
function paymentSteps(payments: Payment[], who: Who): DetailStep[] {
  return payments.flatMap((payment): DetailStep[] => {
    const what = `${money(payment.amount)} from ${payment.account_name}`;
    if (payment.status !== "voided") return [{ id: `paid-${payment.id}`, label: "Paid", who: who(payment.created_by), at: payment.created_at ?? payment.payment_date, note: what }];
    return [
      { id: `paid-${payment.id}`, label: "Paid", who: who(payment.created_by), at: payment.created_at ?? payment.payment_date, note: what },
      { id: `payment-voided-${payment.id}`, label: "Payment voided", who: who(payment.voided_by), at: payment.voided_at ?? null, note: text(payment.void_reason) },
    ];
  });
}

export function requestDetail({ request, expense, payments, documentIds, names, payerName }: {
  request: Reimbursement; expense: Expense | undefined; payments: Payment[]; documentIds: number[]; names: Names; payerName: string;
}): Detail {
  const { who } = names;
  const approved = request.approved_amount !== null && request.approved_amount !== undefined && Boolean(request.reviewed_at);
  const declined = request.status === "rejected" || Boolean(expense?.rejected_at);
  const steps: DetailStep[] = [{ id: "requested", label: "Requested", who: who(request.member_id), at: request.created_at, note: text(request.member_note) }];
  if (request.reviewed_at) {
    if (declined) steps.push({ id: "declined", label: "Declined", who: who(expense?.rejected_by ?? request.reviewed_by), at: expense?.rejected_at ?? request.reviewed_at, note: text(request.review_note) });
    else if (approved) steps.push({ id: "approved", label: `Approved for ${money(request.approved_amount)}`, who: who(request.reviewed_by), at: request.reviewed_at, note: text(request.review_note) });
    else steps.push({ id: "reviewed", label: request.status === "changes_requested" ? "Changes requested" : request.status === "submitted" ? "Changes were requested, then the request was sent again" : "Reviewed", who: who(request.reviewed_by), at: request.reviewed_at, note: text(request.review_note) });
  }
  const own = payments.filter((payment) => payment.reimbursement_id === request.id);
  steps.push(...paymentSteps(own, who));
  // The request's own paid_at, when no payment row is readable (or the payment was recorded before the dialog's rows were).
  if (request.paid_at && !own.some((payment) => payment.status !== "voided")) steps.push({ id: "paid", label: "Paid", who: null, at: request.paid_at });
  if (request.status === "voided") steps.push({ id: "voided", label: "Voided", who: who(request.voided_by), at: request.voided_at ?? null, note: text(request.void_reason) });
  const next = request.status === "submitted" ? "Waiting for a review"
    : request.status === "changes_requested" ? "Waiting for the request to be edited and sent again"
    : request.status === "approved" ? "Waiting for the payment" : null;
  const ordered = inOrder(steps);
  if (next) ordered.push({ id: "next", label: next, who: null, at: null, pending: true });

  return {
    kind: "request", id: request.id, eyebrow: "REIMBURSEMENT REQUEST", title: expense?.description || "Club purchase", status: request.status,
    amount: money(request.approved_amount ?? request.requested_amount),
    facts: [
      { label: "Requested", value: money(request.requested_amount) },
      ...(request.approved_amount !== null && request.approved_amount !== undefined ? [{ label: "Approved", value: money(request.approved_amount) }] : []),
      { label: "Requested by", value: who(request.member_id) ?? "A member" },
      ...(expense ? purchaseFacts(expense, names, payerName) : []),
    ],
    steps: ordered, documentIds, audit: { entity: "personal_reimbursements", id: request.id },
  };
}

export function expenseDetail({ expense, payments, documentIds, names, payerName }: {
  expense: Expense; payments: Payment[]; documentIds: number[]; names: Names; payerName: string;
}): Detail {
  const { who } = names;
  const steps: DetailStep[] = [{ id: "recorded", label: "Recorded", who: who(expense.created_by), at: expense.created_at ?? null }];
  if (expense.approved_at) steps.push({ id: "approved", label: "Approved", who: who(expense.approved_by), at: expense.approved_at });
  if (expense.rejected_at) steps.push({ id: "declined", label: "Declined", who: who(expense.rejected_by), at: expense.rejected_at });
  steps.push(...paymentSteps(payments.filter((payment) => payment.expense_id === expense.id), who));
  if (expense.status === "voided") steps.push({ id: "voided", label: "Voided", who: who(expense.voided_by), at: expense.voided_at ?? null, note: text(expense.void_reason) });
  const ordered = inOrder(steps);
  if (expense.status === "submitted") ordered.push({ id: "next", label: "Waiting for a review", who: null, at: null, pending: true });
  return {
    kind: "expense", id: expense.id, eyebrow: "EXPENSE", title: expense.description, status: expense.status, amount: money(expense.amount),
    facts: purchaseFacts(expense, names, payerName), steps: ordered, documentIds, audit: { entity: "finance_expenses", id: expense.id },
  };
}

const PURPOSES: Record<string, string> = { member_reimbursement: "Member reimbursement", external_reimbursement: "Funding received", direct_expense: "Club expense" };

export function paymentDetail({ payment, documentIds, names }: { payment: Payment; documentIds: number[]; names: Names }): Detail {
  const { who } = names;
  const steps: DetailStep[] = [{ id: "recorded", label: "Recorded", who: who(payment.created_by), at: payment.created_at ?? null }];
  if (payment.cleared_date) steps.push({ id: "cleared", label: "Cleared the bank", who: null, at: payment.cleared_date });
  if (payment.status === "voided") steps.push({ id: "voided", label: "Voided", who: who(payment.voided_by), at: payment.voided_at ?? null, note: text(payment.void_reason) });
  return {
    kind: "payment", id: payment.id, eyebrow: "PAYMENT", title: payment.description, status: payment.status, amount: `${payment.direction === "inflow" ? "+" : "−"}${money(payment.amount)}`,
    facts: [
      { label: "Direction", value: payment.direction === "inflow" ? "Money in" : "Money out" },
      { label: "Kind", value: PURPOSES[payment.purpose] ?? payment.purpose.replaceAll("_", " ") },
      { label: "Paid on", value: when(payment.payment_date) },
      { label: "Account", value: payment.account_name },
      ...(payment.counterparty ? [{ label: "With", value: payment.counterparty }] : []),
      { label: "Category", value: payment.category },
    ],
    steps: inOrder(steps), documentIds, audit: { entity: "finance_payments", id: payment.id },
  };
}

// ---------------------------------------------------------------- the audit history (executives)

export type AuditLine = { id: number; label: string; who: string | null; at: string; changes: string[] };

const ACTIONS: Record<string, string> = { insert: "Created", update: "Changed", delete: "Deleted", approved: "Approved", rejected: "Declined" };

// What an audit row says changed, in words. Only the fields a person reads (never an id or a user's id), money as money.
const FIELDS: Record<string, { label: string; money?: boolean }> = {
  status: { label: "Status" }, amount: { label: "Amount", money: true }, requested_amount: { label: "Requested", money: true },
  approved_amount: { label: "Approved", money: true }, received_amount: { label: "Received", money: true }, review_note: { label: "Reviewer's note" },
  member_note: { label: "Member's note" }, void_reason: { label: "Reason" }, description: { label: "Description" }, vendor: { label: "Vendor" },
  category: { label: "Category" }, account_name: { label: "Account" }, counterparty: { label: "With" }, payment_date: { label: "Paid on" }, purchase_date: { label: "Purchased" },
};

const shown = (key: string, value: unknown): string => {
  if (value === null || value === undefined || value === "") return "none";
  if (FIELDS[key]?.money && !Number.isNaN(Number(value))) return money(value);
  if (key.endsWith("_date") && typeof value === "string") return when(value);
  return String(value);
};

function changesOf(before: unknown, after: unknown, action: string): string[] {
  const from = (before && typeof before === "object" ? before : {}) as Record<string, unknown>;
  const to = (after && typeof after === "object" ? after : {}) as Record<string, unknown>;
  const present = (row: Record<string, unknown>, key: string) => row[key] !== undefined && row[key] !== null && row[key] !== "";
  const keys = Object.keys(FIELDS);
  // A created row has no "before": say what it started as. A deleted one has no "after": say what it was. Any other row: what differs. A
  // decision row the database wrote itself (approved, rejected) names only the fields it decided, so a field only in "before" is not a change.
  const lines = action === "insert" ? keys.filter((key) => present(to, key)).map((key) => `${FIELDS[key].label}: ${shown(key, to[key])}`)
    : action === "delete" ? keys.filter((key) => present(from, key)).map((key) => `${FIELDS[key].label}: ${shown(key, from[key])}`)
    : keys.filter((key) => key in to && JSON.stringify(from[key] ?? null) !== JSON.stringify(to[key] ?? null)).map((key) => `${FIELDS[key].label}: ${shown(key, from[key])} → ${shown(key, to[key])}`);
  return lines.slice(0, 6);
}

export function auditLines(rows: FinanceAuditRow[], who: Who): AuditLine[] {
  return rows.map((row) => ({
    id: row.id, label: ACTIONS[row.action] ?? row.action.replaceAll("_", " "), who: who(row.actor_id), at: row.created_at,
    changes: changesOf(row.before_data, row.after_data, row.action),
  }));
}

// ---------------------------------------------------------------- finding the record a link names

/** The rows `buildDetail` reads: the screen's snapshot, the people it knows, and how to name a person and a group. */
export type DetailSource = {
  snapshot: Pick<FinanceSnapshot, "expenses" | "reimbursements" | "payments" | "documents" | "expenseDocuments" | "reimbursementDocuments" | "claimDocuments">;
  names: Names;
};

const unique = (ids: number[]) => [...new Set(ids)];

/** The detail of the record `target` names, or null when the screen has no such record (a link to one that is not here or not theirs). */
export function buildDetail(target: DetailTarget, { snapshot, names }: DetailSource): Detail | null {
  const { expenses, reimbursements, payments, documents, expenseDocuments, reimbursementDocuments, claimDocuments } = snapshot;
  const known = new Set(documents.map((document) => document.id));
  const kept = (ids: number[]) => unique(ids).filter((id) => known.has(id));
  const payerOf = (expense: Expense) => (expense.paid_by === "member" ? names.who(expense.paid_by_member_id) ?? "A member" : "Club account");
  const ofExpense = (expenseId: number) => expenseDocuments.filter((link) => link.expense_id === expenseId).map((link) => link.document_id);
  const ofRequest = (requestId: number) => reimbursementDocuments.filter((link) => link.reimbursement_id === requestId).map((link) => link.document_id);

  if (target.kind === "request") {
    const request = reimbursements.find((item) => item.id === target.id);
    if (!request) return null;
    const expense = expenses.find((item) => item.id === request.expense_id);
    return requestDetail({ request, expense, payments, names, payerName: expense ? payerOf(expense) : "A member", documentIds: kept([...ofRequest(request.id), ...ofExpense(request.expense_id)]) });
  }
  if (target.kind === "expense") {
    const expense = expenses.find((item) => item.id === target.id);
    if (!expense) return null;
    const requests = reimbursements.filter((item) => item.expense_id === expense.id);
    return expenseDetail({ expense, payments, names, payerName: payerOf(expense), documentIds: kept([...ofExpense(expense.id), ...requests.flatMap((request) => ofRequest(request.id))]) });
  }
  const payment = payments.find((item) => item.id === target.id);
  if (!payment) return null;
  const claimIds = payment.funding_claim_id ? claimDocuments.filter((link) => link.claim_id === payment.funding_claim_id).map((link) => link.document_id) : [];
  const expenseIds = payment.expense_id ? ofExpense(payment.expense_id) : [];
  return paymentDetail({ payment, names, documentIds: kept([...expenseIds, ...claimIds]) });
}
