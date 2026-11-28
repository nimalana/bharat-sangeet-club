"use client";

// The finance dialogs that collect something: a reimbursement request, a club expense, income, a funding claim, a funding payment,
// and the two document uploads (a receipt on a request, a document on a claim). One flag, `saving`, covers all of them.
//
// What each does when its form is submitted:
//   - the record is saved FIRST (an RPC); if the database refuses, the dialog stays open with the database's sentence and nothing is uploaded;
//   - then the document is uploaded and linked; if THAT fails the record stays saved, the person is told so ("Request saved; <why>"),
//     the dialog stays open with a list of the files (the failed one says why and has Retry), and the lists are read again;
//   - when everything went through the dialog closes, a message says so and the lists are read again (bounded: refreshAfterChange).
// Income and a funding payment have no file; they read the lists again without waiting for them.
//
// Phase 3.1:
//   - One press at a time: a second submit that arrives before the button has switched off (a double click, Enter twice) does nothing. The
//     guard is a ref, set at once, because `saving` only changes the button after the next render.
//   - A failure never clears a form or closes its dialog; only a success does. A call that gets no answer (the network went away) is a
//     failure like a refusal: the person is told, the form keeps what was typed and the button works again.
//   - The files show their progress (components/ui/upload-progress.tsx) with Retry. Once the record of a request, an expense or a claim is
//     saved it is never saved a second time: pressing the button again (its label then says "Upload again") sends the files that are not
//     up yet, read from the form again, so a file that was refused can be replaced; Retry sends the same files again.
import { FormEvent, useRef, useState } from "react";
import { ApiError, friendlyError } from "../../../lib/errors";
import type { UploadProgress } from "../../../lib/api/_core";
import {
  createFundingClaim, financeAvailable, recordClubExpense, recordFinanceIncome, recordFundingClaimPayment, submitMemberReimbursement,
  type DocumentLinks, type Reimbursement,
} from "../../../lib/api/finance";
import { uploadPercent, type UploadItem } from "../../../components/ui/upload-progress";
import { useToast } from "../../../components/ui/toast";
import { CHANGE_NOT_SAVED_OFFLINE } from "../constants";
import { readPurchaseDetails } from "../forms";
import { answered, refusal } from "../refusal";
import type { FinanceModal } from "../types";

/** One file of a form: what to send and how the list names it. `id` is the same on every press of the button. */
type DocumentJob = { id: string; file: File; documentType: string; title: string; last4?: string };

/** What a saved record leaves behind while its files are not all up: where they attach, which are up, and what to do when they all are. */
type Pending = {
  links: DocumentLinks;
  jobs: DocumentJob[];
  sent: Set<string>;
  /** "Request saved": said before the reason a file failed. Absent for a form that only uploads (nothing was saved before it). */
  savedAs?: string;
  /** What is said when the failure has no sentence of its own (it was not an Error). */
  unsaid: string;
  success: string;
  finished: () => void;
};

/** The sentence for a file that did not go up: the check's own sentence, or what friendlyError makes of the database's or the network's. */
function whyNotStored(failure: unknown): string | null {
  if (failure instanceof ApiError) return friendlyError(failure, "The document could not be uploaded.");
  return failure instanceof Error ? failure.message : null;
}

