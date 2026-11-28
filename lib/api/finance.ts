// Everything the Finance screen asks of Supabase: the eleven reads of its load wave, every finance function (RPC) it
// calls and the finance-private bucket. No React, no toast and no sentence for a person lives here; the screen
// (features/finance) decides what to say.
//
// A call that Supabase answers with an error throws an ApiError (lib/errors.ts), so the screen has one kind of failure
// to catch and friendlyError(error, fallback) turns it into the sentence the person sees, as it did for the raw error.
// A call that REJECTS (the network went away) is not an ApiError: it propagates as it always did, so the screen can tell
// "the database said no" from "could not reach it". The one exception is the load wave, which hands back the eleven
// answers as they came (see loadFinanceWave).
//
// Table, function and bucket names are literals on purpose: scripts/contract-check reads them. So are the argument keys
// of every rpc call: each function builds its `{ p_x: ... }` object inline.
import type { PostgrestError } from "@supabase/supabase-js";
import { ApiError, toApiError } from "../errors";
import type { Profile, Tables } from "../db";
import { removeStoredFile } from "../storage";
import { supabase } from "../supabase";
import { must } from "./_core";

// ---------------------------------------------------------------- row types (what the screen reads of each table)

// paid_by and direction are text columns with a CHECK constraint, so the generated type is `string`; the UI knows the two values.
export type Expense = Pick<Tables<"finance_expenses">, "id" | "description" | "vendor" | "amount" | "purchase_date" | "category" | "paid_by_member_id"
  | "payment_card_last4" | "subgroup_id" | "club_event_id" | "event_related" | "event_name" | "event_starts_at"
  | "event_attendee_count" | "event_schedule" | "status" | "created_by"> & { paid_by: "club" | "member" };
export type Reimbursement = Pick<Tables<"personal_reimbursements">, "id" | "expense_id" | "member_id" | "requested_amount" | "approved_amount" | "status"
  | "member_note" | "review_note" | "created_at"> & Partial<Pick<Tables<"personal_reimbursements">, "void_reason">>;
export type Payment = Pick<Tables<"finance_payments">, "id" | "purpose" | "amount" | "description" | "category" | "account_name" | "counterparty"
  | "payment_date" | "status" | "reimbursement_id" | "funding_claim_id"> & Partial<Pick<Tables<"finance_payments">, "expense_id">> & { direction: "inflow" | "outflow" };
export type FundingClaim = Pick<Tables<"funding_claims">, "id" | "title" | "funder_name" | "award_reference" | "heellife_reference" | "requested_amount"
  | "approved_amount" | "received_amount" | "submission_deadline" | "status" | "notes">;
export type ClaimExpense = Pick<Tables<"funding_claim_expenses">, "claim_id" | "expense_id" | "claimed_amount">;
export type FinanceDocument = Pick<Tables<"finance_documents">, "id" | "document_type" | "title" | "storage_path" | "uploaded_by">;
export type ExpenseDocument = Pick<Tables<"finance_expense_documents">, "expense_id" | "document_id">;
export type ReimbursementDocument = Pick<Tables<"finance_reimbursement_documents">, "reimbursement_id" | "document_id">;
export type ClaimDocument = Pick<Tables<"finance_claim_documents">, "claim_id" | "document_id">;

// ---------------------------------------------------------------- the client

// null when the app has no Supabase settings; the shell shows its setup screen then, so no finance call is reached. A screen
// that used to `if (!supabase) return;` asks this instead.
export const financeAvailable = () => supabase !== null;

function connected() {
  if (!supabase) throw new ApiError("The portal is not connected.");
  return supabase;
}

// ---------------------------------------------------------------- the load wave

// The lists show the latest FINANCE_LIST_LIMIT rows; totals come from the database.
export const FINANCE_LIST_LIMIT = 500;
const LIST_LIMIT = FINANCE_LIST_LIMIT;

/** One read as it came back: its rows (null when it failed) and its error (null when it worked). */
type FinanceAnswer<T> = { data: T | null; error: ApiError | null };
export type FinanceWave = {
  expenses: FinanceAnswer<Expense[]>;
  reimbursements: FinanceAnswer<Reimbursement[]>;
  payments: FinanceAnswer<Payment[]>;
  documents: FinanceAnswer<FinanceDocument[]>;
  expenseDocuments: FinanceAnswer<ExpenseDocument[]>;
  reimbursementDocuments: FinanceAnswer<ReimbursementDocument[]>;
  /** get_finance_summary: a JSON object of numbers (as text or number); the screen reads each value with Number(). */
  summary: FinanceAnswer<unknown>;
  claims: FinanceAnswer<FundingClaim[]>;
  claimExpenses: FinanceAnswer<ClaimExpense[]>;
  claimDocuments: FinanceAnswer<ClaimDocument[]>;
  profiles: FinanceAnswer<Profile[]>;
};

