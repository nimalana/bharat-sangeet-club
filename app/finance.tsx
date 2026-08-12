"use client";

import type { User } from "@supabase/supabase-js";
import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";

type ClubRole = "member" | "executive" | "admin";
type Subgroup = { id: number; name: string };
type ClubEvent = { id: number; title: string; starts_at: string };
type Expense = {
  id: number; description: string; vendor: string; amount: number; purchase_date: string;
  category: string; paid_by: "club" | "member"; paid_by_member_id: string | null;
  payment_card_last4: string | null; subgroup_id: number | null; club_event_id: number | null;
  event_related: boolean; event_name: string; event_starts_at: string | null;
  event_attendee_count: number | null; event_schedule: string; status: string; created_by: string | null;
};
type Reimbursement = {
  id: number; expense_id: number; member_id: string; requested_amount: number;
  approved_amount: number | null; status: string; member_note: string; review_note: string;
  created_at: string;
};
type Payment = {
  id: number; direction: "inflow" | "outflow"; purpose: string; amount: number;
  description: string; category: string; account_name: string; counterparty: string;
  payment_date: string; status: string; reimbursement_id: number | null; funding_claim_id: number | null;
};
type FundingClaim = {
  id: number; title: string; funder_name: string; award_reference: string;
  heellife_reference: string; requested_amount: number; approved_amount: number | null;
  received_amount: number; submission_deadline: string | null; status: string; notes: string;
};
type ClaimExpense = { claim_id: number; expense_id: number; claimed_amount: number };
type FinanceDocument = { id: number; document_type: string; title: string; storage_path: string; uploaded_by: string };
type ExpenseDocument = { expense_id: number; document_id: number };
type ReimbursementDocument = { reimbursement_id: number; document_id: number };
type ClaimDocument = { claim_id: number; document_id: number };
type Profile = { id: string; full_name: string; email: string };
type FinanceView = "overview" | "expenses" | "reimbursements" | "claims";
type FinanceModal = "reimbursement" | "expense" | "income" | "claim" | null;

const expenseCategories = ["Food", "Instruments", "Venue", "Travel", "Publicity", "Performance", "Supplies", "Fees", "Other"];
const incomeCategories = ["Gig revenue", "Ticket sales", "Merchandise", "Membership dues", "Donation", "Sponsorship", "Grant", "Other"];