export function useFinanceForms({ reimbursements, uploadDocument, refreshAfterChange, loadFinance }: {
  reimbursements: Reimbursement[];
  uploadDocument: (file: File, documentType: string, title: string, links: DocumentLinks, last4?: string, onProgress?: (progress: UploadProgress) => void) => Promise<number>;
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
  // The files being sent, as the list shows them, and whether the record they belong to is already saved.
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [recorded, setRecorded] = useState(false);
  const working = useRef(false);
  const pending = useRef<Pending | null>(null);

  // One press at a time. A press that finds another still running does nothing; a call that gets no answer is told, not thrown.
  async function exclusive(work: () => Promise<void>) {
    if (working.current) return;
    working.current = true;
    setSaving(true);
    try { await work(); }
    catch { notify(CHANGE_NOT_SAVED_OFFLINE, "error"); }
    finally { working.current = false; setSaving(false); }
  }

  const patchUpload = (id: string, change: Partial<UploadItem>) => setUploads((list) => list.map((item) => (item.id === id ? { ...item, ...change } : item)));

  /** Forgets the files and the saved record: the dialog was closed, or everything went through. */
  function forgetUploads() { pending.current = null; setRecorded(false); setUploads([]); }

  /** Closes whichever dialog is open. A failed form is left open by its handler; this is what Close does. */
  function closeDialogs() {
    setModal(null); setClaimUploadId(null); setClaimPaymentId(null); setReceiptRequestId(null);
    setEventRelated(false); setSelectedClaimExpenses(new Set());
    forgetUploads();
  }

  // Sends the files that are not up yet, one after the other, and stops at the first that fails (the ones after it are not tried).
  // Resolves to null when they are all up, else to whatever the failed one threw.
  async function sendFiles(kept: Pending): Promise<{ failure: unknown } | null> {
    for (const job of kept.jobs) {
      if (kept.sent.has(job.id)) continue;
      patchUpload(job.id, { status: "uploading", loaded: 0, total: job.file.size, error: undefined });
      // The browser reports bytes many times a second: the list only hears of a new whole percent, or of the last byte leaving.
      let lastSeen = "";
      const onProgress = ({ loaded, total }: UploadProgress) => {
        const seen = `${uploadPercent({ loaded, total })}:${total > 0 && loaded >= total}`;
        if (seen === lastSeen) return;
        lastSeen = seen;
        patchUpload(job.id, { loaded, total });
      };
      try { await uploadDocument(job.file, job.documentType, job.title, kept.links, job.last4, onProgress); }
      catch (failure) {
        patchUpload(job.id, { status: "failed", error: whyNotStored(failure) ?? kept.unsaid });
        return { failure };
      }
      kept.sent.add(job.id);
      patchUpload(job.id, { status: "done" });
    }
    return null;
  }

  // After the files: all up (close, say so, read the lists again), or one failed (say so; the dialog stays for another try).
  async function finishFiles(kept: Pending) {
    const outcome = await sendFiles(kept);
    if (outcome) {
      const why = whyNotStored(outcome.failure) ?? kept.unsaid;
      notify(kept.savedAs ? `${kept.savedAs}; ${why}` : why, "error");
      // The record is saved, so the lists are read again; a form that only uploads saved nothing.
      if (kept.savedAs) await refreshAfterChange();
      return;
    }
    forgetUploads();
    kept.finished();
    notify(kept.success);
    await refreshAfterChange();
  }

  /**
   * A form with a record and files: saves the record the first time (`save` answers where the files attach, or null when the database
   * refused and the person has been told), then sends the files. Pressed again after a failed file, it skips the saving and sends the
   * files again, as they are in the form now.
   */
  async function recordThenFiles(plan: { save: () => Promise<DocumentLinks | null>; files: (links: DocumentLinks) => DocumentJob[]; savedAs: string; unsaid: string; success: string; finished: () => void }) {
    let kept = pending.current;
    if (!kept) {
      const links = await plan.save();
      if (!links) return;
      kept = { links, jobs: [], sent: new Set(), savedAs: plan.savedAs, unsaid: plan.unsaid, success: plan.success, finished: plan.finished };
      pending.current = kept;
      setRecorded(true);
    }
    kept.jobs = plan.files(kept.links);
    setUploads(kept.jobs.map((job) => ({ id: job.id, name: job.file.name || job.title, status: kept.sent.has(job.id) ? "done" : "waiting" })));
    await finishFiles(kept);
  }

  /** A form that only sends a file (a receipt for a request, a document for a claim). */
  async function filesOnly(plan: { links: DocumentLinks; file: DocumentJob; unsaid: string; success: string; finished: () => void }) {
    const kept: Pending = { links: plan.links, jobs: [plan.file], sent: new Set(), unsaid: plan.unsaid, success: plan.success, finished: plan.finished };
    pending.current = kept;
    setUploads([{ id: plan.file.id, name: plan.file.file.name || plan.file.title, status: "waiting" }]);
    await finishFiles(kept);
  }

  /** Retry on a failed file: the same files again, for the record that is already saved. */
  function retryUpload() {
    void exclusive(async () => { if (pending.current) await finishFiles(pending.current); });
  }

  async function submitReimbursement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!financeAvailable()) return;
    const form = new FormData(event.currentTarget);
    const last4 = String(form.get("last4") || "").trim();
    const title = `Receipt — ${String(form.get("description") || "Purchase")}`;
    await exclusive(() => recordThenFiles({
      save: async () => {
        const created = await answered(submitMemberReimbursement(readPurchaseDetails(form, last4), String(form.get("note") || "")));
        if (!created.ok) { notify(friendlyError(created.error, "The request could not be submitted."), "error"); return null; }
        return { expenseId: created.value.expense_id, reimbursementId: created.value.reimbursement_id };
      },
      files: () => {
        const statement = form.get("statement") as File;
        return [
          { id: "receipt", file: form.get("receipt") as File, documentType: "receipt", title, last4 },
          ...(statement?.size ? [{ id: "statement", file: statement, documentType: "card_statement", title: "Payment card statement", last4 }] : []),
        ];
      },
      savedAs: "Request saved", unsaid: "a document failed to upload", success: "Reimbursement request submitted",
      finished: () => { setModal(null); setEventRelated(false); },
    }));
  }

  async function recordExpense(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!financeAvailable()) return;
    const form = new FormData(event.currentTarget);
    const last4 = String(form.get("last4") || "").trim();
    await exclusive(() => recordThenFiles({
      save: async () => {
        const recorded = await answered(recordClubExpense(readPurchaseDetails(form, last4), String(form.get("account_name") || "Club bank account")));
        if (!recorded.ok) { notify(friendlyError(recorded.error, "The expense could not be recorded."), "error"); return null; }
        return { expenseId: Number(recorded.value) };
      },
      files: () => [{ id: "receipt", file: form.get("receipt") as File, documentType: "receipt", title: `Receipt — ${String(form.get("description") || "Purchase")}`, last4 }],
      savedAs: "Expense saved", unsaid: "the receipt failed to upload", success: "Club expense recorded",
      finished: () => { setModal(null); setEventRelated(false); },
    }));
  }

  async function recordIncome(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!financeAvailable()) return;
    const form = new FormData(event.currentTarget);
    await exclusive(async () => {
      const failure = await refusal(recordFinanceIncome({
        description: String(form.get("description") || ""), amount: Number(form.get("amount")),
        paymentDate: String(form.get("payment_date") || ""), category: String(form.get("category") || "Other"),
        counterparty: String(form.get("counterparty") || ""), accountName: String(form.get("account_name") || "Club bank account"),
      }));
      if (failure) notify(friendlyError(failure, "The income could not be recorded."), "error"); else { setModal(null); notify("Income recorded"); loadFinance(); }
    });
  }

  async function createClaim(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!financeAvailable() || selectedClaimExpenses.size === 0) { notify("Select at least one expense for this claim", "error"); return; }
    const form = new FormData(event.currentTarget);
    const expenseIds = [...selectedClaimExpenses];
    await exclusive(() => recordThenFiles({
      // One call creates the claim and links its expenses, so a failure leaves nothing half-made.
      save: async () => {
        const saved = await answered(createFundingClaim({
          title: String(form.get("title") || ""), funderName: String(form.get("funder_name") || "GPSG Senate"),
          awardReference: String(form.get("award_reference") || ""), heellifeReference: String(form.get("heellife_reference") || ""),
          submissionDeadline: String(form.get("submission_deadline") || "") || null, notes: String(form.get("notes") || ""),
          expenseIds,
        }));
        if (!saved.ok) { notify(friendlyError(saved.error, "Claim could not be created"), "error"); return null; }
        return { claimId: Number(saved.value.id) };
      },
      files: () => [{ id: "approval", file: form.get("funding_approval") as File, documentType: "funding_approval", title: "Funding approval" }],
      savedAs: "Claim saved", unsaid: "approval proof failed to upload", success: "Funding claim workspace created",
      finished: () => { setModal(null); setSelectedClaimExpenses(new Set()); },
    }));
  }

  async function uploadRequestReceipt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const request = reimbursements.find((item) => item.id === receiptRequestId);
    if (!request) return;
    const form = new FormData(event.currentTarget);
    await exclusive(() => filesOnly({
      links: { expenseId: request.expense_id, reimbursementId: request.id },
      file: { id: "receipt", file: form.get("file") as File, documentType: "receipt", title: String(form.get("title") || "Receipt") },
      unsaid: "Receipt could not be uploaded", success: "Receipt added", finished: () => setReceiptRequestId(null),
    }));
  }

  async function uploadClaimDocument(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!claimUploadId) return;
    const form = new FormData(event.currentTarget);
    await exclusive(() => filesOnly({
      links: { claimId: claimUploadId },
      file: { id: "document", file: form.get("file") as File, documentType: String(form.get("document_type") || "other"), title: String(form.get("title") || "Claim document") },
      unsaid: "Document could not be uploaded", success: "Claim document added", finished: () => setClaimUploadId(null),
    }));
  }

  async function recordClaimPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!financeAvailable() || !claimPaymentId) return;
    const form = new FormData(event.currentTarget);
    await exclusive(async () => {
      const failure = await refusal(recordFundingClaimPayment({
        claimId: claimPaymentId, amount: Number(form.get("amount")),
        paymentDate: String(form.get("payment_date") || ""), accountName: String(form.get("account_name") || "Club bank account"),
      }));
      if (failure) notify(friendlyError(failure, "The payment could not be recorded."), "error"); else { setClaimPaymentId(null); notify("Funding payment recorded"); loadFinance(); }
    });
  }

  return {
    modal, setModal, claimUploadId, setClaimUploadId, claimPaymentId, setClaimPaymentId, receiptRequestId, setReceiptRequestId,
    saving, eventRelated, setEventRelated, selectedClaimExpenses, setSelectedClaimExpenses, uploads, recorded, retryUpload, closeDialogs,
    submitReimbursement, recordExpense, recordIncome, createClaim, uploadRequestReceipt, uploadClaimDocument, recordClaimPayment,
  };
}