const answered = <T>(response: { data: unknown; error: unknown; status?: number }): FinanceAnswer<T> =>
  ({ data: response.data as T | null, error: response.error ? toApiError(response.error as PostgrestError, response.status) : null });

/**
 * The eleven reads of the screen in ONE wave (it used to be three, one after another), sent in this order. Unlike every other
 * function here it does not throw for a failed read: the screen needs all eleven answers to decide whether a refresh may replace
 * what is on screen (lib/finance-load.ts), so each comes back with its own `error`. A manager sees the claims and the profiles
 * too; for anyone else those four answer an empty list without asking the database.
 */
export async function loadFinanceWave(canManage: boolean): Promise<FinanceWave> {
  const db = connected();
  const none = Promise.resolve<FinanceAnswer<never[]>>({ data: [], error: null });
  const [expenses, reimbursements, payments, documents, expenseDocuments, reimbursementDocuments, summary, claims, claimExpenses, claimDocuments, profiles] = await Promise.all([
    db.from("finance_expenses").select("*").order("purchase_date", { ascending: false }).order("id", { ascending: false }).limit(LIST_LIMIT).then((r) => answered<Expense[]>(r)),
    db.from("personal_reimbursements").select("*").order("created_at", { ascending: false }).limit(LIST_LIMIT).then((r) => answered<Reimbursement[]>(r)),
    db.from("finance_payments").select("*").order("payment_date", { ascending: false }).order("id", { ascending: false }).limit(LIST_LIMIT).then((r) => answered<Payment[]>(r)),
    db.from("finance_documents").select("id,document_type,title,storage_path,uploaded_by").order("created_at", { ascending: false }).limit(LIST_LIMIT * 4).then((r) => answered<FinanceDocument[]>(r)),
    db.from("finance_expense_documents").select("expense_id,document_id").limit(LIST_LIMIT * 4).then((r) => answered<ExpenseDocument[]>(r)),
    db.from("finance_reimbursement_documents").select("reimbursement_id,document_id").limit(LIST_LIMIT * 4).then((r) => answered<ReimbursementDocument[]>(r)),
    db.rpc("get_finance_summary").then((r) => answered<unknown>(r)),
    canManage ? db.from("funding_claims").select("*").order("created_at", { ascending: false }).limit(LIST_LIMIT).then((r) => answered<FundingClaim[]>(r)) : none,
    canManage ? db.from("funding_claim_expenses").select("claim_id,expense_id,claimed_amount").limit(LIST_LIMIT * 4).then((r) => answered<ClaimExpense[]>(r)) : none,
    canManage ? db.from("finance_claim_documents").select("claim_id,document_id").limit(LIST_LIMIT * 4).then((r) => answered<ClaimDocument[]>(r)) : none,
    canManage ? db.from("profiles").select("id,full_name,email").order("full_name").limit(2000).then((r) => answered<Profile[]>(r)) : none,
  ]);
  return { expenses, reimbursements, payments, documents, expenseDocuments, reimbursementDocuments, summary, claims, claimExpenses, claimDocuments, profiles };
}

// ---------------------------------------------------------------- requests, club expenses, income

/** What the purchase forms collect (the request, the club expense) and the correction forms keep. */
export type PurchaseDetails = {
  description: string; vendor: string; amount: number; purchaseDate: string; category: string; cardLast4: string;
  subgroupId: number | null; clubEventId: number | null; eventRelated: boolean; eventName: string;
  /** An ISO timestamp, or null when the purchase was not for an event. */
  eventStartsAt: string | null; eventAttendeeCount: number | null; eventSchedule: string;
};

