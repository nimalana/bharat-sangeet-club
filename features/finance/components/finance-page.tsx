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
import { useUrlState } from "../../../lib/hooks/use-url-state";
import { canManageClub } from "../../../lib/permissions";
import { createSingleFlight } from "../../../lib/single-flight";
import type { ClubRole, EventOption, GroupOption } from "../../../lib/db";
import { ErrorBlock } from "../../../components/ui/error-block";
import { PreviewDialog } from "../../../components/ui/preview-dialog";
import { LoadErrorBanner } from "../../../components/ui/load-error";
import { Skeleton, SkeletonRows } from "../../../components/ui/skeleton";
import { useFinanceCorrections } from "../hooks/use-finance-corrections";
import { useFinanceData } from "../hooks/use-finance-data";
import { useFinanceDocuments } from "../hooks/use-finance-documents";
import { useFinanceForms } from "../hooks/use-finance-forms";
import { useActionRunner } from "../hooks/use-action-runner";
import { useDetailTarget } from "../hooks/use-detail-target";
import { useOneClickChanges } from "../hooks/use-one-click-changes";
import { parseFlow, parseView } from "../address";
import { buildDetail, whoIs } from "../detail";
import { deriveFinance, filterPayments } from "../model";
import type { FinanceFlow, FinanceView } from "../types";
import { FinanceChangeDialogs } from "./change-dialogs";
import { ClaimPaymentDialog, NewClaimDialog } from "./claim-dialogs";
import { ClaimDocumentDialog, ReceiptDialog } from "./document-dialogs";
import { ExpenseRegister } from "./expense-register";
import { FinanceDetailDialog } from "./finance-detail";
import { FinanceOverview } from "./finance-overview";
import { FinanceTitleRow } from "./finance-title-row";
import { FundingClaims } from "./funding-claims";
import { IncomeDialog } from "./income-dialog";
import { ClubExpenseDialog, ReimbursementDialog } from "./purchase-dialogs";
import { ReimbursementList } from "./reimbursement-list";
import { FinancePanel, FinanceTabs } from "./finance-tabs";
import { FinanceSummaryCards } from "./summary-cards";

const MANAGER_VIEWS: FinanceView[] = ["overview", "expenses", "reimbursements", "claims"];
const MEMBER_VIEWS: FinanceView[] = ["reimbursements"];

