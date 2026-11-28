// Types the finance screen's pieces share. The rows of the finance tables are in lib/api/finance.ts.
import type { Profile } from "../../lib/db";
import type { ClaimDocument, ClaimExpense, ExpenseDocument, Expense, FinanceDocument, FundingClaim, Payment, Reimbursement, ReimbursementDocument } from "../../lib/api/finance";
import type { FormField } from "../../components/ui/form-dialog";

export type FinanceView = "overview" | "expenses" | "reimbursements" | "claims";
// The cash ledger's activity filter: everything, a direction, or one purpose.
export type FinanceFlow = "all" | "inflow" | "outflow" | "member_reimbursement" | "external_reimbursement";
export type FinanceModal = "reimbursement" | "expense" | "income" | "claim" | null;
// One-click changes that need a yes first: paying out money, and sending a claim to the funder (it cannot go back to editing).
export type FinanceConfirm = { kind: "pay"; request: Reimbursement } | { kind: "submit"; claim: FundingClaim } | null;

// The database's own totals (get_finance_summary), each value read with Number().
export type FinanceSummary = { available_cash: number; income: number; spending: number; pending_reimbursement_total: number; pending_reimbursement_count: number; expected_funding: number };

// Everything the eleven reads of the screen come to; this is also what the screen's cache keeps.
export type FinanceSnapshot = {
  expenses: Expense[]; reimbursements: Reimbursement[]; payments: Payment[]; documents: FinanceDocument[];
  expenseDocuments: ExpenseDocument[]; reimbursementDocuments: ReimbursementDocument[];
  claims: FundingClaim[]; claimExpenses: ClaimExpense[]; claimDocuments: ClaimDocument[];
  profiles: Profile[]; summary: FinanceSummary | null;
};

// What a correction dialog's action answers when it went through. `warning` is for a change that went through but left something
// undone; it is shown instead of the success message. A change the database refuses throws an ApiError instead.
export type ActionOutcome = { warning?: string } | void;
export type FinanceAction = {
  title: string; description?: string; fields: FormField[]; submitLabel: string; danger?: boolean; success: string;
  run: (values: Record<string, string>) => Promise<ActionOutcome>;
};