/** submit_member_reimbursement: the expense and the request it makes. */
export async function submitMemberReimbursement(details: PurchaseDetails, memberNote: string): Promise<{ expense_id: number; reimbursement_id: number }> {
  const data = must(await connected().rpc("submit_member_reimbursement", {
    p_description: details.description,
    p_vendor: details.vendor,
    p_amount: details.amount,
    p_purchase_date: details.purchaseDate,
    p_category: details.category,
    p_payment_card_last4: details.cardLast4,
    p_member_note: memberNote,
    p_subgroup_id: details.subgroupId,
    p_club_event_id: details.clubEventId,
    p_event_related: details.eventRelated,
    p_event_name: details.eventName,
    p_event_starts_at: details.eventStartsAt,
    p_event_attendee_count: details.eventAttendeeCount,
    p_event_schedule: details.eventSchedule,
  }));
  // The function answers a one-row list; an object is accepted too. The row is NOT checked: a missing one fails where the screen reads it.
  return (Array.isArray(data) ? data[0] : data) as { expense_id: number; reimbursement_id: number };
}

/** record_club_expense: returns the id of the new expense. */
export async function recordClubExpense(details: PurchaseDetails, accountName: string): Promise<number> {
  return must(await connected().rpc("record_club_expense", {
    p_description: details.description, p_vendor: details.vendor,
    p_amount: details.amount, p_purchase_date: details.purchaseDate,
    p_category: details.category, p_account_name: accountName,
    p_payment_card_last4: details.cardLast4, p_subgroup_id: details.subgroupId,
    p_club_event_id: details.clubEventId,
    p_event_related: details.eventRelated, p_event_name: details.eventName,
    p_event_starts_at: details.eventStartsAt,
    p_event_attendee_count: details.eventAttendeeCount,
    p_event_schedule: details.eventSchedule,
  }));
}

/** record_finance_income */
export async function recordFinanceIncome(income: { description: string; amount: number; paymentDate: string; category: string; counterparty: string; accountName: string }): Promise<void> {
  must(await connected().rpc("record_finance_income", {
    p_description: income.description, p_amount: income.amount,
    p_payment_date: income.paymentDate, p_category: income.category,
    p_counterparty: income.counterparty, p_account_name: income.accountName,
  }));
}

// ---------------------------------------------------------------- one-click changes

/** pay_personal_reimbursement */
export async function payPersonalReimbursement(reimbursementId: number, paymentDate: string, accountName: string): Promise<void> {
  must(await connected().rpc("pay_personal_reimbursement", { p_reimbursement_id: reimbursementId, p_payment_date: paymentDate, p_account_name: accountName }));
}

/** set_funding_claim_status with a status and nothing else (ready, incomplete, submitted). */
export async function setFundingClaimStatus(claimId: number, status: string): Promise<void> {
  must(await connected().rpc("set_funding_claim_status", { p_claim_id: claimId, p_status: status }));
}

/** set_funding_claim_status when the funder asked for changes or denied the claim: the funder's words go with it. */
export async function recordFundingClaimDecision(claimId: number, status: "changes_requested" | "denied", note: string): Promise<void> {
  must(await connected().rpc("set_funding_claim_status", { p_claim_id: claimId, p_status: status, p_note: note }));
}

/** set_funding_claim_status "approved", with the amount the funder approved. */
export async function approveFundingClaim(claimId: number, approvedAmount: number, note: string): Promise<void> {
  must(await connected().rpc("set_funding_claim_status", { p_claim_id: claimId, p_status: "approved", p_approved_amount: approvedAmount, p_note: note }));
}

// ---------------------------------------------------------------- corrections (each is one audited function)

/** void_finance_payment */
export async function voidFinancePayment(paymentId: number, reason: string): Promise<void> {
  must(await connected().rpc("void_finance_payment", { p_payment_id: paymentId, p_reason: reason }));
}

/** void_finance_expense */
export async function voidFinanceExpense(expenseId: number, reason: string): Promise<void> {
  must(await connected().rpc("void_finance_expense", { p_expense_id: expenseId, p_reason: reason }));
}

/** The details an expense keeps when it is edited (its amount and date are not among them). */
export type ExpenseDetails = {
  description: string; vendor: string; category: string; cardLast4: string | null;
  subgroupId: number | null; clubEventId: number | null; eventRelated: boolean; eventName: string;
  eventStartsAt: string | null; eventAttendeeCount: number | null; eventSchedule: string;
};