export function FinancePage({ user, role, groups, events, notify }: {
  user: User;
  role: ClubRole;
  groups: Subgroup[];
  events: ClubEvent[];
  notify: (message: string) => void;
}) {
  const canManage = role !== "member";
  const [view, setView] = useState<FinanceView>(canManage ? "overview" : "reimbursements");
  const [modal, setModal] = useState<FinanceModal>(null);
  const [claimUploadId, setClaimUploadId] = useState<number | null>(null);
  const [claimPaymentId, setClaimPaymentId] = useState<number | null>(null);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [reimbursements, setReimbursements] = useState<Reimbursement[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [claims, setClaims] = useState<FundingClaim[]>([]);
  const [claimExpenses, setClaimExpenses] = useState<ClaimExpense[]>([]);
  const [documents, setDocuments] = useState<FinanceDocument[]>([]);
  const [expenseDocuments, setExpenseDocuments] = useState<ExpenseDocument[]>([]);
  const [reimbursementDocuments, setReimbursementDocuments] = useState<ReimbursementDocument[]>([]);
  const [claimDocuments, setClaimDocuments] = useState<ClaimDocument[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState("");
  const [flowFilter, setFlowFilter] = useState("all");
  const [eventRelated, setEventRelated] = useState(false);
  const [selectedClaimExpenses, setSelectedClaimExpenses] = useState<Set<number>>(new Set());

  const loadFinance = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    const baseRequests = await Promise.all([
      supabase.from("finance_expenses").select("*").order("purchase_date", { ascending: false }),
      supabase.from("personal_reimbursements").select("*").order("created_at", { ascending: false }),
      supabase.from("finance_payments").select("*").order("payment_date", { ascending: false }),
      supabase.from("finance_documents").select("id,document_type,title,storage_path,uploaded_by").order("created_at", { ascending: false }),
      supabase.from("finance_expense_documents").select("expense_id,document_id"),
      supabase.from("finance_reimbursement_documents").select("reimbursement_id,document_id"),
    ]);
    setExpenses((baseRequests[0].data || []) as Expense[]);
    setReimbursements((baseRequests[1].data || []) as Reimbursement[]);
    setPayments((baseRequests[2].data || []) as Payment[]);
    setDocuments((baseRequests[3].data || []) as FinanceDocument[]);
    setExpenseDocuments((baseRequests[4].data || []) as ExpenseDocument[]);
    setReimbursementDocuments((baseRequests[5].data || []) as ReimbursementDocument[]);
    if (baseRequests.some((request) => request.error)) notify("Some finance records could not be loaded");

    if (canManage) {
      const managementRequests = await Promise.all([
        supabase.from("funding_claims").select("*").order("created_at", { ascending: false }),
        supabase.from("funding_claim_expenses").select("claim_id,expense_id,claimed_amount"),
        supabase.from("finance_claim_documents").select("claim_id,document_id"),
        supabase.from("profiles").select("id,full_name,email").order("full_name"),
      ]);
      setClaims((managementRequests[0].data || []) as FundingClaim[]);
      setClaimExpenses((managementRequests[1].data || []) as ClaimExpense[]);
      setClaimDocuments((managementRequests[2].data || []) as ClaimDocument[]);
      setProfiles((managementRequests[3].data || []) as Profile[]);
      if (managementRequests.some((request) => request.error)) notify("Some funding workflow data could not be loaded");
    }
    setLoading(false);
  }, [canManage, notify]);

  useEffect(() => {
    const timer = window.setTimeout(() => { loadFinance(); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadFinance]);

  const expenseById = useMemo(() => new Map(expenses.map((expense) => [expense.id, expense])), [expenses]);
  const profileById = useMemo(() => new Map(profiles.map((profile) => [profile.id, profile])), [profiles]);
  const documentById = useMemo(() => new Map(documents.map((document) => [document.id, document])), [documents]);
  const activePayments = payments.filter((payment) => payment.status !== "voided");
  const balance = activePayments.reduce((total, payment) => total + (payment.direction === "inflow" ? Number(payment.amount) : -Number(payment.amount)), 0);
  const income = activePayments.filter((payment) => payment.direction === "inflow").reduce((total, payment) => total + Number(payment.amount), 0);
  const spending = expenses.filter((expense) => !["rejected", "voided"].includes(expense.status)).reduce((total, expense) => total + Number(expense.amount), 0);
  const pendingReimbursements = reimbursements.filter((request) => ["submitted", "approved"].includes(request.status));
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
    if (error || !data) notify("This finance document could not be opened");
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
    if (error) { setSaving(false); notify(error.message); return; }
    const result = (Array.isArray(data) ? data[0] : data) as { expense_id: number; reimbursement_id: number };
    try {
      await uploadDocument(receipt, "receipt", `Receipt — ${String(form.get("description") || "Purchase")}`, { expenseId: result.expense_id, reimbursementId: result.reimbursement_id }, last4);
      if (statement?.size) await uploadDocument(statement, "card_statement", "Payment card statement", { expenseId: result.expense_id, reimbursementId: result.reimbursement_id }, last4);
      setModal(null); setEventRelated(false); notify("Reimbursement request submitted"); await loadFinance();
    } catch (uploadError) {
      notify(uploadError instanceof Error ? `Request saved; ${uploadError.message}` : "Request saved, but a document failed to upload");
      await loadFinance();
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
    if (error) { setSaving(false); notify(error.message); return; }
    try {
      await uploadDocument(receipt, "receipt", `Receipt — ${String(form.get("description") || "Purchase")}`, { expenseId: Number(data) }, last4);
      setModal(null); setEventRelated(false); notify("Club expense recorded"); await loadFinance();
    } catch (uploadError) {
      notify(uploadError instanceof Error ? `Expense saved; ${uploadError.message}` : "Expense saved, but the receipt failed to upload");
      await loadFinance();
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
    if (error) notify(error.message); else { setModal(null); notify("Income recorded"); loadFinance(); }
  }

  async function createClaim(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || selectedClaimExpenses.size === 0) { notify("Select at least one expense for this claim"); return; }
    setSaving(true);
    const form = new FormData(event.currentTarget);
    const approval = form.get("funding_approval") as File;
    const selectedExpenses = expenses.filter((expense) => selectedClaimExpenses.has(expense.id));
    const requestedAmount = selectedExpenses.reduce((total, expense) => total + Number(expense.amount), 0);
    const saved = await supabase.from("funding_claims").insert({
      title: String(form.get("title") || ""), funder_name: String(form.get("funder_name") || "GPSG Senate"),
      award_reference: String(form.get("award_reference") || ""), heellife_reference: String(form.get("heellife_reference") || ""),
      requested_amount: requestedAmount, submission_deadline: String(form.get("submission_deadline") || "") || null,
      status: "incomplete", notes: String(form.get("notes") || ""), created_by: user.id, updated_by: user.id,
    }).select("id").single();
    if (saved.error || !saved.data) { setSaving(false); notify(saved.error?.message || "Claim could not be created"); return; }
    const claimId = Number(saved.data.id);
    const linked = await supabase.from("funding_claim_expenses").insert(selectedExpenses.map((expense) => ({ claim_id: claimId, expense_id: expense.id, claimed_amount: expense.amount })));
    if (linked.error) { setSaving(false); notify(linked.error.message); return; }
    try {
      await uploadDocument(approval, "funding_approval", "Funding approval", { claimId });
      setModal(null); setSelectedClaimExpenses(new Set()); notify("Funding claim workspace created"); await loadFinance();
    } catch (uploadError) {
      notify(uploadError instanceof Error ? `Claim saved; ${uploadError.message}` : "Claim saved, but approval proof failed to upload");
      await loadFinance();
    } finally { setSaving(false); }
  }

  async function uploadClaimDocument(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!claimUploadId) return;
    setSaving(true);
    const form = new FormData(event.currentTarget);
    try {
      await uploadDocument(form.get("file") as File, String(form.get("document_type") || "other"), String(form.get("title") || "Claim document"), { claimId: claimUploadId });
      setClaimUploadId(null); notify("Claim document added"); await loadFinance();
    } catch (error) { notify(error instanceof Error ? error.message : "Document could not be uploaded"); }
    finally { setSaving(false); }
  }

  async function reviewReimbursement(id: number, decision: "approved" | "rejected", amount: number) {
    if (!supabase) return;
    const { error } = await supabase.rpc("review_personal_reimbursement", { p_reimbursement_id: id, p_decision: decision, p_approved_amount: decision === "approved" ? amount : null, p_review_note: "" });
    if (error) notify(error.message); else { notify(decision === "approved" ? "Reimbursement approved" : "Reimbursement declined"); loadFinance(); }
  }

  async function markReimbursementPaid(id: number) {
    if (!supabase) return;
    const { error } = await supabase.rpc("pay_personal_reimbursement", { p_reimbursement_id: id, p_payment_date: today(), p_account_name: "Club bank account" });
    if (error) notify(error.message); else { notify("Reimbursement marked paid"); loadFinance(); }
  }

  async function updateClaimStatus(claim: FundingClaim, status: string) {
    if (!supabase) return;
    if (status === "ready" && !claimChecklist(claim).complete) { notify("Complete every required claim document first"); return; }
    const changes: Record<string, string | number | null> = { status, updated_by: user.id };
    if (status === "submitted") changes.submitted_at = new Date().toISOString();
    if (status === "approved") { changes.approved_amount = Number(claim.requested_amount); changes.reviewed_at = new Date().toISOString(); }
    const { error } = await supabase.from("funding_claims").update(changes).eq("id", claim.id);
    if (error) notify(error.message); else { notify("Funding claim updated"); loadFinance(); }
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
    if (error) notify(error.message); else { setClaimPaymentId(null); notify("Funding payment recorded"); loadFinance(); }
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

  const filteredPayments = activePayments.filter((payment) => {
    const matchesQuery = `${payment.description} ${payment.category} ${payment.counterparty}`.toLowerCase().includes(query.toLowerCase());
    return matchesQuery && (flowFilter === "all" || payment.direction === flowFilter || payment.purpose === flowFilter);
  });
  const unclaimedExpenses = expenses.filter((expense) => !["rejected", "voided"].includes(expense.status) && !claimExpenses.some((item) => item.expense_id === expense.id));

  return <section className="section-shell page-section finance-page">
    <div className="finance-title-row"><div className="page-title"><p className="eyebrow">{canManage ? "FINANCE WORKSPACE" : "MEMBER FINANCES"}</p><h1>{canManage ? "Club finances" : "My reimbursements"}</h1><p>{canManage ? "Purchases, payments, member reimbursements, and funding claims—connected without double-counting." : "Submit purchases you made for the club and follow each request through review and payment."}</p></div><div className="finance-actions">{canManage && <><button className="secondary" onClick={() => setModal("income")}>＋ Record income</button><button className="secondary" onClick={() => setModal("expense")}>＋ Club expense</button></>}<button className="primary" onClick={() => setModal("reimbursement")}>＋ Request reimbursement</button></div></div>

    {canManage ? <div className="finance-summary finance-summary-v2"><SummaryCard label="Available cash" value={money(balance)} detail="Posted and cleared payments" /><SummaryCard label="Recorded income" value={money(income)} detail="All incoming payments" tone="positive" /><SummaryCard label="Club spending" value={money(spending)} detail="Underlying purchases" /><SummaryCard label="Pending reimbursements" value={money(pendingTotal)} detail={`${pendingReimbursements.length} awaiting action`} tone={pendingReimbursements.length ? "warning" : undefined} /><SummaryCard label="Expected funding" value={money(expectedFunding)} detail="Approved, not yet received" tone="positive" /></div> : <div className="finance-summary finance-summary-v2 member"><SummaryCard label="Requested" value={money(reimbursements.reduce((sum, item) => sum + Number(item.requested_amount), 0))} detail="All my requests" /><SummaryCard label="Awaiting review" value={String(reimbursements.filter((item) => item.status === "submitted").length)} detail="Submitted requests" tone="warning" /><SummaryCard label="Paid" value={money(reimbursements.filter((item) => item.status === "paid").reduce((sum, item) => sum + Number(item.approved_amount || 0), 0))} detail="Completed reimbursements" tone="positive" /></div>}

    <div className="finance-tabs" role="tablist">{(canManage ? ["overview", "expenses", "reimbursements", "claims"] : ["reimbursements"] as FinanceView[]).map((item) => <button key={item} role="tab" aria-selected={view === item} className={view === item ? "active" : ""} onClick={() => setView(item as FinanceView)}>{item === "claims" ? "Funding claims" : item}</button>)}</div>

    {loading ? <div className="inline-loading">Loading finance workspace…</div> : <>
      {canManage && view === "overview" && <div className="finance-overview-grid"><section className="finance-panel"><PanelHeading title="Cash ledger" meta={`${filteredPayments.length} payments`} /><div className="finance-ledger-tools"><label className="search">⌕<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search payments" /></label><select aria-label="Filter cash ledger" value={flowFilter} onChange={(event) => setFlowFilter(event.target.value)}><option value="all">All activity</option><option value="inflow">Money in</option><option value="outflow">Money out</option><option value="member_reimbursement">Member reimbursements</option><option value="external_reimbursement">Funding received</option></select></div><PaymentLedger payments={filteredPayments} /></section><aside className="finance-panel"><PanelHeading title="Action queue" meta="Needs attention" />{pendingReimbursements.length ? pendingReimbursements.slice(0, 4).map((request) => <button className="finance-queue-item" key={request.id} onClick={() => setView("reimbursements")}><span>Member reimbursement</span><b>{expenseById.get(request.expense_id)?.description || "Purchase"}</b><small>{money(Number(request.requested_amount))} · {request.status}</small></button>) : <p className="finance-empty-copy">No reimbursements need attention.</p>}{claims.filter((claim) => !["paid", "denied", "voided"].includes(claim.status)).slice(0, 3).map((claim) => <button className="finance-queue-item" key={claim.id} onClick={() => setView("claims")}><span>Funding claim</span><b>{claim.title}</b><small>{claimChecklist(claim).checks.filter((check) => check.done).length}/6 requirements · {claim.status}</small></button>)}</aside></div>}

      {canManage && view === "expenses" && <section className="finance-panel"><PanelHeading title="Expense register" meta={`${expenses.length} purchases`} />{expenses.length ? <div className="finance-table"><div className="finance-table-head"><span>Purchase</span><span>Paid by</span><span>Status</span><span>Amount</span></div>{expenses.map((expense) => <div className="finance-table-row" key={expense.id}><div><b>{expense.description}</b><small>{expense.vendor || expense.category} · {formatDate(expense.purchase_date)}{expense.payment_card_last4 ? ` · •••• ${expense.payment_card_last4}` : ""}</small></div><span>{expense.paid_by === "member" ? profileById.get(expense.paid_by_member_id || "")?.full_name || "Member" : "Club account"}</span><StatusBadge status={expense.status} /><strong>{money(Number(expense.amount))}</strong></div>)}</div> : <FinanceEmpty title="No expenses yet" text="Record a club purchase or approve a member reimbursement." />}</section>}

      {view === "reimbursements" && <section className="finance-panel"><PanelHeading title={canManage ? "Member reimbursements" : "My requests"} meta={`${reimbursements.length} requests`} />{reimbursements.length ? <div className="reimbursement-list">{reimbursements.map((request) => { const expense = expenseById.get(request.expense_id); const receiptIds = reimbursementDocuments.filter((item) => item.reimbursement_id === request.id).map((item) => item.document_id); return <article className="reimbursement-card" key={request.id}><div className="reimbursement-main"><div><p className="eyebrow">{canManage ? profileById.get(request.member_id)?.full_name || profileById.get(request.member_id)?.email || "CLUB MEMBER" : "MY REQUEST"}</p><h3>{expense?.description || "Club purchase"}</h3><p>{expense?.vendor || expense?.category} · Purchased {expense ? formatDate(expense.purchase_date) : "recently"}</p></div><div className="reimbursement-amount"><strong>{money(Number(request.approved_amount || request.requested_amount))}</strong><StatusBadge status={request.status} /></div></div>{request.member_note && <p className="reimbursement-note">“{request.member_note}”</p>}<div className="reimbursement-footer"><div>{receiptIds.map((documentId) => <button className="document-chip" key={documentId} onClick={() => openDocument(documentId)}>▤ {documentById.get(documentId)?.title || "Document"}</button>)}</div>{canManage && <div className="reimbursement-actions">{request.status === "submitted" && <><button className="secondary" onClick={() => reviewReimbursement(request.id, "rejected", Number(request.requested_amount))}>Decline</button><button className="primary" onClick={() => reviewReimbursement(request.id, "approved", Number(request.requested_amount))}>Approve</button></>}{request.status === "approved" && <button className="primary" onClick={() => markReimbursementPaid(request.id)}>Mark paid</button>}</div>}</div></article>; })}</div> : <FinanceEmpty title="No reimbursement requests" text={canManage ? "Member requests will appear here for review." : "Use Request reimbursement when you buy something for the club."} />}</section>}

      {canManage && view === "claims" && <section className="finance-panel"><div className="panel-heading"><div><h2>Senate & external funding</h2><span>Build submission-ready reimbursement packets</span></div><button className="primary" onClick={() => setModal("claim")}>＋ New funding claim</button></div>{claims.length ? <div className="claim-grid">{claims.map((claim) => { const checklist = claimChecklist(claim); return <article className="claim-card" key={claim.id}><div className="claim-card-head"><div><p className="eyebrow">{claim.funder_name}</p><h3>{claim.title}</h3><small>{money(Number(claim.requested_amount))} requested{claim.submission_deadline ? ` · Due ${formatDate(claim.submission_deadline)}` : ""}</small></div><StatusBadge status={claim.status} /></div><div className="claim-progress"><div><span style={{ width: `${(checklist.checks.filter((check) => check.done).length / checklist.checks.length) * 100}%` }} /></div><b>{checklist.checks.filter((check) => check.done).length} of {checklist.checks.length} ready</b></div><ul className="claim-checklist">{checklist.checks.map((check) => <li className={check.done ? "done" : ""} key={check.label}><span>{check.done ? "✓" : "○"}</span>{check.label}</li>)}</ul><div className="claim-expenses">{checklist.linkedExpenses.map((expense) => <span key={expense.id}>{expense.description} · {money(Number(expense.amount))}</span>)}</div><div className="claim-actions"><button className="secondary" onClick={() => setClaimUploadId(claim.id)}>＋ Document</button>{["draft", "incomplete", "changes_requested"].includes(claim.status) && <button className="secondary" disabled={!checklist.complete} onClick={() => updateClaimStatus(claim, "ready")}>Mark ready</button>}{claim.status === "ready" && <button className="primary" onClick={() => updateClaimStatus(claim, "submitted")}>Mark submitted</button>}{claim.status === "submitted" && <button className="primary" onClick={() => updateClaimStatus(claim, "approved")}>Mark approved</button>}{["approved", "partially_paid"].includes(claim.status) && <button className="primary" onClick={() => setClaimPaymentId(claim.id)}>Record payment</button>}</div></article>; })}</div> : <FinanceEmpty title="No funding claims yet" text="Group eligible expenses into a Senate or external reimbursement packet." />}</section>}
    </>}

    {modal === "reimbursement" && <ModalShell title="Request reimbursement" eyebrow="MEMBER PURCHASE" onClose={() => { setModal(null); setEventRelated(false); }}><PurchaseForm mode="member" groups={groups} events={events} eventRelated={eventRelated} setEventRelated={setEventRelated} saving={saving} onSubmit={submitReimbursement} /></ModalShell>}
    {modal === "expense" && <ModalShell title="Record club expense" eyebrow="CLUB PURCHASE" onClose={() => { setModal(null); setEventRelated(false); }}><PurchaseForm mode="club" groups={groups} events={events} eventRelated={eventRelated} setEventRelated={setEventRelated} saving={saving} onSubmit={recordExpense} /></ModalShell>}
    {modal === "income" && <ModalShell title="Record money received" eyebrow="INCOME" onClose={() => setModal(null)}><form onSubmit={recordIncome}><label>Description<input name="description" required placeholder="Gig at Memorial Hall" /></label><div className="form-pair"><label>Amount<input name="amount" type="number" min="0.01" step="0.01" required /></label><label>Date received<input name="payment_date" type="date" defaultValue={today()} required /></label></div><div className="form-pair"><label>Income source<select name="category" defaultValue="Gig revenue">{incomeCategories.map((category) => <option key={category}>{category}</option>)}</select></label><label>Paid by<input name="counterparty" placeholder="Client, donor, or customer" /></label></div><label>Deposited into<input name="account_name" defaultValue="Club bank account" required /></label><button className="primary modal-submit" disabled={saving}>{saving ? "Saving…" : "Record income"}</button></form></ModalShell>}
    {modal === "claim" && <ModalShell title="Build a funding claim" eyebrow="SENATE / EXTERNAL FUNDING" onClose={() => { setModal(null); setSelectedClaimExpenses(new Set()); }}><form onSubmit={createClaim}><label>Claim title<input name="title" required placeholder="Fall concert food reimbursement" /></label><div className="form-pair"><label>Funding organization<input name="funder_name" defaultValue="GPSG Senate" required /></label><label>Submission deadline<input name="submission_deadline" type="date" /></label></div><div className="form-pair"><label>Award reference<input name="award_reference" placeholder="Award letter or request ID" /></label><label>HeelLife reference<input name="heellife_reference" placeholder="Form or submission ID" /></label></div><fieldset className="claim-expense-picker"><legend>Expenses included</legend>{unclaimedExpenses.length ? unclaimedExpenses.map((expense) => <label key={expense.id}><input type="checkbox" aria-label={`Include ${expense.description}`} checked={selectedClaimExpenses.has(expense.id)} onChange={(event) => setSelectedClaimExpenses((current) => { const next = new Set(current); if (event.target.checked) next.add(expense.id); else next.delete(expense.id); return next; })} /><span><b>{expense.description}</b><small>{formatDate(expense.purchase_date)} · {money(Number(expense.amount))}</small></span></label>) : <p>No unclaimed expenses are available.</p>}</fieldset><label>Proof of funding approval<input name="funding_approval" type="file" accept="application/pdf,image/jpeg,image/png" required /></label><label>Notes<textarea name="notes" rows={3} /></label><button className="primary modal-submit" disabled={saving || selectedClaimExpenses.size === 0}>{saving ? "Creating…" : `Create claim · ${money(expenses.filter((expense) => selectedClaimExpenses.has(expense.id)).reduce((sum, expense) => sum + Number(expense.amount), 0))}`}</button></form></ModalShell>}
    {claimUploadId && <ModalShell title="Add claim document" eyebrow="SECURE FINANCE FILE" onClose={() => setClaimUploadId(null)}><form onSubmit={uploadClaimDocument}><label>Document type<select name="document_type" required><option value="bank_statement">Bank statement PDF</option><option value="card_statement">Credit card statement PDF</option><option value="event_support">Event flyer or agenda</option><option value="funding_approval">Funding approval</option><option value="heellife_submission">HeelLife submission</option><option value="proof_of_payment">Proof of payment</option><option value="other">Other supporting document</option></select></label><label>Title<input name="title" required placeholder="March bank statement" /></label><label>File<input name="file" type="file" accept="application/pdf,image/jpeg,image/png" required /></label><p className="finance-privacy-note">Statements must be PDFs. Sensitive files are stored separately from the club archive and are visible only to their uploader and executives.</p><button className="primary modal-submit" disabled={saving}>{saving ? "Uploading…" : "Add document"}</button></form></ModalShell>}
    {claimPaymentId && <ModalShell title="Record funding payment" eyebrow="MONEY RECEIVED" onClose={() => setClaimPaymentId(null)}><form onSubmit={recordClaimPayment}><label>Amount received<input name="amount" type="number" min="0.01" step="0.01" required /></label><label>Date received<input name="payment_date" type="date" defaultValue={today()} required /></label><label>Deposited into<input name="account_name" defaultValue="Club bank account" required /></label><button className="primary modal-submit" disabled={saving}>{saving ? "Saving…" : "Record payment"}</button></form></ModalShell>}
  </section>;
}

function PurchaseForm({ mode, groups, events, eventRelated, setEventRelated, saving, onSubmit }: {
  mode: "member" | "club"; groups: Subgroup[]; events: ClubEvent[]; eventRelated: boolean;
  setEventRelated: (value: boolean) => void; saving: boolean; onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return <form onSubmit={onSubmit}><label>What was purchased?<input name="description" required placeholder="Food for fall concert rehearsal" /></label><div className="form-pair"><label>Vendor<input name="vendor" required placeholder="Vendor or store" /></label><label>Amount<input name="amount" type="number" min="0.01" step="0.01" required /></label></div><div className="form-pair"><label>Exact purchase date<input name="purchase_date" type="date" defaultValue={today()} required /></label><label>Category<select name="category" defaultValue="Food">{expenseCategories.map((category) => <option key={category}>{category}</option>)}</select></label></div><div className="form-pair"><label>Card last four digits<input name="last4" inputMode="numeric" pattern="[0-9]{4}" maxLength={4} required placeholder="1234" /></label>{mode === "club" ? <label>Paid from<input name="account_name" defaultValue="Club bank account" required /></label> : <label>Related subgroup<select name="subgroup_id" defaultValue=""><option value="">Club-wide</option>{groups.map((group) => <option value={group.id} key={group.id}>{group.name}</option>)}</select></label>}</div>{mode === "club" && <label>Related subgroup<select name="subgroup_id" defaultValue=""><option value="">Club-wide</option>{groups.map((group) => <option value={group.id} key={group.id}>{group.name}</option>)}</select></label>}<label className="finance-check"><input name="event_related" type="checkbox" checked={eventRelated} onChange={(event) => setEventRelated(event.target.checked)} /> This purchase was for an event</label>{eventRelated && <div className="event-proof-fields"><label>Club calendar event<select name="club_event_id" defaultValue=""><option value="">Not listed on the calendar</option>{events.map((event) => <option value={event.id} key={event.id}>{event.title} · {formatDate(event.starts_at)}</option>)}</select></label><div className="form-pair"><label>Event name<input name="event_name" required /></label><label>Event date and time<input name="event_starts_at" type="datetime-local" required /></label></div><label>Number of attendees<input name="event_attendee_count" type="number" min="0" required /></label><label>Schedule / description<textarea name="event_schedule" rows={3} required /></label></div>}<label>Legible receipt<input name="receipt" type="file" accept="application/pdf,image/jpeg,image/png" required /></label>{mode === "member" && <label>Bank/card statement PDF <span className="optional">Optional now; required for Senate claims</span><input name="statement" type="file" accept="application/pdf" /></label>}{mode === "member" && <label>Note for the treasurer<textarea name="note" rows={3} placeholder="Why this purchase was needed" /></label>}<p className="finance-privacy-note">Upload only the required financial documents. Statements are kept in a private finance area and never appear in the club archive.</p><button className="primary modal-submit" disabled={saving}>{saving ? "Saving securely…" : mode === "member" ? "Submit reimbursement" : "Record club expense"}</button></form>;
}

function ModalShell({ eyebrow, title, onClose, children }: { eyebrow: string; title: string; onClose: () => void; children: ReactNode }) {
  return <div className="modal-backdrop"><div className="modal finance-modal" role="dialog" aria-modal="true" aria-labelledby="finance-modal-title"><button type="button" className="modal-close" aria-label="Close" onClick={onClose}>×</button><p className="eyebrow">{eyebrow}</p><h2 id="finance-modal-title">{title}</h2>{children}</div></div>;
}

function SummaryCard({ label, value, detail, tone }: { label: string; value: string; detail: string; tone?: "positive" | "warning" }) {
  return <div className={tone ? `finance-stat ${tone}` : "finance-stat"}><small>{label}</small><strong>{value}</strong><span>{detail}</span></div>;
}

function PanelHeading({ title, meta }: { title: string; meta: string }) {
  return <div className="panel-heading"><div><h2>{title}</h2><span>{meta}</span></div></div>;
}

function PaymentLedger({ payments }: { payments: Payment[] }) {
  return payments.length ? <div className="ledger finance-ledger"><div className="ledger-head"><b>Payment</b><span>Date</span><span>Account</span><span>Amount</span></div>{payments.map((payment) => <div className="ledger-row" key={payment.id}><span className={`money-mark ${payment.direction === "inflow" ? "income" : "expense"}`}>{payment.direction === "inflow" ? "+" : "−"}</span><div><b>{payment.description}</b><small>{payment.category}{payment.counterparty ? ` · ${payment.counterparty}` : ""}</small></div><span>{formatDate(payment.payment_date)}</span><span>{payment.account_name}</span><strong className={payment.direction === "inflow" ? "income" : "expense"}>{payment.direction === "inflow" ? "+" : "−"}{money(Number(payment.amount))}</strong></div>)}</div> : <FinanceEmpty title="No payments yet" text="Income and paid expenses will appear in the cash ledger." />;
}

function StatusBadge({ status }: { status: string }) { return <span className={`finance-status ${status}`}>{status.replaceAll("_", " ")}</span>; }
function FinanceEmpty({ title, text }: { title: string; text: string }) { return <div className="finance-empty"><span>sa</span><h3>{title}</h3><p>{text}</p></div>; }
function today() { return new Date().toISOString().slice(0, 10); }
function formatDate(value: string) { return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(value)); }
function money(value: number) { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value); }
