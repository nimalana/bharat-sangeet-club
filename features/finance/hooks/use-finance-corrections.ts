"use client";

// The buttons that open a correction dialog. Each `ask...` puts one of the dialogs of features/finance/corrections.ts on screen
// (through the action runner's setAction); nothing is sent until the dialog is submitted.
import type { Expense, FinanceDocument, FundingClaim, Payment, Reimbursement } from "../../../lib/api/finance";
import { financeAvailable } from "../../../lib/api/finance";
import { useToast } from "../../../components/ui/toast";
import {
  addClaimExpenseAction, approveRequestAction, claimDecisionAction, declineRequestAction, editExpenseAction, editRequestAction, removeClaimExpenseAction,
  removeDocumentAction, requestChangesAction, voidClaimAction, voidExpenseAction, voidPaymentAction, withdrawRequestAction,
} from "../corrections";
import type { FinanceAction } from "../types";

export function useFinanceCorrections({ setAction, unclaimedExpenses }: { setAction: (action: FinanceAction) => void; unclaimedExpenses: Expense[] }) {
  const { notify } = useToast();
  // With no Supabase client nothing opens (the shell shows its setup screen then, so this is never seen).
  const show = (action: FinanceAction) => { if (financeAvailable()) setAction(action); };

  return {
    askVoidPayment: (payment: Payment) => show(voidPaymentAction(payment)),
    askVoidExpense: (expense: Expense) => show(voidExpenseAction(expense)),
    askEditExpense: (expense: Expense) => show(editExpenseAction(expense)),
    askEditRequest: (request: Reimbursement, expense: Expense) => show(editRequestAction(request, expense)),
    askWithdrawRequest: (request: Reimbursement) => show(withdrawRequestAction(request)),
    askApprove: (request: Reimbursement) => show(approveRequestAction(request)),
    askDecline: (request: Reimbursement) => show(declineRequestAction(request)),
    askRequestChanges: (request: Reimbursement) => show(requestChangesAction(request)),
    askRemoveDocument: (document: FinanceDocument) => show(removeDocumentAction(document)),
    askClaimDecision: (claim: FundingClaim, status: "approved" | "changes_requested" | "denied") => show(claimDecisionAction(claim, status)),
    askVoidClaim: (claim: FundingClaim) => show(voidClaimAction(claim)),
    askRemoveClaimExpense: (claim: FundingClaim, expense: Expense) => show(removeClaimExpenseAction(claim, expense)),
    askAddClaimExpense: (claim: FundingClaim) => {
      if (!financeAvailable()) return;
      if (!unclaimedExpenses.length) { notify("No unclaimed expenses are available", "error"); return; }
      setAction(addClaimExpenseAction(claim, unclaimedExpenses));
    },
  };
}
