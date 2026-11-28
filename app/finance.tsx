"use client";

import type { User } from "@supabase/supabase-js";
import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { clubToday, formatDay } from "../lib/dates";
import { supabase } from "../lib/supabase";
import { readCache, writeCache } from "../lib/cache";
import { friendlyError } from "../lib/errors";
import { formatMoney } from "../lib/format";
import { canManageClub } from "../lib/permissions";
import { REFRESH_WAIT_MS, waitAtMost } from "../lib/bounded-wait";
import { financeRefreshFailed } from "../lib/finance-load";
import { createRequestGate } from "../lib/request-gate";
import { createSingleFlight } from "../lib/single-flight";
import { removeStoredFile } from "../lib/storage";
import type { ClubRole, Tables } from "../lib/db";
import type { Notify } from "../lib/toast";
import { ConfirmDialog } from "../components/ui/confirm-dialog";
import { LoadErrorBanner } from "../components/ui/load-error";
import { FormDialog, type FormField } from "../components/ui/form-dialog";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Dialog } from "../components/ui/dialog";

type Subgroup = Pick<Tables<"subgroups">, "id" | "name">;
type ClubEvent = Pick<Tables<"events">, "id" | "title" | "starts_at">;
// paid_by and direction are text columns with a CHECK constraint, so the generated type is `string`; the UI knows the two values.
type Expense = Pick<Tables<"finance_expenses">, "id" | "description" | "vendor" | "amount" | "purchase_date" | "category" | "paid_by_member_id"
  | "payment_card_last4" | "subgroup_id" | "club_event_id" | "event_related" | "event_name" | "event_starts_at"
  | "event_attendee_count" | "event_schedule" | "status" | "created_by"> & { paid_by: "club" | "member" };
type Reimbursement = Pick<Tables<"personal_reimbursements">, "id" | "expense_id" | "member_id" | "requested_amount" | "approved_amount" | "status"
  | "member_note" | "review_note" | "created_at"> & Partial<Pick<Tables<"personal_reimbursements">, "void_reason">>;
type Payment = Pick<Tables<"finance_payments">, "id" | "purpose" | "amount" | "description" | "category" | "account_name" | "counterparty"
  | "payment_date" | "status" | "reimbursement_id" | "funding_claim_id"> & Partial<Pick<Tables<"finance_payments">, "expense_id">> & { direction: "inflow" | "outflow" };
type FundingClaim = Pick<Tables<"funding_claims">, "id" | "title" | "funder_name" | "award_reference" | "heellife_reference" | "requested_amount"
  | "approved_amount" | "received_amount" | "submission_deadline" | "status" | "notes">;
type ClaimExpense = Pick<Tables<"funding_claim_expenses">, "claim_id" | "expense_id" | "claimed_amount">;
type FinanceDocument = Pick<Tables<"finance_documents">, "id" | "document_type" | "title" | "storage_path" | "uploaded_by">;
type ExpenseDocument = Pick<Tables<"finance_expense_documents">, "expense_id" | "document_id">;
type ReimbursementDocument = Pick<Tables<"finance_reimbursement_documents">, "reimbursement_id" | "document_id">;
type ClaimDocument = Pick<Tables<"finance_claim_documents">, "claim_id" | "document_id">;
type Profile = Pick<Tables<"profiles">, "id" | "full_name" | "email">;
type FinanceView = "overview" | "expenses" | "reimbursements" | "claims";
// `warning` is for a change that went through but left something undone; it is shown instead of the success message.
type ActionResult = PromiseLike<{ error: { message?: string; code?: string } | null; warning?: string }>;
type FinanceAction = { title: string; description?: string; fields: FormField[]; submitLabel: string; danger?: boolean; success: string; run: (values: Record<string, string>) => ActionResult };
type FinanceSummary = { available_cash: number; income: number; spending: number; pending_reimbursement_total: number; pending_reimbursement_count: number; expected_funding: number };
const reasonField = (label = "Reason"): FormField => ({ name: "reason", label, type: "textarea", required: true, minLength: 3, maxLength: 500, placeholder: "Kept in the audit trail" });
type FinanceSnapshot = { expenses: Expense[]; reimbursements: Reimbursement[]; payments: Payment[]; documents: FinanceDocument[]; expenseDocuments: ExpenseDocument[]; reimbursementDocuments: ReimbursementDocument[]; claims: FundingClaim[]; claimExpenses: ClaimExpense[]; claimDocuments: ClaimDocument[]; profiles: Profile[]; summary: FinanceSummary | null };
const LIST_LIMIT = 500;
// Shown when the lists have not come back REFRESH_WAIT_MS after a change that was saved.
const REFRESH_SLOW_NOTICE = "Saved. The lists are slow to refresh and will update on their own.";
// The same, for a refresh run after a change that was NOT saved: it must not say "Saved".
const REFRESH_SLOW_NOTICE_UNSAVED = "The lists are slow to refresh and will update on their own.";
// Said after a document's record is removed but its file could not be: a retry cannot help, the record is gone.
const FILE_LEFT_IN_STORAGE = "The document was removed from the request, but its file is still in storage and could not be deleted. Ask an administrator to remove it.";
type FinanceModal = "reimbursement" | "expense" | "income" | "claim" | null;
// One-click changes that need a yes first: paying out money, and sending a claim to the funder (it cannot go back to editing).
type FinanceConfirm = { kind: "pay"; request: Reimbursement } | { kind: "submit"; claim: FundingClaim } | null;

const expenseCategories = ["Food", "Instruments", "Venue", "Travel", "Publicity", "Performance", "Supplies", "Fees", "Other"];
const incomeCategories = ["Gig revenue", "Ticket sales", "Merchandise", "Membership dues", "Donation", "Sponsorship", "Grant", "Other"];