export function FinancePage({ user, role, groups, events }: {
  user: User;
  role: ClubRole;
  groups: GroupOption[];
  events: EventOption[];
}) {
  const canManage = canManageClub(role);
  // The open tab and the ledger's activity filter are in the address (?tab=, ?flow=); what is typed in the search box is not.
  const [openTab, setView] = useUrlState<FinanceView>("tab", { parse: parseView, defaultValue: canManage ? "overview" : "reimbursements", history: "push" });
  const [flowFilter, setFlowFilter] = useUrlState<FinanceFlow>("flow", { parse: parseFlow, defaultValue: "all", history: "replace" });
  // A member has the one tab: a link to another is read as theirs, and the address is left alone.
  const view: FinanceView = canManage ? openTab : "reimbursements";
  const [query, setQuery] = useState("");
  // The one-click changes and the correction dialog run one at a time: they share this single flight.
  const [flight] = useState(createSingleFlight);

  const { snapshot, loading, loaded, loadFailed, retrying, retry, loadFinance, refreshAfterChange } = useFinanceData({ userId: user.id, canManage });
  const { expenses, reimbursements, payments, claims, reimbursementDocuments, claimDocuments, summary } = snapshot;
  const finance = useMemo(() => deriveFinance(snapshot), [snapshot]);
  const { expenseById, profileById, documentById, lockedExpenseIds, activePayments, pendingReimbursements, unclaimedExpenses, claimChecklist } = finance;

  const { uploadDocument, loadPreview } = useFinanceDocuments({ userId: user.id, documentById });
  // The document being previewed, and the record whose detail is open (that one is in the address: ?request=, ?expense= or ?payment=).
  const [previewId, setPreviewId] = useState<number | null>(null);
  const detailTarget = useDetailTarget();
  const who = useMemo(() => whoIs({ userId: user.id, canManage, profileById }), [user.id, canManage, profileById]);
  const detail = useMemo(
    () => (detailTarget.target ? buildDetail(detailTarget.target, { snapshot, names: { who, groupName: (id) => groups.find((group) => group.id === id)?.name ?? null } }) : null),
    [detailTarget.target, snapshot, who, groups],
  );
  const forms = useFinanceForms({ reimbursements, uploadDocument, refreshAfterChange, loadFinance });
  const changes = useOneClickChanges({ flight, refreshAfterChange, isClaimComplete: (claim) => claimChecklist(claim).complete });
  const runner = useActionRunner({ flight, refreshAfterChange });
  const ask = useFinanceCorrections({ setAction: runner.setAction, unclaimedExpenses });

  const { pendingKey, setConfirming } = changes;
  // While any change is running, the buttons that start another one are off.
  const changing = Boolean(pendingKey) || runner.actionBusy;
  const filteredPayments = filterPayments(activePayments, query, flowFilter);
  const { modal, setModal, claimUploadId, setClaimUploadId, claimPaymentId, setClaimPaymentId, receiptRequestId, setReceiptRequestId, saving, eventRelated, setEventRelated, selectedClaimExpenses, setSelectedClaimExpenses, uploads, recorded, retryUpload, closeDialogs } = forms;
  // The first read: on its way (nothing to show yet, so a skeleton in the shape of the screen), or failed (Try again, not an empty screen).
  const firstRead = !loaded && loading;
  const firstReadFailed = !loaded && !loading && loadFailed;

  return <section className="section-shell page-section finance-page">
    <FinanceTitleRow canManage={canManage} setModal={setModal} />
    {firstReadFailed && <ErrorBlock role="alert" message="The finance records could not be loaded." onRetry={() => void retry()} busy={retrying} />}
    {loaded && loadFailed && <LoadErrorBanner message="Some finance records could not be refreshed, so the figures below may be out of date." onRetry={() => void retry()} busy={retrying} />}
    {firstRead && <>
      <Skeleton className="finance-skeleton-cards" />
      <SkeletonRows rows={5} label="Loading finance workspace…" />
    </>}
    {loaded && <>

    <FinanceSummaryCards canManage={canManage} summary={summary} reimbursements={reimbursements} finance={finance} />

    <FinanceTabs views={canManage ? MANAGER_VIEWS : MEMBER_VIEWS} value={view} onChange={setView} />

    <FinancePanel view={view}>
      {canManage && view === "overview" && <FinanceOverview payments={payments} filteredPayments={filteredPayments} query={query} setQuery={setQuery} flowFilter={flowFilter} setFlowFilter={setFlowFilter} askVoidPayment={ask.askVoidPayment} openDetail={detailTarget.open} changing={changing} pendingReimbursements={pendingReimbursements} expenseById={expenseById} claims={claims} claimChecklist={claimChecklist} setView={setView} />}

      {canManage && view === "expenses" && <ExpenseRegister expenses={expenses} profileById={profileById} lockedExpenseIds={lockedExpenseIds} changing={changing} openDetail={detailTarget.open} askEditExpense={ask.askEditExpense} askVoidExpense={ask.askVoidExpense} />}

      {view === "reimbursements" && <ReimbursementList user={user} canManage={canManage} reimbursements={reimbursements} reimbursementDocuments={reimbursementDocuments} expenseById={expenseById} profileById={profileById} documentById={documentById} activePayments={activePayments} changing={changing} pendingKey={pendingKey} previewDocument={setPreviewId} openDetail={detailTarget.open} askRemoveDocument={ask.askRemoveDocument} setReceiptRequestId={setReceiptRequestId} askEditRequest={ask.askEditRequest} askWithdrawRequest={ask.askWithdrawRequest} askDecline={ask.askDecline} askRequestChanges={ask.askRequestChanges} askApprove={ask.askApprove} setConfirming={setConfirming} askVoidPayment={ask.askVoidPayment} askVoidExpense={ask.askVoidExpense} />}

      {canManage && view === "claims" && <FundingClaims claims={claims} claimDocuments={claimDocuments} documentById={documentById} previewDocument={setPreviewId} claimChecklist={claimChecklist} changing={changing} pendingKey={pendingKey} setModal={setModal} setClaimUploadId={setClaimUploadId} setClaimPaymentId={setClaimPaymentId} setConfirming={setConfirming} updateClaimStatus={changes.updateClaimStatus} askClaimDecision={ask.askClaimDecision} askVoidClaim={ask.askVoidClaim} askRemoveClaimExpense={ask.askRemoveClaimExpense} askAddClaimExpense={ask.askAddClaimExpense} />}
    </FinancePanel>
    </>}

    {loaded && detail && <FinanceDetailDialog detail={detail} canManage={canManage} who={who} documentById={documentById} onPreview={setPreviewId} onClose={detailTarget.close} />}
    <PreviewDialog open={previewId !== null} onClose={() => setPreviewId(null)} title={previewId === null ? "" : documentById.get(previewId)?.title || "Document"} load={() => loadPreview(previewId as number)} />
    {modal === "reimbursement" && <ReimbursementDialog groups={groups} events={events} eventRelated={eventRelated} setEventRelated={setEventRelated} saving={saving} uploads={uploads} recorded={recorded} onRetryUpload={retryUpload} onSubmit={forms.submitReimbursement} onClose={closeDialogs} />}
    {modal === "expense" && <ClubExpenseDialog groups={groups} events={events} eventRelated={eventRelated} setEventRelated={setEventRelated} saving={saving} uploads={uploads} recorded={recorded} onRetryUpload={retryUpload} onSubmit={forms.recordExpense} onClose={closeDialogs} />}
    {modal === "income" && <IncomeDialog saving={saving} onSubmit={forms.recordIncome} onClose={closeDialogs} />}
    {modal === "claim" && <NewClaimDialog unclaimedExpenses={unclaimedExpenses} expenses={expenses} selectedClaimExpenses={selectedClaimExpenses} setSelectedClaimExpenses={setSelectedClaimExpenses} saving={saving} uploads={uploads} recorded={recorded} onRetryUpload={retryUpload} onSubmit={forms.createClaim} onClose={closeDialogs} />}
    {claimUploadId && <ClaimDocumentDialog saving={saving} uploads={uploads} onRetryUpload={retryUpload} onSubmit={forms.uploadClaimDocument} onClose={closeDialogs} />}
    {claimPaymentId && <ClaimPaymentDialog saving={saving} onSubmit={forms.recordClaimPayment} onClose={closeDialogs} />}
    {receiptRequestId && <ReceiptDialog saving={saving} uploads={uploads} onRetryUpload={retryUpload} onSubmit={forms.uploadRequestReceipt} onClose={closeDialogs} />}
    <FinanceChangeDialogs confirming={changes.confirming} setConfirming={setConfirming} pendingKey={pendingKey} confirmChange={changes.confirmChange} profileById={profileById} expenseById={expenseById} action={runner.action} setAction={runner.setAction} actionBusy={runner.actionBusy} runAction={runner.runAction} />
  </section>;
}