/** update_finance_expense */
export async function updateFinanceExpense(expenseId: number, details: ExpenseDetails): Promise<void> {
  must(await connected().rpc("update_finance_expense", {
    p_expense_id: expenseId,
    p_description: details.description, p_vendor: details.vendor, p_category: details.category, p_payment_card_last4: details.cardLast4,
    p_subgroup_id: details.subgroupId, p_club_event_id: details.clubEventId, p_event_related: details.eventRelated, p_event_name: details.eventName,
    p_event_starts_at: details.eventStartsAt, p_event_attendee_count: details.eventAttendeeCount, p_event_schedule: details.eventSchedule,
  }));
}

/** update_member_reimbursement: the member edits their own request (the amount and date can change here, and the card digits are required). */
export async function updateMemberReimbursement(reimbursementId: number, details: ExpenseDetails & { cardLast4: string }, change: { amount: number; purchaseDate: string; memberNote: string }): Promise<void> {
  must(await connected().rpc("update_member_reimbursement", {
    p_reimbursement_id: reimbursementId,
    p_description: details.description, p_vendor: details.vendor, p_category: details.category, p_payment_card_last4: details.cardLast4,
    p_subgroup_id: details.subgroupId, p_club_event_id: details.clubEventId, p_event_related: details.eventRelated, p_event_name: details.eventName,
    p_event_starts_at: details.eventStartsAt, p_event_attendee_count: details.eventAttendeeCount, p_event_schedule: details.eventSchedule,
    p_amount: change.amount, p_purchase_date: change.purchaseDate, p_member_note: change.memberNote,
  }));
}

/** withdraw_member_reimbursement */
export async function withdrawMemberReimbursement(reimbursementId: number): Promise<void> {
  must(await connected().rpc("withdraw_member_reimbursement", { p_reimbursement_id: reimbursementId }));
}

/** review_personal_reimbursement "approved", for the amount the reviewer chose. */
export async function approveReimbursement(reimbursementId: number, approvedAmount: number, reviewNote: string): Promise<void> {
  must(await connected().rpc("review_personal_reimbursement", { p_reimbursement_id: reimbursementId, p_decision: "approved", p_approved_amount: approvedAmount, p_review_note: reviewNote }));
}

/** review_personal_reimbursement "rejected" */
export async function declineReimbursement(reimbursementId: number, reviewNote: string): Promise<void> {
  must(await connected().rpc("review_personal_reimbursement", { p_reimbursement_id: reimbursementId, p_decision: "rejected", p_approved_amount: null, p_review_note: reviewNote }));
}

/** request_reimbursement_changes */
export async function requestReimbursementChanges(reimbursementId: number, note: string): Promise<void> {
  must(await connected().rpc("request_reimbursement_changes", { p_reimbursement_id: reimbursementId, p_note: note }));
}

/** void_funding_claim */
export async function voidFundingClaim(claimId: number, reason: string): Promise<void> {
  must(await connected().rpc("void_funding_claim", { p_claim_id: claimId, p_reason: reason }));
}

/** remove_funding_claim_expense */
export async function removeFundingClaimExpense(claimId: number, expenseId: number): Promise<void> {
  must(await connected().rpc("remove_funding_claim_expense", { p_claim_id: claimId, p_expense_id: expenseId }));
}

/** add_funding_claim_expense */
export async function addFundingClaimExpense(claimId: number, expenseId: number): Promise<void> {
  must(await connected().rpc("add_funding_claim_expense", { p_claim_id: claimId, p_expense_id: expenseId }));
}

// ---------------------------------------------------------------- funding claims

/**
 * create_funding_claim: one call creates the claim and links its expenses, so a failure leaves nothing half-made. Returns the
 * new claim. An answer with no row and no error is treated as a refusal (an ApiError with no message, which friendlyError
 * reads as "no detail").
 */
export async function createFundingClaim(claim: { title: string; funderName: string; awardReference: string; heellifeReference: string; submissionDeadline: string | null; notes: string; expenseIds: number[] }): Promise<{ id: number }> {
  const data = must(await connected().rpc("create_funding_claim", {
    p_title: claim.title, p_funder_name: claim.funderName,
    p_award_reference: claim.awardReference, p_heellife_reference: claim.heellifeReference,
    p_submission_deadline: claim.submissionDeadline as string, /* NULL means no deadline: the function stores it, the generated type cannot say so for a required argument */ p_notes: claim.notes,
    p_expense_ids: claim.expenseIds,
  }));
  if (!data) throw new ApiError("");
  return data;
}