export function FinancePage({ user, role, groups, events, notify }: {
  user: User;
  role: ClubRole;
  groups: Subgroup[];
  events: ClubEvent[];
  notify: Notify;
}) {
  const canManage = canManageClub(role);
  const [view, setView] = useState<FinanceView>(canManage ? "overview" : "reimbursements");
  const [modal, setModal] = useState<FinanceModal>(null);
  const [claimUploadId, setClaimUploadId] = useState<number | null>(null);
  const [claimPaymentId, setClaimPaymentId] = useState<number | null>(null);
  // Reopening the screen shows the last data at once and refreshes behind it.
  const [cached] = useState(() => readCache<FinanceSnapshot>(user.id, "finance"));
  const [expenses, setExpenses] = useState<Expense[]>(cached?.expenses || []);
  const [reimbursements, setReimbursements] = useState<Reimbursement[]>(cached?.reimbursements || []);
  const [payments, setPayments] = useState<Payment[]>(cached?.payments || []);
  const [claims, setClaims] = useState<FundingClaim[]>(cached?.claims || []);
  const [claimExpenses, setClaimExpenses] = useState<ClaimExpense[]>(cached?.claimExpenses || []);
  const [documents, setDocuments] = useState<FinanceDocument[]>(cached?.documents || []);
  const [expenseDocuments, setExpenseDocuments] = useState<ExpenseDocument[]>(cached?.expenseDocuments || []);
  const [reimbursementDocuments, setReimbursementDocuments] = useState<ReimbursementDocument[]>(cached?.reimbursementDocuments || []);
  const [claimDocuments, setClaimDocuments] = useState<ClaimDocument[]>(cached?.claimDocuments || []);
  const [profiles, setProfiles] = useState<Profile[]>(cached?.profiles || []);
  const [loading, setLoading] = useState(!cached);
  // A failed refresh keeps what is on screen; `loaded` says whether anything real is.
  const [loadFailed, setLoadFailed] = useState(false);
  const [loaded, setLoaded] = useState(Boolean(cached));
  const [loadGate] = useState(createRequestGate);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState("");
  const [flowFilter, setFlowFilter] = useState("all");
  const [eventRelated, setEventRelated] = useState(false);
  const [selectedClaimExpenses, setSelectedClaimExpenses] = useState<Set<number>>(new Set());
  const [action, setAction] = useState<FinanceAction | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  // The one-click changes (Mark paid, claim status) run one at a time. `pendingKey` says which is
  // running so its button can show it; `flight` stops a second click before the next render.
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [flight] = useState(createSingleFlight);
  const [confirming, setConfirming] = useState<FinanceConfirm>(null);
  const [summary, setSummary] = useState<FinanceSummary | null>(cached?.summary ?? null);
  const [receiptRequestId, setReceiptRequestId] = useState<number | null>(null);

  const loadFinance = useCallback(async () => {
    const client = supabase;
    if (!client) return;
    if (!readCache(user.id, "finance")) setLoading(true);
    const isCurrent = loadGate.begin();
    const none = Promise.resolve({ data: [] as unknown[], error: null });
    // Everything in one wave (it used to be three, one after another). The
    // lists show the latest LIST_LIMIT rows; totals come from the database.
    const [expenseResult, reimbursementResult, paymentResult, documentResult, expenseDocumentResult, reimbursementDocumentResult, summaryResult, claimResult, claimExpenseResult, claimDocumentResult, profileResult] = await Promise.all([
      client.from("finance_expenses").select("*").order("purchase_date", { ascending: false }).order("id", { ascending: false }).limit(LIST_LIMIT),
      client.from("personal_reimbursements").select("*").order("created_at", { ascending: false }).limit(LIST_LIMIT),
      client.from("finance_payments").select("*").order("payment_date", { ascending: false }).order("id", { ascending: false }).limit(LIST_LIMIT),
      client.from("finance_documents").select("id,document_type,title,storage_path,uploaded_by").order("created_at", { ascending: false }).limit(LIST_LIMIT * 4),
      client.from("finance_expense_documents").select("expense_id,document_id").limit(LIST_LIMIT * 4),
      client.from("finance_reimbursement_documents").select("reimbursement_id,document_id").limit(LIST_LIMIT * 4),
      client.rpc("get_finance_summary"),
      canManage ? client.from("funding_claims").select("*").order("created_at", { ascending: false }).limit(LIST_LIMIT) : none,
      canManage ? client.from("funding_claim_expenses").select("claim_id,expense_id,claimed_amount").limit(LIST_LIMIT * 4) : none,
      canManage ? client.from("finance_claim_documents").select("claim_id,document_id").limit(LIST_LIMIT * 4) : none,
      canManage ? client.from("profiles").select("id,full_name,email").order("full_name").limit(2000) : none,
    ]);
    if (!isCurrent()) return;
    // One failed query must not blank the lists (the balance would read $0.00): keep what is shown.
    // The totals RPC counts too. Without it the cards would fall back to sums of the (capped)
    // lists and quietly replace the database totals.
    if (financeRefreshFailed({ expenses: expenseResult, reimbursements: reimbursementResult, payments: paymentResult, documents: documentResult, expenseDocuments: expenseDocumentResult, reimbursementDocuments: reimbursementDocumentResult, summary: summaryResult, claims: claimResult, claimExpenses: claimExpenseResult, claimDocuments: claimDocumentResult, profiles: profileResult })) {
      setLoadFailed(true); setLoading(false);
      notify("Some finance records could not be loaded", "error");
      return;
    }
    setLoadFailed(false); setLoaded(true);
    const snapshot: FinanceSnapshot = {
      expenses: (expenseResult.data || []) as Expense[],
      reimbursements: (reimbursementResult.data || []) as Reimbursement[],
      payments: (paymentResult.data || []) as Payment[],
      documents: (documentResult.data || []) as FinanceDocument[],
      expenseDocuments: (expenseDocumentResult.data || []) as ExpenseDocument[],
      reimbursementDocuments: (reimbursementDocumentResult.data || []) as ReimbursementDocument[],
      claims: (claimResult.data || []) as FundingClaim[],
      claimExpenses: (claimExpenseResult.data || []) as ClaimExpense[],
      claimDocuments: (claimDocumentResult.data || []) as ClaimDocument[],
      profiles: (profileResult.data || []) as Profile[],
      summary: summaryResult.error || !summaryResult.data ? null : Object.fromEntries(Object.entries(summaryResult.data as Record<string, unknown>).map(([key, value]) => [key, Number(value)])) as FinanceSummary,
    };
    setExpenses(snapshot.expenses); setReimbursements(snapshot.reimbursements); setPayments(snapshot.payments);
    setDocuments(snapshot.documents); setExpenseDocuments(snapshot.expenseDocuments); setReimbursementDocuments(snapshot.reimbursementDocuments);
    setClaims(snapshot.claims); setClaimExpenses(snapshot.claimExpenses); setClaimDocuments(snapshot.claimDocuments);
    setProfiles(snapshot.profiles); setSummary(snapshot.summary);
    writeCache(user.id, "finance", snapshot);
    setLoading(false);
  }, [canManage, loadGate, notify, user.id]);

  useEffect(() => {
    const timer = window.setTimeout(() => { loadFinance(); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadFinance]);

  // After a change the dialog stays busy until the lists have been read again, but not for ever: a read
  // that hangs must not leave a dialog stuck on a change that already went through. After REFRESH_WAIT_MS
  // the caller moves on (the dialog closes), the read carries on in the background and the person is told.
  const refreshAfterChange = useCallback(async (saved = true) => {
    const result = await waitAtMost(loadFinance(), REFRESH_WAIT_MS);
    if (result === "timeout") { if (saved) notify(REFRESH_SLOW_NOTICE, "success"); else notify(REFRESH_SLOW_NOTICE_UNSAVED, "error"); }
  }, [loadFinance, notify]);

  const expenseById = useMemo(() => new Map(expenses.map((expense) => [expense.id, expense])), [expenses]);
  const profileById = useMemo(() => new Map(profiles.map((profile) => [profile.id, profile])), [profiles]);
  const documentById = useMemo(() => new Map(documents.map((document) => [document.id, document])), [documents]);
  // Expenses on a claim the funder has (submitted, decided or paid): their details are locked in the database.
  const lockedExpenseIds = useMemo(() => {
    const statusByClaim = new Map(claims.map((claim) => [claim.id, claim.status]));
    const open = ["draft", "incomplete", "ready", "changes_requested", "voided"];
    return new Set(claimExpenses.filter((link) => { const status = statusByClaim.get(link.claim_id); return Boolean(status) && !open.includes(status as string); }).map((link) => link.expense_id));
  }, [claims, claimExpenses]);
  const activePayments = payments.filter((payment) => payment.status !== "voided");
  const countedPayments = activePayments.filter((payment) => ["posted", "cleared"].includes(payment.status));
  const balance = countedPayments.reduce((total, payment) => total + (payment.direction === "inflow" ? Number(payment.amount) : -Number(payment.amount)), 0);
  const income = countedPayments.filter((payment) => payment.direction === "inflow").reduce((total, payment) => total + Number(payment.amount), 0);
  const spending = expenses.filter((expense) => ["approved", "settled"].includes(expense.status)).reduce((total, expense) => total + Number(expense.amount), 0);
  const pendingReimbursements = reimbursements.filter((request) => ["submitted", "changes_requested", "approved"].includes(request.status));
  const pendingTotal = pendingReimbursements.reduce((total, request) => total + Number(request.approved_amount || request.requested_amount), 0);
  const expectedFunding = claims.filter((claim) => ["approved", "partially_paid"].includes(claim.status)).reduce((total, claim) => total + Math.max(0, Number(claim.approved_amount || 0) - Number(claim.received_amount)), 0);

  async function uploadDocument(file: File, documentType: string, title: string, links: { expenseId?: number; reimbursementId?: number; claimId?: number }, last4?: string) {
    if (!supabase) throw new Error("Finance storage is unavailable");
    if (!file.size) throw new Error("Choose a document to upload");
    if (file.size > 10 * 1024 * 1024) throw new Error("Finance documents must be 10 MB or smaller");
    const inferredMime = file.type || (file.name.toLowerCase().endsWith(".pdf") ? "application/pdf" : "application/octet-stream");
    if (["bank_statement", "card_statement"].includes(documentType) && inferredMime !== "application/pdf") {
      throw new Error("Statements must be uploaded as PDF documents, not screenshots");
    }
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "-");
    const storagePath = `${user.id}/${crypto.randomUUID()}-${safeName}`;
    const uploaded = await supabase.storage.from("finance-private").upload(storagePath, file, { contentType: inferredMime, upsert: false });
    if (uploaded.error) throw uploaded.error;
    const saved = await supabase.from("finance_documents").insert({
      document_type: documentType,
      title,
      storage_path: storagePath,
      mime_type: inferredMime,
      file_size_bytes: file.size,
      payment_card_last4: last4 || null,
      uploaded_by: user.id,
    }).select("id").single();
    if (saved.error || !saved.data) throw saved.error || new Error("Document record could not be created");
    const documentId = Number(saved.data.id);
    const linkRequests = [];
    if (links.expenseId) linkRequests.push(supabase.from("finance_expense_documents").insert({ expense_id: links.expenseId, document_id: documentId }));
    if (links.reimbursementId) linkRequests.push(supabase.from("finance_reimbursement_documents").insert({ reimbursement_id: links.reimbursementId, document_id: documentId }));
    if (links.claimId) linkRequests.push(supabase.from("finance_claim_documents").insert({ claim_id: links.claimId, document_id: documentId }));
    const linked = await Promise.all(linkRequests);
    const linkError = linked.find((request) => request.error)?.error;
    if (linkError) throw linkError;
    return documentId;
  }

  async function openDocument(documentId: number) {
    if (!supabase) return;
    const document = documentById.get(documentId);
    if (!document) return;
    const { data, error } = await supabase.storage.from("finance-private").createSignedUrl(document.storage_path, 90);
    if (error || !data) notify("This finance document could not be opened", "error");
    else window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  }

  async function submitReimbursement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return;
    setSaving(true);
    const form = new FormData(event.currentTarget);
    const receipt = form.get("receipt") as File;
    const statement = form.get("statement") as File;
    const last4 = String(form.get("last4") || "").trim();
    const subgroupValue = String(form.get("subgroup_id") || "");
    const { data, error } = await supabase.rpc("submit_member_reimbursement", {
      p_description: String(form.get("description") || ""),
      p_vendor: String(form.get("vendor") || ""),
      p_amount: Number(form.get("amount")),
      p_purchase_date: String(form.get("purchase_date") || ""),
      p_category: String(form.get("category") || "Other"),
      p_payment_card_last4: last4,
      p_member_note: String(form.get("note") || ""),
      p_subgroup_id: subgroupValue ? Number(subgroupValue) : null,
      p_club_event_id: form.get("club_event_id") ? Number(form.get("club_event_id")) : null,
      p_event_related: form.get("event_related") === "on",
      p_event_name: String(form.get("event_name") || ""),
      p_event_starts_at: form.get("event_starts_at") ? new Date(String(form.get("event_starts_at"))).toISOString() : null,
      p_event_attendee_count: form.get("event_attendee_count") ? Number(form.get("event_attendee_count")) : null,
      p_event_schedule: String(form.get("event_schedule") || ""),
    });
    if (error) { setSaving(false); notify(friendlyError(error, "The request could not be submitted."), "error"); return; }
    const result = (Array.isArray(data) ? data[0] : data) as { expense_id: number; reimbursement_id: number };
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
    if (!supabase) return;
    setSaving(true);
    const form = new FormData(event.currentTarget);
    const receipt = form.get("receipt") as File;
    const last4 = String(form.get("last4") || "").trim();
    const subgroupValue = String(form.get("subgroup_id") || "");
    const { data, error } = await supabase.rpc("record_club_expense", {
      p_description: String(form.get("description") || ""), p_vendor: String(form.get("vendor") || ""),
      p_amount: Number(form.get("amount")), p_purchase_date: String(form.get("purchase_date") || ""),
      p_category: String(form.get("category") || "Other"), p_account_name: String(form.get("account_name") || "Club bank account"),
      p_payment_card_last4: last4, p_subgroup_id: subgroupValue ? Number(subgroupValue) : null,
      p_club_event_id: form.get("club_event_id") ? Number(form.get("club_event_id")) : null,
      p_event_related: form.get("event_related") === "on", p_event_name: String(form.get("event_name") || ""),
      p_event_starts_at: form.get("event_starts_at") ? new Date(String(form.get("event_starts_at"))).toISOString() : null,
      p_event_attendee_count: form.get("event_attendee_count") ? Number(form.get("event_attendee_count")) : null,
      p_event_schedule: String(form.get("event_schedule") || ""),
    });
    if (error) { setSaving(false); notify(friendlyError(error, "The expense could not be recorded."), "error"); return; }
    try {
      await uploadDocument(receipt, "receipt", `Receipt — ${String(form.get("description") || "Purchase")}`, { expenseId: Number(data) }, last4);
      setModal(null); setEventRelated(false); notify("Club expense recorded"); await refreshAfterChange();
    } catch (uploadError) {
      notify(uploadError instanceof Error ? `Expense saved; ${uploadError.message}` : "Expense saved, but the receipt failed to upload", "error");
      await refreshAfterChange();
    } finally { setSaving(false); }
  }

  async function recordIncome(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return;
    setSaving(true);
    const form = new FormData(event.currentTarget);
    const { error } = await supabase.rpc("record_finance_income", {
      p_description: String(form.get("description") || ""), p_amount: Number(form.get("amount")),
      p_payment_date: String(form.get("payment_date") || ""), p_category: String(form.get("category") || "Other"),
      p_counterparty: String(form.get("counterparty") || ""), p_account_name: String(form.get("account_name") || "Club bank account"),
    });
    setSaving(false);
    if (error) notify(friendlyError(error, "The income could not be recorded."), "error"); else { setModal(null); notify("Income recorded"); loadFinance(); }
  }

  async function createClaim(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || selectedClaimExpenses.size === 0) { notify("Select at least one expense for this claim", "error"); return; }
    setSaving(true);
    const form = new FormData(event.currentTarget);
    const approval = form.get("funding_approval") as File;
    // One call creates the claim and links its expenses, so a failure leaves nothing half-made.
    const saved = await supabase.rpc("create_funding_claim", {
      p_title: String(form.get("title") || ""), p_funder_name: String(form.get("funder_name") || "GPSG Senate"),
      p_award_reference: String(form.get("award_reference") || ""), p_heellife_reference: String(form.get("heellife_reference") || ""),
      p_submission_deadline: (String(form.get("submission_deadline") || "") || null) as string, /* NULL means no deadline: the function stores it, the generated type cannot say so for a required argument */ p_notes: String(form.get("notes") || ""),
      p_expense_ids: [...selectedClaimExpenses],
    });
    if (saved.error || !saved.data) { setSaving(false); notify(friendlyError(saved.error, "Claim could not be created"), "error"); return; }
    const claimId = Number((saved.data as { id: number }).id);
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

  // Runs one of the one-click changes. A second click while one is running does nothing, and
  // the button shows it is working until the refreshed list is on screen (a paid request is
  // still listed as approved until then, with its button).
  async function runOnce(key: string, work: () => Promise<void>) {
    await flight.run(async () => {
      setPendingKey(key);
      try { await work(); }
      catch { notify("That change could not be saved. Check your connection and try again.", "error"); }
      finally { setPendingKey(null); }
    });
  }

  async function markReimbursementPaid(id: number) {
    const client = supabase; if (!client) return;
    await runOnce(`pay-${id}`, async () => {
      const { error } = await client.rpc("pay_personal_reimbursement", { p_reimbursement_id: id, p_payment_date: clubToday(), p_account_name: "Club bank account" });
      // Reload either way: a failure usually means another executive already paid it.
      if (error) { notify(friendlyError(error, "The payment could not be recorded."), "error"); await refreshAfterChange(false); return; }
      notify("Reimbursement marked paid"); await refreshAfterChange();
    });
  }

  async function updateClaimStatus(claim: FundingClaim, status: string) {
    const client = supabase; if (!client) return;
    if (status === "ready" && !claimChecklist(claim).complete) { notify("Complete every required claim document first", "error"); return; }
    await runOnce(`claim-${claim.id}-${status}`, async () => {
      const { error } = await client.rpc("set_funding_claim_status", { p_claim_id: claim.id, p_status: status });
      if (error) { notify(friendlyError(error, "The claim could not be updated"), "error"); await refreshAfterChange(false); return; }
      notify("Funding claim updated"); await refreshAfterChange();
    });
  }

  async function confirmChange() {
    if (!confirming) return;
    // The dialog stays open until the change is done, then closes whatever the outcome (a toast says how it went).
    if (confirming.kind === "pay") await markReimbursementPaid(confirming.request.id);
    else await updateClaimStatus(confirming.claim, "submitted");
    setConfirming(null);
  }

  async function runAction(values: Record<string, string>) {
    const current = action;
    if (!current) return;
    await flight.run(async () => {
      // Busy until the refreshed lists are on screen, so no second change can start in between.
      setActionBusy(true);
      try {
        let outcome: Awaited<ReturnType<FinanceAction["run"]>>;
        try { outcome = await current.run(values); }
        catch { notify("That change could not be saved. Check your connection and try again.", "error"); return; }
        if (outcome.error) { notify(friendlyError(outcome.error, "That change could not be saved."), "error"); return; }
        // A change that went through but left something undone is reported as the problem it is.
        if (outcome.warning) notify(outcome.warning, "error"); else notify(current.success, "success");
        setAction(null); await refreshAfterChange();
      } finally { setActionBusy(false); }
    });
  }

  // ---- Corrections. Each opens one small dialog and calls one audited function. ----
  function askVoidPayment(payment: Payment) {
    const client = supabase; if (!client) return;
    const effect = payment.purpose === "member_reimbursement" ? "The reimbursement goes back to approved so it can be paid again."
      : payment.purpose === "external_reimbursement" ? "The funding claim's received amount is reduced."
      : payment.purpose === "direct_expense" ? "The club expense it paid for is voided too." : "It stops counting toward available cash.";
    setAction({ title: "Void this payment?", description: `${payment.description} · ${formatMoney(Number(payment.amount))}. ${effect} Nothing is deleted.`, fields: [reasonField()], submitLabel: "Void payment", danger: true, success: "Payment voided",
      run: (values) => client.rpc("void_finance_payment", { p_payment_id: payment.id, p_reason: values.reason }) });
  }
  function askVoidExpense(expense: Expense) {
    const client = supabase; if (!client) return;
    setAction({ title: "Void this expense?", description: `${expense.description} · ${formatMoney(Number(expense.amount))}. ${expense.paid_by === "club" ? "Its payment is voided with it." : "The member's reimbursement request is voided with it."} Nothing is deleted.`, fields: [reasonField()], submitLabel: "Void expense", danger: true, success: "Expense voided",
      run: (values) => client.rpc("void_finance_expense", { p_expense_id: expense.id, p_reason: values.reason }) });
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
  const expenseDetails = (expense: Expense, values: Record<string, string>) => ({
    p_description: values.description, p_vendor: values.vendor, p_category: values.category, p_payment_card_last4: values.last4 || null,
    p_subgroup_id: expense.subgroup_id, p_club_event_id: expense.club_event_id, p_event_related: expense.event_related, p_event_name: expense.event_name,
    p_event_starts_at: expense.event_starts_at, p_event_attendee_count: expense.event_attendee_count, p_event_schedule: expense.event_schedule,
  });
  function askEditExpense(expense: Expense) {
    const client = supabase; if (!client) return;
    setAction({ title: "Edit expense details", description: "The amount and date cannot be changed here. To correct those, void the expense and enter it again.", fields: expenseFields(expense, false), submitLabel: "Save changes", success: "Expense updated",
      run: (values) => client.rpc("update_finance_expense", { p_expense_id: expense.id, ...expenseDetails(expense, values) }) });
  }
  function askEditRequest(request: Reimbursement, expense: Expense) {
    const client = supabase; if (!client) return;
    setAction({ title: "Edit my request", description: request.status === "changes_requested" ? "Saving sends the request back for review." : undefined,
      fields: [...expenseFields(expense, true), { name: "note", label: "Note for the reviewer", type: "textarea", defaultValue: request.member_note, maxLength: 1000 }], submitLabel: request.status === "changes_requested" ? "Save and resubmit" : "Save changes", success: "Request updated",
      run: (values) => client.rpc("update_member_reimbursement", { p_reimbursement_id: request.id, ...expenseDetails(expense, values), p_payment_card_last4: values.last4, p_amount: Number(values.amount), p_purchase_date: values.purchase_date, p_member_note: values.note }) });
  }
  function askWithdrawRequest(request: Reimbursement) {
    const client = supabase; if (!client) return;
    setAction({ title: "Withdraw this request?", description: "It will not be reviewed or paid. You can submit a new request later.", fields: [], submitLabel: "Withdraw request", danger: true, success: "Request withdrawn",
      run: () => client.rpc("withdraw_member_reimbursement", { p_reimbursement_id: request.id }) });
  }
  function askApprove(request: Reimbursement) {
    const client = supabase; if (!client) return;
    setAction({ title: "Approve reimbursement", description: `Requested: ${formatMoney(Number(request.requested_amount))}. Lower the amount to approve part of it.`,
      fields: [{ name: "amount", label: "Amount to approve", type: "number", defaultValue: String(request.requested_amount), required: true, min: 0.01, max: Number(request.requested_amount), step: 0.01 }, { name: "note", label: "Note to the member (optional)", type: "textarea", maxLength: 1000 }], submitLabel: "Approve", success: "Reimbursement approved",
      run: (values) => client.rpc("review_personal_reimbursement", { p_reimbursement_id: request.id, p_decision: "approved", p_approved_amount: Number(values.amount), p_review_note: values.note }) });
  }
  function askDecline(request: Reimbursement) {
    const client = supabase; if (!client) return;
    setAction({ title: "Decline this request?", fields: [{ ...reasonField("Reason shown to the member"), name: "note" }], submitLabel: "Decline", danger: true, success: "Reimbursement declined",
      run: (values) => client.rpc("review_personal_reimbursement", { p_reimbursement_id: request.id, p_decision: "rejected", p_approved_amount: null, p_review_note: values.note }) });
  }
  function askRequestChanges(request: Reimbursement) {
    const client = supabase; if (!client) return;
    setAction({ title: "Ask the member for changes", description: "The member can edit the request or replace the receipt and send it back.", fields: [{ ...reasonField("What needs to change?"), name: "note" }], submitLabel: "Request changes", success: "Changes requested",
      run: (values) => client.rpc("request_reimbursement_changes", { p_reimbursement_id: request.id, p_note: values.note }) });
  }
  function askRemoveDocument(document: FinanceDocument) {
    const client = supabase; if (!client) return;
    setAction({ title: "Remove this document?", description: `"${document.title}" will be deleted. Add the replacement first if this is the only receipt.`, fields: [], submitLabel: "Remove document", danger: true, success: "Document removed",
      run: async () => {
        const removed = await client.rpc("remove_finance_document", { p_document_id: document.id });
        if (removed.error || typeof removed.data !== "string") return { error: removed.error };
        // The record goes first; the file is cleaned up after. Storage answers a refused delete with an
        // empty list and no error, so an empty answer is a failure to report, not a success. The record
        // is already gone by now, so the dialog still closes. Whatever went wrong with the file (refused,
        // a storage error, no network), the warning says the record is removed and the file is still
        // stored; the person is never told to retry. A deleted file (the usual case: the uploader and
        // the executives can delete an unregistered object) gives no warning.
        const leftover = await removeStoredFile("finance-private", removed.data, { refusedMessage: FILE_LEFT_IN_STORAGE, failedMessage: FILE_LEFT_IN_STORAGE });
        return { error: null, warning: leftover ?? undefined };
      } });
  }
  function askClaimDecision(claim: FundingClaim, status: "approved" | "changes_requested" | "denied") {
    const client = supabase; if (!client) return;
    if (status === "approved") {
      setAction({ title: "Record the funder's approval", description: `Requested: ${formatMoney(Number(claim.requested_amount))}.`, fields: [{ name: "amount", label: "Amount approved", type: "number", defaultValue: String(claim.requested_amount), required: true, min: 0.01, max: Number(claim.requested_amount), step: 0.01 }, { name: "note", label: "Note (optional)", type: "textarea" }], submitLabel: "Mark approved", success: "Claim approved",
        run: (values) => client.rpc("set_funding_claim_status", { p_claim_id: claim.id, p_status: "approved", p_approved_amount: Number(values.amount), p_note: values.note }) });
    } else {
      setAction({ title: status === "denied" ? "Mark this claim denied?" : "The funder asked for changes", fields: [{ ...reasonField(status === "denied" ? "What did the funder say?" : "What do they need?"), name: "note" }], submitLabel: status === "denied" ? "Mark denied" : "Reopen claim", danger: status === "denied", success: "Funding claim updated",
        run: (values) => client.rpc("set_funding_claim_status", { p_claim_id: claim.id, p_status: status, p_note: values.note }) });
    }
  }
  function askVoidClaim(claim: FundingClaim) {
    const client = supabase; if (!client) return;
    setAction({ title: "Void this funding claim?", description: "Its expenses are released so they can go on another claim. A claim with money received must have those payments voided first.", fields: [reasonField()], submitLabel: "Void claim", danger: true, success: "Funding claim voided",
      run: (values) => client.rpc("void_funding_claim", { p_claim_id: claim.id, p_reason: values.reason }) });
  }
  function askRemoveClaimExpense(claim: FundingClaim, expense: Expense) {
    const client = supabase; if (!client) return;
    setAction({ title: "Remove this expense from the claim?", description: `${expense.description} · ${formatMoney(Number(expense.amount))}. The claim total is reduced.`, fields: [], submitLabel: "Remove from claim", success: "Expense removed from the claim",
      run: () => client.rpc("remove_funding_claim_expense", { p_claim_id: claim.id, p_expense_id: expense.id }) });
  }
  function askAddClaimExpense(claim: FundingClaim) {
    const client = supabase; if (!client) return;
    if (!unclaimedExpenses.length) { notify("No unclaimed expenses are available", "error"); return; }
    setAction({ title: "Add an expense to this claim", fields: [{ name: "expense_id", label: "Expense", type: "select", required: true, options: unclaimedExpenses.map((expense) => ({ value: String(expense.id), label: `${expense.description} · ${formatMoney(Number(expense.amount))}` })) }], submitLabel: "Add to claim", success: "Expense added to the claim",
      run: (values) => client.rpc("add_funding_claim_expense", { p_claim_id: claim.id, p_expense_id: Number(values.expense_id) }) });
  }

  async function recordClaimPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !claimPaymentId) return;
    setSaving(true);
    const form = new FormData(event.currentTarget);
    const { error } = await supabase.rpc("record_funding_claim_payment", {
      p_claim_id: claimPaymentId, p_amount: Number(form.get("amount")),
      p_payment_date: String(form.get("payment_date") || ""), p_account_name: String(form.get("account_name") || "Club bank account"),
    });
    setSaving(false);
    if (error) notify(friendlyError(error, "The payment could not be recorded."), "error"); else { setClaimPaymentId(null); notify("Funding payment recorded"); loadFinance(); }
  }

  function claimChecklist(claim: FundingClaim) {
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

  // While any change is running, the buttons that start another one are off.
  const changing = Boolean(pendingKey) || actionBusy;
  const claimEditable = (claim: FundingClaim) => ["draft", "incomplete", "ready", "changes_requested"].includes(claim.status);
  const filteredPayments = activePayments.filter((payment) => {
    const matchesQuery = `${payment.description} ${payment.category} ${payment.counterparty}`.toLowerCase().includes(query.toLowerCase());
    return matchesQuery && (flowFilter === "all" || payment.direction === flowFilter || payment.purpose === flowFilter);
  });
  // Only approved or settled purchases can go on a claim (the database enforces the same rule).
  const unclaimedExpenses = expenses.filter((expense) => ["approved", "settled"].includes(expense.status) && !claimExpenses.some((item) => item.expense_id === expense.id && claims.some((claim) => claim.id === item.claim_id && claim.status !== "voided")));

  return <section className="section-shell page-section finance-page">
    <div className="finance-title-row"><div className="page-title"><p className="eyebrow">{canManage ? "FINANCE WORKSPACE" : "MEMBER FINANCES"}</p><h1>{canManage ? "Club finances" : "My reimbursements"}</h1><p>{canManage ? "Purchases, payments, member reimbursements, and funding claims—connected without double-counting." : "Submit purchases you made for the club and follow each request through review and payment."}</p></div><div className="finance-actions">{canManage && <><Button variant="secondary" onClick={() => setModal("income")}>＋ Record income</Button><Button variant="secondary" onClick={() => setModal("expense")}>＋ Club expense</Button></>}<Button onClick={() => setModal("reimbursement")}>＋ Request reimbursement</Button></div></div>
    {loadFailed && <LoadErrorBanner message={loaded ? "Some finance records could not be refreshed, so the figures below may be out of date." : "The finance records could not be loaded."} onRetry={() => void loadFinance()} />}
    {(loaded || !loadFailed) && <>

    {canManage ? <div className="finance-summary finance-summary-v2"><SummaryCard label="Available cash" value={formatMoney(summary?.available_cash ?? balance)} detail="Posted and cleared payments" /><SummaryCard label="Recorded income" value={formatMoney(summary?.income ?? income)} detail="All incoming payments" tone="positive" /><SummaryCard label="Club spending" value={formatMoney(summary?.spending ?? spending)} detail="Approved and settled purchases" /><SummaryCard label="Pending reimbursements" value={formatMoney(summary?.pending_reimbursement_total ?? pendingTotal)} detail={`${summary?.pending_reimbursement_count ?? pendingReimbursements.length} awaiting action`} tone={pendingReimbursements.length ? "warning" : undefined} /><SummaryCard label="Expected funding" value={formatMoney(summary?.expected_funding ?? expectedFunding)} detail="Approved, not yet received" tone="positive" /></div> : <div className="finance-summary finance-summary-v2 member"><SummaryCard label="Requested" value={formatMoney(reimbursements.reduce((sum, item) => sum + Number(item.requested_amount), 0))} detail="All my requests" /><SummaryCard label="Awaiting review" value={String(reimbursements.filter((item) => item.status === "submitted").length)} detail="Submitted requests" tone="warning" /><SummaryCard label="Paid" value={formatMoney(reimbursements.filter((item) => item.status === "paid").reduce((sum, item) => sum + Number(item.approved_amount || 0), 0))} detail="Completed reimbursements" tone="positive" /></div>}

    <div className="finance-tabs" role="tablist">{(canManage ? ["overview", "expenses", "reimbursements", "claims"] : ["reimbursements"] as FinanceView[]).map((item) => <button key={item} role="tab" aria-selected={view === item} className={view === item ? "active" : ""} onClick={() => setView(item as FinanceView)}>{item === "claims" ? "Funding claims" : item}</button>)}</div>

    {loading ? <div className="inline-loading">Loading finance workspace…</div> : <>
      {canManage && view === "overview" && <div className="finance-overview-grid"><section className="finance-panel"><PanelHeading title="Cash ledger" meta={payments.length >= LIST_LIMIT ? `Latest ${LIST_LIMIT} payments` : `${filteredPayments.length} payments`} /><div className="finance-ledger-tools"><label className="search">⌕<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search payments" /></label><select aria-label="Filter cash ledger" value={flowFilter} onChange={(event) => setFlowFilter(event.target.value)}><option value="all">All activity</option><option value="inflow">Money in</option><option value="outflow">Money out</option><option value="member_reimbursement">Member reimbursements</option><option value="external_reimbursement">Funding received</option></select></div><PaymentLedger payments={filteredPayments} onVoid={askVoidPayment} disabled={changing} /></section><aside className="finance-panel"><PanelHeading title="Action queue" meta="Needs attention" />{pendingReimbursements.length ? pendingReimbursements.slice(0, 4).map((request) => <button className="finance-queue-item" key={request.id} onClick={() => setView("reimbursements")}><span>Member reimbursement</span><b>{expenseById.get(request.expense_id)?.description || "Purchase"}</b><small>{formatMoney(Number(request.requested_amount))} · {request.status}</small></button>) : <p className="finance-empty-copy">No reimbursements need attention.</p>}{claims.filter((claim) => !["paid", "denied", "voided"].includes(claim.status)).slice(0, 3).map((claim) => <button className="finance-queue-item" key={claim.id} onClick={() => setView("claims")}><span>Funding claim</span><b>{claim.title}</b><small>{claimChecklist(claim).checks.filter((check) => check.done).length}/6 requirements · {claim.status}</small></button>)}</aside></div>}

      {canManage && view === "expenses" && <section className="finance-panel"><PanelHeading title="Expense register" meta={expenses.length >= LIST_LIMIT ? `Latest ${LIST_LIMIT} purchases` : `${expenses.length} purchases`} />{expenses.length ? <div className="finance-table"><div className="finance-table-head"><span>Purchase</span><span>Paid by</span><span>Status</span><span>Amount</span></div>{expenses.map((expense) => <div className="finance-table-row" key={expense.id}><div><b>{expense.description}</b><small>{expense.vendor || expense.category} · {formatDay(expense.purchase_date)}{expense.payment_card_last4 ? ` · •••• ${expense.payment_card_last4}` : ""}</small></div><span>{expense.paid_by === "member" ? profileById.get(expense.paid_by_member_id || "")?.full_name || "Member" : "Club account"}</span><StatusBadge status={expense.status} /><strong>{formatMoney(Number(expense.amount))}{expense.status !== "voided" && <span className="finance-row-actions">{!lockedExpenseIds.has(expense.id) && <button type="button" className="finance-row-action" disabled={changing} onClick={() => askEditExpense(expense)}>Edit</button>}<button type="button" className="finance-row-action" disabled={changing} onClick={() => askVoidExpense(expense)}>Void</button></span>}</strong></div>)}</div> : <FinanceEmpty title="No expenses yet" text="Record a club purchase or approve a member reimbursement." />}</section>}

      {view === "reimbursements" && <section className="finance-panel"><PanelHeading title={canManage ? "Member reimbursements" : "My requests"} meta={`${reimbursements.length} requests`} />{reimbursements.length ? <div className="reimbursement-list">{reimbursements.map((request) => { const expense = expenseById.get(request.expense_id); const receiptIds = reimbursementDocuments.filter((item) => item.reimbursement_id === request.id).map((item) => item.document_id); return <article className="reimbursement-card" key={request.id}><div className="reimbursement-main"><div><p className="eyebrow">{canManage ? profileById.get(request.member_id)?.full_name || profileById.get(request.member_id)?.email || "CLUB MEMBER" : "MY REQUEST"}</p><h3>{expense?.description || "Club purchase"}</h3><p>{expense?.vendor || expense?.category} · Purchased {expense ? formatDay(expense.purchase_date) : "recently"}</p></div><div className="reimbursement-amount"><strong>{formatMoney(Number(request.approved_amount || request.requested_amount))}</strong><StatusBadge status={request.status} /></div></div>{request.member_note && <p className="reimbursement-note">“{request.member_note}”</p>}{request.review_note && <p className="reimbursement-note"><b>{request.status === "changes_requested" ? "Changes requested: " : "Reviewer: "}</b>{request.review_note}</p>}{request.status === "voided" && request.void_reason && <p className="reimbursement-note"><b>Voided: </b>{request.void_reason}</p>}<div className="reimbursement-footer"><div>{receiptIds.map((documentId) => { const document = documentById.get(documentId); const removable = document && ["submitted", "changes_requested"].includes(request.status) && (canManage || document.uploaded_by === user.id); return <span key={documentId} className="document-chip-group"><button className="document-chip" onClick={() => openDocument(documentId)}>▤ {document?.title || "Document"}</button>{removable && <button type="button" className="finance-row-action" onClick={() => askRemoveDocument(document)} aria-label={`Remove ${document.title}`}>×</button>}</span>; })}{request.member_id === user.id && ["submitted", "changes_requested"].includes(request.status) && <button type="button" className="document-chip" onClick={() => setReceiptRequestId(request.id)}>＋ Add receipt</button>}</div><div className="reimbursement-actions">{request.member_id === user.id && expense && ["submitted", "changes_requested"].includes(request.status) && <><button className="secondary" onClick={() => askEditRequest(request, expense)}>{request.status === "changes_requested" ? "Edit and resubmit" : "Edit"}</button><button className="secondary" onClick={() => askWithdrawRequest(request)}>Withdraw</button></>}{canManage && request.member_id === user.id && request.status === "submitted" && <small>Another executive must review your own request.</small>}{canManage && request.member_id !== user.id && request.status === "submitted" && <><button className="secondary" onClick={() => askDecline(request)}>Decline</button><button className="secondary" onClick={() => askRequestChanges(request)}>Request changes</button><button className="primary" onClick={() => askApprove(request)}>Approve</button></>}{canManage && request.status === "approved" && <button className="primary" disabled={changing} onClick={() => setConfirming({ kind: "pay", request })}>{pendingKey === `pay-${request.id}` ? "Paying…" : "Mark paid"}</button>}{canManage && request.status === "paid" && (() => { const payment = activePayments.find((item) => item.reimbursement_id === request.id); return payment ? <button className="secondary" disabled={changing} onClick={() => askVoidPayment(payment)}>Void payment</button> : null; })()}{canManage && expense && request.member_id !== user.id && ["submitted", "changes_requested", "approved", "rejected"].includes(request.status) && <button className="secondary" disabled={changing} onClick={() => askVoidExpense(expense)}>Void</button>}</div></div></article>; })}</div> : <FinanceEmpty title="No reimbursement requests" text={canManage ? "Member requests will appear here for review." : "Use Request reimbursement when you buy something for the club."} />}</section>}

      {canManage && view === "claims" && <section className="finance-panel"><div className="panel-heading"><div><h2>Senate & external funding</h2><span>Build submission-ready reimbursement packets</span></div><Button onClick={() => setModal("claim")}>＋ New funding claim</Button></div>{claims.length ? <div className="claim-grid">{claims.map((claim) => { const checklist = claimChecklist(claim); return <article className="claim-card" key={claim.id}><div className="claim-card-head"><div><p className="eyebrow">{claim.funder_name}</p><h3>{claim.title}</h3><small>{formatMoney(Number(claim.requested_amount))} requested{claim.submission_deadline ? ` · Due ${formatDay(claim.submission_deadline)}` : ""}</small></div><StatusBadge status={claim.status} /></div><div className="claim-progress"><div><span style={{ width: `${(checklist.checks.filter((check) => check.done).length / checklist.checks.length) * 100}%` }} /></div><b>{checklist.checks.filter((check) => check.done).length} of {checklist.checks.length} ready</b></div><ul className="claim-checklist">{checklist.checks.map((check) => <li className={check.done ? "done" : ""} key={check.label}><span>{check.done ? "✓" : "○"}</span>{check.label}</li>)}</ul><div className="claim-expenses">{checklist.linkedExpenses.map((expense) => <span key={expense.id}>{expense.description} · {formatMoney(Number(expense.amount))}{claimEditable(claim) && checklist.linkedExpenses.length > 1 && <button type="button" className="finance-row-action" onClick={() => askRemoveClaimExpense(claim, expense)} aria-label={`Remove ${expense.description} from this claim`}>×</button>}</span>)}{claimEditable(claim) && <button type="button" className="finance-row-action" onClick={() => askAddClaimExpense(claim)}>＋ Add expense</button>}</div>{claim.status === "approved" || claim.status === "partially_paid" || claim.status === "paid" ? <small>{formatMoney(Number(claim.received_amount))} received of {formatMoney(Number(claim.approved_amount || 0))} approved</small> : null}<div className="claim-actions">{claim.status !== "voided" && <Button variant="secondary" size="sm" onClick={() => setClaimUploadId(claim.id)}>＋ Document</Button>}{["draft", "incomplete", "changes_requested"].includes(claim.status) && <Button variant="secondary" size="sm" disabled={!checklist.complete || changing} onClick={() => updateClaimStatus(claim, "ready")}>{pendingKey === `claim-${claim.id}-ready` ? "Saving…" : "Mark ready"}</Button>}{claim.status === "ready" && <Button size="sm" disabled={changing} onClick={() => setConfirming({ kind: "submit", claim })}>{pendingKey === `claim-${claim.id}-submitted` ? "Submitting…" : "Mark submitted"}</Button>}{claim.status === "ready" && <Button variant="secondary" size="sm" disabled={changing} onClick={() => updateClaimStatus(claim, "incomplete")}>{pendingKey === `claim-${claim.id}-incomplete` ? "Saving…" : "Back to editing"}</Button>}{claim.status === "submitted" && <><Button variant="secondary" size="sm" onClick={() => askClaimDecision(claim, "changes_requested")}>Changes requested</Button><Button variant="secondary" size="sm" onClick={() => askClaimDecision(claim, "denied")}>Denied</Button><Button size="sm" onClick={() => askClaimDecision(claim, "approved")}>Mark approved</Button></>}{["approved", "partially_paid"].includes(claim.status) && <Button size="sm" onClick={() => setClaimPaymentId(claim.id)}>Record payment</Button>}{claim.status !== "voided" && <Button variant="ghost" size="sm" disabled={changing} onClick={() => askVoidClaim(claim)}>Void claim</Button>}</div></article>; })}</div> : <FinanceEmpty title="No funding claims yet" text="Group eligible expenses into a Senate or external reimbursement packet." />}</section>}
    </>}
    </>}

    {modal === "reimbursement" && <ModalShell title="Request reimbursement" eyebrow="MEMBER PURCHASE" onClose={() => { setModal(null); setEventRelated(false); }}><PurchaseForm mode="member" groups={groups} events={events} eventRelated={eventRelated} setEventRelated={setEventRelated} saving={saving} onSubmit={submitReimbursement} /></ModalShell>}
    {modal === "expense" && <ModalShell title="Record club expense" eyebrow="CLUB PURCHASE" onClose={() => { setModal(null); setEventRelated(false); }}><PurchaseForm mode="club" groups={groups} events={events} eventRelated={eventRelated} setEventRelated={setEventRelated} saving={saving} onSubmit={recordExpense} /></ModalShell>}
    {modal === "income" && <ModalShell title="Record money received" eyebrow="INCOME" onClose={() => setModal(null)}><form onSubmit={recordIncome}><label>Description<input name="description" required placeholder="Gig at Memorial Hall" /></label><div className="form-pair"><label>Amount<input name="amount" type="number" min="0.01" step="0.01" required /></label><label>Date received<input name="payment_date" type="date" defaultValue={clubToday()} required /></label></div><div className="form-pair"><label>Income source<select name="category" defaultValue="Gig revenue">{incomeCategories.map((category) => <option key={category}>{category}</option>)}</select></label><label>Paid by<input name="counterparty" placeholder="Client, donor, or customer" /></label></div><label>Deposited into<input name="account_name" defaultValue="Club bank account" required /></label><button className="primary modal-submit" disabled={saving}>{saving ? "Saving…" : "Record income"}</button></form></ModalShell>}
    {modal === "claim" && <ModalShell title="Build a funding claim" eyebrow="SENATE / EXTERNAL FUNDING" onClose={() => { setModal(null); setSelectedClaimExpenses(new Set()); }}><form onSubmit={createClaim}><label>Claim title<input name="title" required placeholder="Fall concert food reimbursement" /></label><div className="form-pair"><label>Funding organization<input name="funder_name" defaultValue="GPSG Senate" required /></label><label>Submission deadline<input name="submission_deadline" type="date" /></label></div><div className="form-pair"><label>Award reference<input name="award_reference" placeholder="Award letter or request ID" /></label><label>HeelLife reference<input name="heellife_reference" placeholder="Form or submission ID" /></label></div><fieldset className="claim-expense-picker"><legend>Expenses included</legend>{unclaimedExpenses.length ? unclaimedExpenses.map((expense) => <label key={expense.id}><input type="checkbox" aria-label={`Include ${expense.description}`} checked={selectedClaimExpenses.has(expense.id)} onChange={(event) => setSelectedClaimExpenses((current) => { const next = new Set(current); if (event.target.checked) next.add(expense.id); else next.delete(expense.id); return next; })} /><span><b>{expense.description}</b><small>{formatDay(expense.purchase_date)} · {formatMoney(Number(expense.amount))}</small></span></label>) : <p>No unclaimed expenses are available.</p>}</fieldset><label>Proof of funding approval<input name="funding_approval" type="file" accept="application/pdf,image/jpeg,image/png" required /></label><label>Notes<textarea name="notes" rows={3} /></label><button className="primary modal-submit" disabled={saving || selectedClaimExpenses.size === 0}>{saving ? "Creating…" : `Create claim · ${formatMoney(expenses.filter((expense) => selectedClaimExpenses.has(expense.id)).reduce((sum, expense) => sum + Number(expense.amount), 0))}`}</button></form></ModalShell>}
    {claimUploadId && <ModalShell title="Add claim document" eyebrow="SECURE FINANCE FILE" onClose={() => setClaimUploadId(null)}><form onSubmit={uploadClaimDocument}><label>Document type<select name="document_type" required><option value="bank_statement">Bank statement PDF</option><option value="card_statement">Credit card statement PDF</option><option value="event_support">Event flyer or agenda</option><option value="funding_approval">Funding approval</option><option value="heellife_submission">HeelLife submission</option><option value="proof_of_payment">Proof of payment</option><option value="other">Other supporting document</option></select></label><label>Title<input name="title" required placeholder="March bank statement" /></label><label>File<input name="file" type="file" accept="application/pdf,image/jpeg,image/png" required /></label><p className="finance-privacy-note">Statements must be PDFs. Sensitive files are stored separately from the club archive and are visible only to their uploader and executives.</p><button className="primary modal-submit" disabled={saving}>{saving ? "Uploading…" : "Add document"}</button></form></ModalShell>}
    {claimPaymentId && <ModalShell title="Record funding payment" eyebrow="MONEY RECEIVED" onClose={() => setClaimPaymentId(null)}><form onSubmit={recordClaimPayment}><label>Amount received<input name="amount" type="number" min="0.01" step="0.01" required /></label><label>Date received<input name="payment_date" type="date" defaultValue={clubToday()} required /></label><label>Deposited into<input name="account_name" defaultValue="Club bank account" required /></label><button className="primary modal-submit" disabled={saving}>{saving ? "Saving…" : "Record payment"}</button></form></ModalShell>}
    {receiptRequestId && <ModalShell title="Add a receipt" eyebrow="SECURE FINANCE FILE" onClose={() => setReceiptRequestId(null)}><form onSubmit={uploadRequestReceipt}><label>Title<input name="title" required defaultValue="Receipt" /></label><label>File<input name="file" type="file" accept="application/pdf,image/jpeg,image/png" required /></label><button className="primary modal-submit" disabled={saving}>{saving ? "Uploading…" : "Add receipt"}</button></form></ModalShell>}
    <ConfirmDialog open={confirming?.kind === "pay"} title="Mark this reimbursement as paid?" confirmLabel="Mark paid" busy={Boolean(pendingKey)} onConfirm={() => void confirmChange()} onCancel={() => setConfirming(null)}>
      {confirming?.kind === "pay" && <p className="m-0">Record a payment of {formatMoney(Number(confirming.request.approved_amount || confirming.request.requested_amount))} to {profileById.get(confirming.request.member_id)?.full_name || "the member"} for &ldquo;{expenseById.get(confirming.request.expense_id)?.description || "this purchase"}&rdquo;. It leaves the club bank account today and lowers available cash. If it was a mistake, void the payment afterwards.</p>}
    </ConfirmDialog>
    <ConfirmDialog open={confirming?.kind === "submit"} title="Mark this claim as submitted?" confirmLabel="Mark submitted" busy={Boolean(pendingKey)} onConfirm={() => void confirmChange()} onCancel={() => setConfirming(null)}>
      {confirming?.kind === "submit" && <p className="m-0">&ldquo;{confirming.claim.title}&rdquo; goes to {confirming.claim.funder_name} as submitted. It cannot go back to editing; from here it can only be approved, sent back for changes, or denied.</p>}
    </ConfirmDialog>
    <FormDialog key={action?.title || "none"} open={Boolean(action)} title={action?.title || ""} description={action?.description} fields={action?.fields || []} submitLabel={action?.submitLabel || "Save"} danger={action?.danger} busy={actionBusy} onSubmit={runAction} onCancel={() => setAction(null)} />
  </section>;
}

function PurchaseForm({ mode, groups, events, eventRelated, setEventRelated, saving, onSubmit }: {
  mode: "member" | "club"; groups: Subgroup[]; events: ClubEvent[]; eventRelated: boolean;
  setEventRelated: (value: boolean) => void; saving: boolean; onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return <form onSubmit={onSubmit}><label>What was purchased?<input name="description" required placeholder="Food for fall concert rehearsal" /></label><div className="form-pair"><label>Vendor<input name="vendor" required placeholder="Vendor or store" /></label><label>Amount<input name="amount" type="number" min="0.01" step="0.01" required /></label></div><div className="form-pair"><label>Exact purchase date<input name="purchase_date" type="date" defaultValue={clubToday()} required /></label><label>Category<select name="category" defaultValue="Food">{expenseCategories.map((category) => <option key={category}>{category}</option>)}</select></label></div><div className="form-pair"><label>Card last four digits<input name="last4" inputMode="numeric" pattern="[0-9]{4}" maxLength={4} required placeholder="1234" /></label>{mode === "club" ? <label>Paid from<input name="account_name" defaultValue="Club bank account" required /></label> : <label>Related subgroup<select name="subgroup_id" defaultValue=""><option value="">Club-wide</option>{groups.map((group) => <option value={group.id} key={group.id}>{group.name}</option>)}</select></label>}</div>{mode === "club" && <label>Related subgroup<select name="subgroup_id" defaultValue=""><option value="">Club-wide</option>{groups.map((group) => <option value={group.id} key={group.id}>{group.name}</option>)}</select></label>}<label className="finance-check"><input name="event_related" type="checkbox" checked={eventRelated} onChange={(event) => setEventRelated(event.target.checked)} /> This purchase was for an event</label>{eventRelated && <div className="event-proof-fields"><label>Club calendar event<select name="club_event_id" defaultValue=""><option value="">Not listed on the calendar</option>{events.map((event) => <option value={event.id} key={event.id}>{event.title} · {formatDay(event.starts_at)}</option>)}</select></label><div className="form-pair"><label>Event name<input name="event_name" required /></label><label>Event date and time<input name="event_starts_at" type="datetime-local" required /></label></div><label>Number of attendees<input name="event_attendee_count" type="number" min="0" required /></label><label>Schedule / description<textarea name="event_schedule" rows={3} required /></label></div>}<label>Legible receipt<input name="receipt" type="file" accept="application/pdf,image/jpeg,image/png" required /></label>{mode === "member" && <label>Bank/card statement PDF <span className="optional">Optional now; required for Senate claims</span><input name="statement" type="file" accept="application/pdf" /></label>}{mode === "member" && <label>Note for the treasurer<textarea name="note" rows={3} placeholder="Why this purchase was needed" /></label>}<p className="finance-privacy-note">Upload only the required financial documents. Statements are kept in a private finance area and never appear in the club archive.</p><button className="primary modal-submit" disabled={saving}>{saving ? "Saving securely…" : mode === "member" ? "Submit reimbursement" : "Record club expense"}</button></form>;
}

function ModalShell({ eyebrow, title, onClose, children }: { eyebrow: string; title: string; onClose: () => void; children: ReactNode }) {
  return <Dialog open onClose={onClose} className="modal finance-modal"><Button variant="ghost" size="sm" className="modal-close" aria-label="Close" onClick={onClose}>×</Button><p className="eyebrow">{eyebrow}</p><h2 id="finance-modal-title">{title}</h2>{children}</Dialog>;
}

function SummaryCard({ label, value, detail, tone }: { label: string; value: string; detail: string; tone?: "positive" | "warning" }) {
  return <div className={tone ? `finance-stat ${tone}` : "finance-stat"}><small>{label}</small><strong>{value}</strong><span>{detail}</span></div>;
}

function PanelHeading({ title, meta }: { title: string; meta: string }) {
  return <div className="panel-heading"><div><h2>{title}</h2><span>{meta}</span></div></div>;
}

function PaymentLedger({ payments, onVoid, disabled }: { payments: Payment[]; onVoid: (payment: Payment) => void; disabled: boolean }) {
  return payments.length ? <div className="ledger finance-ledger"><div className="ledger-head"><b>Payment</b><span>Date</span><span>Account</span><span>Amount</span></div>{payments.map((payment) => <div className="ledger-row" key={payment.id}><span className={`money-mark ${payment.direction === "inflow" ? "income" : "expense"}`}>{payment.direction === "inflow" ? "+" : "−"}</span><div><b>{payment.description}</b><small>{payment.category}{payment.counterparty ? ` · ${payment.counterparty}` : ""}</small></div><span>{formatDay(payment.payment_date)}</span><span>{payment.account_name}</span><strong className={payment.direction === "inflow" ? "income" : "expense"}>{payment.direction === "inflow" ? "+" : "−"}{formatMoney(Number(payment.amount))} <button type="button" className="finance-row-action" disabled={disabled} onClick={() => onVoid(payment)} aria-label={`Void payment: ${payment.description}`}>Void</button></strong></div>)}</div> : <FinanceEmpty title="No payments yet" text="Income and paid expenses will appear in the cash ledger." />;
}

function StatusBadge({ status }: { status: string }) { return <Badge variant="muted" className={`finance-status ${status}`}>{status.replaceAll("_", " ")}</Badge>; }
function FinanceEmpty({ title, text }: { title: string; text: string }) { return <div className="finance-empty"><img className="brand-mark" src="/unc-bharat-sangeet-logo.jpg" alt="" /><h3>{title}</h3><p>{text}</p></div>; }
