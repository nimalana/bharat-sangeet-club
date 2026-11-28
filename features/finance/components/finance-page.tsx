"use client";

// The Finance screen. A manager (an executive or an administrator) sees the club's money: the cash ledger, the expense register, the
// members' reimbursement requests and the funding claims. Anyone else sees their own requests and can submit one.
//
// This file only puts the pieces together. The data (the eleven reads, the cache, the failed-refresh rules) is hooks/use-finance-data.ts;
// the forms are hooks/use-finance-forms.ts; the one-click changes (Mark paid, claim status) are hooks/use-one-click-changes.ts and the
// correction dialog is hooks/use-action-runner.ts: those two share one single flight, so only one change runs at a time. Every call to
// Supabase is in lib/api/finance.ts.
import type { User } from "@supabase/supabase-js";
import { useMemo, useState } from "react";
import { canManageClub } from "../../../lib/permissions";
import { createSingleFlight } from "../../../lib/single-flight";
import type { ClubRole } from "../../../lib/db";
import { LoadErrorBanner } from "../../../components/ui/load-error";
import { LoadingBlock } from "../../../components/ui/loading-block";
import { useFinanceCorrections } from "../hooks/use-finance-corrections";
import { useFinanceData } from "../hooks/use-finance-data";
import { useFinanceDocuments } from "../hooks/use-finance-documents";
import { useFinanceForms } from "../hooks/use-finance-forms";
import { useActionRunner } from "../hooks/use-action-runner";
import { useOneClickChanges } from "../hooks/use-one-click-changes";
import { deriveFinance, filterPayments } from "../model";
import type { ClubEvent, FinanceView, Subgroup } from "../types";
import { FinanceChangeDialogs } from "./change-dialogs";
import { ClaimPaymentDialog, NewClaimDialog } from "./claim-dialogs";
import { ClaimDocumentDialog, ReceiptDialog } from "./document-dialogs";
import { ExpenseRegister } from "./expense-register";
import { FinanceOverview } from "./finance-overview";
import { FinanceTitleRow } from "./finance-title-row";
import { FundingClaims } from "./funding-claims";
import { IncomeDialog } from "./income-dialog";
import { ClubExpenseDialog, ReimbursementDialog } from "./purchase-dialogs";
import { ReimbursementList } from "./reimbursement-list";
import { FinanceSummaryCards } from "./summary-cards";