/** record_funding_claim_payment */
export async function recordFundingClaimPayment(payment: { claimId: number; amount: number; paymentDate: string; accountName: string }): Promise<void> {
  must(await connected().rpc("record_funding_claim_payment", {
    p_claim_id: payment.claimId, p_amount: payment.amount,
    p_payment_date: payment.paymentDate, p_account_name: payment.accountName,
  }));
}

// ---------------------------------------------------------------- documents (the finance-private bucket)

/** What a document is attached to: any of these may be set, and each set one gets its own link row. */
export type DocumentLinks = { expenseId?: number; reimbursementId?: number; claimId?: number };

/**
 * Stores a file and registers it, in this order: (1) the file goes into the private bucket under `storagePath`, (2) ONE call to
 * register_finance_document creates the document record and every link (expense, request, claim) in a single transaction, and
 * checks that the file is there, is in the caller's own folder, and that the target still takes documents. Returns the document's
 * id. The uploader is the signed-in person: the database decides it, the caller cannot name anybody else.
 *
 * When the database REFUSES the registration (it answered with an error) the file just stored has nothing behind it, so it is
 * removed again (best effort: the person is shown the refusal, not a second failure). Two cases leave the file alone: an
 * "already registered" answer (23505: a record exists and points at this very file), and a call that never got an answer (the
 * network went away: the registration may have succeeded, and removing the file then would leave a record with nothing behind it).
 * The checks on the file (size, type) and the path are the screen's (lib/finance-upload.ts).
 */
export async function uploadFinanceDocument(upload: {
  file: File; storagePath: string; mimeType: string; documentType: string; title: string;
  cardLast4: string | null; links: DocumentLinks;
}): Promise<number> {
  const db = connected();
  const uploaded = await db.storage.from("finance-private").upload(upload.storagePath, upload.file, { contentType: upload.mimeType, upsert: false });
  if (uploaded.error) throw toApiError(uploaded.error);
  let documentId: number | null;
  try {
    documentId = must(await db.rpc("register_finance_document", {
      p_storage_path: upload.storagePath, p_document_type: upload.documentType, p_title: upload.title,
      p_mime_type: upload.mimeType, p_file_size_bytes: upload.file.size,
      p_payment_card_last4: upload.cardLast4 ?? undefined,
      p_expense_id: upload.links.expenseId || undefined,
      p_reimbursement_id: upload.links.reimbursementId || undefined,
      p_claim_id: upload.links.claimId || undefined,
    }));
  } catch (error) {
    if (error instanceof ApiError && error.code !== "23505") await removeStoredFile("finance-private", upload.storagePath).catch(() => null);
    throw error;
  }
  if (documentId === null || documentId === undefined) {
    await removeStoredFile("finance-private", upload.storagePath).catch(() => null);
    throw new ApiError("Document record could not be created");
  }
  return Number(documentId);
}

/** A link (valid for 90 seconds) to open one stored document. An answer with no link and no error is a refusal with no message. */
export async function createFinanceDocumentUrl(storagePath: string): Promise<string> {
  const { data, error } = await connected().storage.from("finance-private").createSignedUrl(storagePath, 90);
  if (error) throw toApiError(error);
  if (!data) throw new ApiError("");
  return data.signedUrl;
}

/**
 * Removes a document: its record first (remove_finance_document, which answers the stored file's path), the stored file after.
 * Storage answers a refused delete with an empty list and no error, so the file step is read with lib/storage-remove (an empty
 * answer is not a success). The record is already gone by then, so a file that cannot be deleted is not an error: it is reported
 * as `fileLeft`, the sentence for the person, which is `refusedMessage` when storage refused and `failedMessage` when the delete
 * itself failed (the caller words both, and neither may tell the person to retry). `fileLeft` is null when the file was deleted and
 * when the record had no stored file (nothing is asked of storage then). A record that cannot be removed throws, and the file is
 * left alone.
 */
export async function removeFinanceDocument(documentId: number, sentences: { refusedMessage: string; failedMessage: string }): Promise<{ fileLeft: string | null }> {
  const storagePath = must(await connected().rpc("remove_finance_document", { p_document_id: documentId }));
  if (typeof storagePath !== "string") return { fileLeft: null };
  const fileLeft = await removeStoredFile("finance-private", storagePath, { refusedMessage: sentences.refusedMessage, failedMessage: sentences.failedMessage });
  return { fileLeft };
}
