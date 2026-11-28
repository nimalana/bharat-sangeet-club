"use client";

// The finance dialogs that collect something: a reimbursement request, a club expense, income, a funding claim, a funding payment,
// and the two document uploads (a receipt on a request, a document on a claim). One flag, `saving`, covers all of them.
//
// What each does when its form is submitted:
//   - the record is saved FIRST (an RPC); if the database refuses, the dialog stays open with the database's sentence and nothing is uploaded;
//   - then the document is uploaded and linked; if THAT fails the record stays saved, the person is told so ("Request saved; <why>"),
//     and the lists are read again;
//   - when everything went through the dialog closes, a message says so and the lists are read again (bounded: refreshAfterChange).
// Income and a funding payment have no file; they read the lists again without waiting for them.
import { FormEvent, useState } from "react";
import { friendlyError } from "../../../lib/errors";
import {
  createFundingClaim, financeAvailable, recordClubExpense, recordFinanceIncome, recordFundingClaimPayment, submitMemberReimbursement,
  type DocumentLinks, type Reimbursement,
} from "../../../lib/api/finance";
import { useToast } from "../../../components/ui/toast";
import { readPurchaseDetails } from "../forms";
import { answered, refusal } from "../refusal";
import type { FinanceModal } from "../types";

export function useFinanceForms({ reimbursements, uploadDocument, refreshAfterChange, loadFinance }: {
  reimbursements: Reimbursement[];
  uploadDocument: (file: File, documentType: string, title: string, links: DocumentLinks, last4?: string) => Promise<number>;
  refreshAfterChange: (saved?: boolean) => Promise<void>;
  loadFinance: () => Promise<void>;
}) {
  const { notify } = useToast();
  const [modal, setModal] = useState<FinanceModal>(null);
  const [claimUploadId, setClaimUploadId] = useState<number | null>(null);
  const [claimPaymentId, setClaimPaymentId] = useState<number | null>(null);
  const [receiptRequestId, setReceiptRequestId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [eventRelated, setEventRelated] = useState(false);
  const [selectedClaimExpenses, setSelectedClaimExpenses] = useState<Set<number>>(new Set());

  async function submitReimbursement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!financeAvailable()) return;
    setSaving(true);
    const form = new FormData(event.currentTarget);
    const receipt = form.get("receipt") as File;
    const statement = form.get("statement") as File;
    const last4 = String(form.get("last4") || "").trim();
    const created = await answered(submitMemberReimbursement(readPurchaseDetails(form, last4), String(form.get("note") || "")));
    if (!created.ok) { setSaving(false); notify(friendlyError(created.error, "The request could not be submitted."), "error"); return; }
    const result = created.value;
    try {
      await uploadDocument(receipt, "receipt", `Receipt — ${String(form.get("description") || "Purchase")}`, { expenseId: result.expense_id, reimbursementId: result.reimbursement_id }, last4);
      if (statement?.size) await uploadDocument(statement, "card_statement", "Payment card statement", { expenseId: result.expense_id, reimbursementId: result.reimbursement_id }, last4);
      setModal(null); setEventRelated(false); notify("Reimbursement request submitted"); await refreshAfterChange();
    } catch (uploadError) {
      notify(uploadError instanceof Error ? `Request saved; ${uploadError.message}` : "Request saved, but a document failed to upload", "error");
      await refreshAfterChange();
    } finally { setSaving(false); }
  }

  async function recordExpense(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!financeAvailable()) return;
    setSaving(true);
    const form = new FormData(event.currentTarget);
    const receipt = form.get("receipt") as File;
    const last4 = String(form.get("last4") || "").trim();
    const recorded = await answered(recordClubExpense(readPurchaseDetails(form, last4), String(form.get("account_name") || "Club bank account")));
    if (!recorded.ok) { setSaving(false); notify(friendlyError(recorded.error, "The expense could not be recorded."), "error"); return; }
    try {
      await uploadDocument(receipt, "receipt", `Receipt — ${String(form.get("description") || "Purchase")}`, { expenseId: Number(recorded.value) }, last4);
      setModal(null); setEventRelated(false); notify("Club expense recorded"); await refreshAfterChange();
    } catch (uploadError) {
      notify(uploadError instanceof Error ? `Expense saved; ${uploadError.message}` : "Expense saved, but the receipt failed to upload", "error");
      await refreshAfterChange();
    } finally { setSaving(false); }
  }

  async function recordIncome(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!financeAvailable()) return;
    setSaving(true);
    const form = new FormData(event.currentTarget);
    const failure = await refusal(recordFinanceIncome({
      description: String(form.get("description") || ""), amount: Number(form.get("amount")),
      paymentDate: String(form.get("payment_date") || ""), category: String(form.get("category") || "Other"),
      counterparty: String(form.get("counterparty") || ""), accountName: String(form.get("account_name") || "Club bank account"),
    }));
    setSaving(false);
    if (failure) notify(friendlyError(failure, "The income could not be recorded."), "error"); else { setModal(null); notify("Income recorded"); loadFinance(); }
  }

  async function createClaim(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!financeAvailable() || selectedClaimExpenses.size === 0) { notify("Select at least one expense for this claim", "error"); return; }
    setSaving(true);
    const form = new FormData(event.currentTarget);
    const approval = form.get("funding_approval") as File;
    // One call creates the claim and links its expenses, so a failure leaves nothing half-made.
    const saved = await answered(createFundingClaim({
      title: String(form.get("title") || ""), funderName: String(form.get("funder_name") || "GPSG Senate"),
      awardReference: String(form.get("award_reference") || ""), heellifeReference: String(form.get("heellife_reference") || ""),
      submissionDeadline: String(form.get("submission_deadline") || "") || null, notes: String(form.get("notes") || ""),
      expenseIds: [...selectedClaimExpenses],
    }));
    if (!saved.ok) { setSaving(false); notify(friendlyError(saved.error, "Claim could not be created"), "error"); return; }
    const claimId = Number(saved.value.id);
    try {
      await uploadDocument(approval, "funding_approval", "Funding approval", { claimId });
      setModal(null); setSelectedClaimExpenses(new Set()); notify("Funding claim workspace created"); await refreshAfterChange();
    } catch (uploadError) {
      notify(uploadError instanceof Error ? `Claim saved; ${uploadError.message}` : "Claim saved, but approval proof failed to upload", "error");
      await refreshAfterChange();
    } finally { setSaving(false); }
  }

  async function uploadRequestReceipt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const request = reimbursements.find((item) => item.id === receiptRequestId);
    if (!request) return;
    setSaving(true);
    const form = new FormData(event.currentTarget);
    try {
      await uploadDocument(form.get("file") as File, "receipt", String(form.get("title") || "Receipt"), { expenseId: request.expense_id, reimbursementId: request.id });
      setReceiptRequestId(null); notify("Receipt added"); await refreshAfterChange();
    } catch (error) { notify(error instanceof Error ? error.message : "Receipt could not be uploaded", "error"); }
    finally { setSaving(false); }
  }

  async function uploadClaimDocument(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!claimUploadId) return;
    setSaving(true);
    const form = new FormData(event.currentTarget);
    try {
      await uploadDocument(form.get("file") as File, String(form.get("document_type") || "other"), String(form.get("title") || "Claim document"), { claimId: claimUploadId });
      setClaimUploadId(null); notify("Claim document added"); await refreshAfterChange();
    } catch (error) { notify(error instanceof Error ? error.message : "Document could not be uploaded", "error"); }
    finally { setSaving(false); }
  }

  async function recordClaimPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!financeAvailable() || !claimPaymentId) return;
    setSaving(true);
    const form = new FormData(event.currentTarget);
    const failure = await refusal(recordFundingClaimPayment({
      claimId: claimPaymentId, amount: Number(form.get("amount")),
      paymentDate: String(form.get("payment_date") || ""), accountName: String(form.get("account_name") || "Club bank account"),
    }));
    setSaving(false);
    if (failure) notify(friendlyError(failure, "The payment could not be recorded."), "error"); else { setClaimPaymentId(null); notify("Funding payment recorded"); loadFinance(); }
  }

  return {
    modal, setModal, claimUploadId, setClaimUploadId, claimPaymentId, setClaimPaymentId, receiptRequestId, setReceiptRequestId,
    saving, eventRelated, setEventRelated, selectedClaimExpenses, setSelectedClaimExpenses,
    submitReimbursement, recordExpense, recordIncome, createClaim, uploadRequestReceipt, uploadClaimDocument, recordClaimPayment,
  };
}