export function FinancePage({ user, role, groups, events }: {
  user: User;
  role: ClubRole;
  groups: Subgroup[];
  events: ClubEvent[];
}) {
  const canManage = canManageClub(role);
  const [view, setView] = useState<FinanceView>(canManage ? "overview" : "reimbursements");
  const [query, setQuery] = useState("");
  const [flowFilter, setFlowFilter] = useState("all");
  // The one-click changes and the correction dialog run one at a time: they share this single flight.
  const [flight] = useState(createSingleFlight);

  const { snapshot, loading, loaded, loadFailed, loadFinance, refreshAfterChange } = useFinanceData({ userId: user.id, canManage });
  const { expenses, reimbursements, payments, claims, reimbursementDocuments, summary } = snapshot;
  const finance = useMemo(() => deriveFinance(snapshot), [snapshot]);
  const { expenseById, profileById, documentById, lockedExpenseIds, activePayments, pendingReimbursements, unclaimedExpenses, claimChecklist } = finance;

  const { uploadDocument, openDocument } = useFinanceDocuments({ userId: user.id, documentById });
  const forms = useFinanceForms({ reimbursements, uploadDocument, refreshAfterChange, loadFinance });
  const changes = useOneClickChanges({ flight, refreshAfterChange, isClaimComplete: (claim) => claimChecklist(claim).complete });
  const runner = useActionRunner({ flight, refreshAfterChange });
  const ask = useFinanceCorrections({ setAction: runner.setAction, unclaimedExpenses });

  const { pendingKey, setConfirming } = changes;
  // While any change is running, the buttons that start another one are off.
  const changing = Boolean(pendingKey) || runner.actionBusy;
  const filteredPayments = filterPayments(activePayments, query, flowFilter);
  const { modal, setModal, claimUploadId, setClaimUploadId, claimPaymentId, setClaimPaymentId, receiptRequestId, setReceiptRequestId, saving, eventRelated, setEventRelated, selectedClaimExpenses, setSelectedClaimExpenses } = forms;

  return <section className="section-shell page-section finance-page">
    <FinanceTitleRow canManage={canManage} setModal={setModal} />
    {loadFailed && <LoadErrorBanner message={loaded ? "Some finance records could not be refreshed, so the figures below may be out of date." : "The finance records could not be loaded."} onRetry={() => void loadFinance()} />}
    {(loaded || !loadFailed) && <>

    <FinanceSummaryCards canManage={canManage} summary={summary} reimbursements={reimbursements} finance={finance} />

    <div className="finance-tabs" role="tablist">{(canManage ? ["overview", "expenses", "reimbursements", "claims"] : ["reimbursements"] as FinanceView[]).map((item) => <button key={item} role="tab" aria-selected={view === item} className={view === item ? "active" : ""} onClick={() => setView(item as FinanceView)}>{item === "claims" ? "Funding claims" : item}</button>)}</div>

    {loading ? <LoadingBlock>Loading finance workspace…</LoadingBlock> : <>
      {canManage && view === "overview" && <FinanceOverview payments={payments} filteredPayments={filteredPayments} query={query} setQuery={setQuery} flowFilter={flowFilter} setFlowFilter={setFlowFilter} askVoidPayment={ask.askVoidPayment} changing={changing} pendingReimbursements={pendingReimbursements} expenseById={expenseById} claims={claims} claimChecklist={claimChecklist} setView={setView} />}

      {canManage && view === "expenses" && <ExpenseRegister expenses={expenses} profileById={profileById} lockedExpenseIds={lockedExpenseIds} changing={changing} askEditExpense={ask.askEditExpense} askVoidExpense={ask.askVoidExpense} />}

      {view === "reimbursements" && <ReimbursementList user={user} canManage={canManage} reimbursements={reimbursements} reimbursementDocuments={reimbursementDocuments} expenseById={expenseById} profileById={profileById} documentById={documentById} activePayments={activePayments} changing={changing} pendingKey={pendingKey} openDocument={openDocument} askRemoveDocument={ask.askRemoveDocument} setReceiptRequestId={setReceiptRequestId} askEditRequest={ask.askEditRequest} askWithdrawRequest={ask.askWithdrawRequest} askDecline={ask.askDecline} askRequestChanges={ask.askRequestChanges} askApprove={ask.askApprove} setConfirming={setConfirming} askVoidPayment={ask.askVoidPayment} askVoidExpense={ask.askVoidExpense} />}

      {canManage && view === "claims" && <FundingClaims claims={claims} claimChecklist={claimChecklist} changing={changing} pendingKey={pendingKey} setModal={setModal} setClaimUploadId={setClaimUploadId} setClaimPaymentId={setClaimPaymentId} setConfirming={setConfirming} updateClaimStatus={changes.updateClaimStatus} askClaimDecision={ask.askClaimDecision} askVoidClaim={ask.askVoidClaim} askRemoveClaimExpense={ask.askRemoveClaimExpense} askAddClaimExpense={ask.askAddClaimExpense} />}
    </>}
    </>}

    {modal === "reimbursement" && <ReimbursementDialog groups={groups} events={events} eventRelated={eventRelated} setEventRelated={setEventRelated} saving={saving} onSubmit={forms.submitReimbursement} onClose={() => { setModal(null); setEventRelated(false); }} />}
    {modal === "expense" && <ClubExpenseDialog groups={groups} events={events} eventRelated={eventRelated} setEventRelated={setEventRelated} saving={saving} onSubmit={forms.recordExpense} onClose={() => { setModal(null); setEventRelated(false); }} />}
    {modal === "income" && <IncomeDialog saving={saving} onSubmit={forms.recordIncome} onClose={() => setModal(null)} />}
    {modal === "claim" && <NewClaimDialog unclaimedExpenses={unclaimedExpenses} expenses={expenses} selectedClaimExpenses={selectedClaimExpenses} setSelectedClaimExpenses={setSelectedClaimExpenses} saving={saving} onSubmit={forms.createClaim} onClose={() => { setModal(null); setSelectedClaimExpenses(new Set()); }} />}
    {claimUploadId && <ClaimDocumentDialog saving={saving} onSubmit={forms.uploadClaimDocument} onClose={() => setClaimUploadId(null)} />}
    {claimPaymentId && <ClaimPaymentDialog saving={saving} onSubmit={forms.recordClaimPayment} onClose={() => setClaimPaymentId(null)} />}
    {receiptRequestId && <ReceiptDialog saving={saving} onSubmit={forms.uploadRequestReceipt} onClose={() => setReceiptRequestId(null)} />}
    <FinanceChangeDialogs confirming={changes.confirming} setConfirming={setConfirming} pendingKey={pendingKey} confirmChange={changes.confirmChange} profileById={profileById} expenseById={expenseById} action={runner.action} setAction={runner.setAction} actionBusy={runner.actionBusy} runAction={runner.runAction} />
  </section>;
}
