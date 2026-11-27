// The Finance screen, run for real against the fake Supabase client.
//
// This file replaces tests/finance-wiring.test.mjs and the finance test of tests/refresh-wiring.test.mjs,
// which read app/finance.tsx as text. What each old assertion protected, and where it is checked now:
//
//  finance-wiring "the failure check lists every answer under its own result, summaryResult included":
//    the screen keeps what it shows when ANY of the 11 reads fails, and the totals RPC is one of them
//    -> "a failed read ... " (one case per read, so a read missing from the check, or wired to the wrong
//       result, leaves a case showing figures that are not the database's).
//    A failure returns before anything on screen is replaced; the totals change only after the check
//    -> "a refresh whose totals RPC fails keeps the last totals".
//  finance-wiring "Mark paid asks first, runs once, and shows it is working":
//    -> "Mark paid asks first ...", "... runs once, shows Paying and frees the button only after the lists were read again".
//  finance-wiring "claim status buttons are off while a change runs, and Mark submitted asks first":
//    -> "claim buttons are off while a change runs", "Mark submitted asks first ...".
//  finance-wiring "the void buttons and the dialog submit cannot start a second change":
//    -> "every Void button is off while a change runs", "a dialog submitted twice sends one change".
//  finance-wiring "removing a document reports a refused file delete" and "... never 'try again' (round 3)":
//    -> "removing a document: ..." group (success, empty answer, storage error, thrown error, record first).
//  finance-wiring "after a change the dialogs wait for the refresh for a bounded time only (round 3)":
//    -> "the wait for the refresh is bounded" group (15 s, "Saved" only when the change was saved).
//  refresh-wiring "finance keeps its lists when any query fails, and only the newest load may write":
//    -> the failed-read cases above, plus "only the newest load may write".
//
// Dropped on purpose: assertions that only said how the code was written (`doesNotMatch(/anyFailed\(\[expenseResult/)`,
// `doesNotMatch(/await loadFinance\(\)/)`): the behaviour they stood for is what the tests above exercise.

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FinancePage } from "../../app/finance";
import { REFRESH_WAIT_MS } from "../../lib/bounded-wait";
import { setCacheOwner } from "../../lib/cache";
import { advance, flush, notifySpy, userOf } from "../support/helpers";
import { after, deferred, fail, fake, never, ok, rejects } from "../support/fake-supabase";

const SLOW_SAVED = "Saved. The lists are slow to refresh and will update on their own.";
const SLOW_UNSAVED = "The lists are slow to refresh and will update on their own.";

const expense = (over: Record<string, unknown> = {}) => ({
  id: 1, description: "Tabla repair", vendor: "Raj Music", amount: 80, purchase_date: "2026-10-01", category: "Instruments",
  paid_by: "member", paid_by_member_id: "member-9", payment_card_last4: "1234", subgroup_id: null, club_event_id: null,
  event_related: false, event_name: "", event_starts_at: null, event_attendee_count: null, event_schedule: "", status: "approved", created_by: "member-9", ...over,
});
const reimbursement = (over: Record<string, unknown> = {}) => ({
  id: 5, expense_id: 1, member_id: "member-9", requested_amount: 80, approved_amount: 80, status: "approved",
  member_note: "", review_note: "", created_at: "2026-10-02T00:00:00Z", ...over,
});
const payment = (over: Record<string, unknown> = {}) => ({
  id: 7, direction: "outflow", purpose: "member_reimbursement", amount: 80, description: "Reimbursement: Tabla repair", category: "Instruments",
  account_name: "Club bank account", counterparty: "", payment_date: "2026-10-03", status: "posted", reimbursement_id: 6, funding_claim_id: null, ...over,
});
const claim = (over: Record<string, unknown> = {}) => ({
  id: 3, title: "Fall concert", funder_name: "GPSG Senate", award_reference: "", heellife_reference: "", requested_amount: 80,
  approved_amount: null, received_amount: 0, submission_deadline: null, status: "ready", notes: "", ...over,
});
const SUMMARY = { available_cash: 1234, income: 2000, spending: 766, pending_reimbursement_total: 80, pending_reimbursement_count: 1, expected_funding: 0 };

type Data = Record<"expenses" | "reimbursements" | "payments" | "documents" | "expenseDocuments" | "reimbursementDocuments" | "claims" | "claimExpenses" | "claimDocuments" | "profiles", unknown[]>;
const BASE: Data = {
  expenses: [expense()],
  reimbursements: [reimbursement()],
  payments: [payment()],
  documents: [], expenseDocuments: [], reimbursementDocuments: [],
  claims: [claim()], claimExpenses: [], claimDocuments: [],
  profiles: [{ id: "member-9", full_name: "Meera Nair", email: "meera@x.test" }],
};

// Which table answers each of the screen's 11 reads. `summary` is the totals RPC.
const READS = {
  expenses: () => fake.from("finance_expenses", "select"),
  reimbursements: () => fake.from("personal_reimbursements", "select"),
  payments: () => fake.from("finance_payments", "select"),
  documents: () => fake.from("finance_documents", "select"),
  expenseDocuments: () => fake.from("finance_expense_documents", "select"),
  reimbursementDocuments: () => fake.from("finance_reimbursement_documents", "select"),
  summary: () => fake.rpc("get_finance_summary"),
  claims: () => fake.from("funding_claims", "select"),
  claimExpenses: () => fake.from("funding_claim_expenses", "select"),
  claimDocuments: () => fake.from("finance_claim_documents", "select"),
  profiles: () => fake.from("profiles", "select"),
} as const;
type ReadName = keyof typeof READS;

function scriptFinance(data: Partial<Data> = {}, summary: Record<string, number> | null = SUMMARY) {
  const all = { ...BASE, ...data };
  for (const name of Object.keys(all) as Array<keyof Data>) READS[name]().reply(ok(all[name]));
  READS.summary().reply(ok(summary));
}

function renderFinance(options: { role?: "member" | "executive" | "admin"; userId?: string } = {}) {
  const notify = notifySpy();
  // The shell makes the signed-in account the cache owner before any screen mounts; without it a refresh would
  // replace the lists with "Loading..." (as a first visit does), which the real screen does not do on a second read.
  setCacheOwner(options.userId ?? "exec-1");
  render(<FinancePage user={userOf(options.userId ?? "exec-1")} role={options.role ?? "executive"} groups={[]} events={[]} notify={notify} />);
  return notify;
}

const card = (label: string) => screen.getByText(label).parentElement!.querySelector("strong")!.textContent;
const waitForLoad = () => waitFor(() => expect(card("Available cash")).toBe("$1,234.00"));
const tab = (name: string) => fireEvent.click(screen.getByRole("tab", { name }));
const dialog = () => screen.getByRole("dialog");
const payCalls = () => fake.rpc("pay_personal_reimbursement").calls;
const claimCalls = () => fake.rpc("set_funding_claim_status").calls;

async function startMarkPaid() {
  await waitForLoad();
  tab("reimbursements");
  fireEvent.click(await screen.findByRole("button", { name: "Mark paid" }));
  fireEvent.click(within(dialog()).getByRole("button", { name: "Mark paid" }));
}

describe("finance: reading the screen's data", () => {
  it("shows the totals the database computed, not sums of the loaded lists", async () => {
    scriptFinance({ payments: [] }, { ...SUMMARY, available_cash: 9999 });
    renderFinance();
    await waitFor(() => expect(card("Available cash")).toBe("$9,999.00"));
  });

  // finance-wiring 1: every one of the 11 reads is in the failure check, each under its own result.
  it.each(Object.keys(READS) as ReadName[])("a failed read (%s) is reported and nothing from the other reads is shown as if it were complete", async (name) => {
    scriptFinance();
    READS[name]().reply(fail("The database is unavailable"));
    const notify = renderFinance();
    expect(await screen.findByText("The finance records could not be loaded.")).toBeInTheDocument();
    expect(notify.find("Some finance records could not be loaded").tone).toBe("error");
    // Nothing replaced a screen that never had data: no cards built from partial answers.
    expect(screen.queryByText("Available cash")).not.toBeInTheDocument();
  });

  it("a refresh whose totals RPC fails keeps the last totals and lists, shows the banner and says so", async () => {
    scriptFinance();
    // The second read of the totals (the refresh after Mark paid) fails; the first one is fine.
    READS.summary().replyOnce(ok(SUMMARY)).reply(fail("canceling statement due to statement timeout"));
    const notify = renderFinance();
    await startMarkPaid();
    expect(await screen.findByText("Some finance records could not be refreshed, so the figures below may be out of date.")).toBeInTheDocument();
    expect(card("Available cash")).toBe("$1,234.00");
    expect(notify.find("Some finance records could not be loaded").tone).toBe("error");
    // The lists kept their rows too.
    expect(screen.getByRole("button", { name: /Mark paid/ })).toBeInTheDocument();
  });

  it("a refresh whose list read fails keeps the rows that were on screen (the balance never falls back to $0)", async () => {
    scriptFinance();
    READS.payments().replyOnce(ok([payment()])).reply(fail("boom"));
    const notify = renderFinance();
    await startMarkPaid();
    expect(await screen.findByText(/could not be refreshed/)).toBeInTheDocument();
    expect(card("Available cash")).toBe("$1,234.00");
    tab("overview");
    expect(screen.getByText("Reimbursement: Tabla repair")).toBeInTheDocument();
    expect(notify.find("Some finance records could not be loaded").tone).toBe("error");
  });

  it("a failed refresh offers Try again, which reads again", async () => {
    scriptFinance();
    READS.summary().replyOnce(ok(SUMMARY)).replyOnce(fail("down")).reply(ok({ ...SUMMARY, available_cash: 77 }));
    renderFinance();
    await startMarkPaid();
    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
    await waitFor(() => expect(card("Available cash")).toBe("$77.00"));
    expect(screen.queryByText(/could not be refreshed/)).not.toBeInTheDocument();
  });

  it("only the newest load may write: a slow older answer arriving last is discarded", async () => {
    scriptFinance();
    const slow = deferred();
    // First read of the totals hangs (the first load); the second (after income is recorded) answers at once.
    READS.summary().replyOnce(slow.reply).reply(ok({ ...SUMMARY, available_cash: 500 }));
    renderFinance();
    fireEvent.click(await screen.findByRole("button", { name: /Record income/ }));
    fireEvent.submit(dialog().querySelector("form")!);
    await waitFor(() => expect(card("Available cash")).toBe("$500.00"));
    await act(async () => { slow.resolve(ok({ ...SUMMARY, available_cash: 1 })); });
    await flush();
    expect(card("Available cash")).toBe("$500.00");
  });
});

describe("finance: Mark paid", () => {
  beforeEach(() => scriptFinance());

  it("asks first: the button opens a confirmation and sends nothing until it is confirmed", async () => {
    renderFinance();
    await waitForLoad();
    tab("reimbursements");
    fireEvent.click(await screen.findByRole("button", { name: "Mark paid" }));
    expect(payCalls()).toHaveLength(0);
    expect(within(dialog()).getByText("Mark this reimbursement as paid?")).toBeInTheDocument();
    fireEvent.click(within(dialog()).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(payCalls()).toHaveLength(0);
  });

  it("runs once, shows Paying while it works and frees the button only after the lists were read again", async () => {
    const paying = deferred();
    fake.rpc("pay_personal_reimbursement").reply(paying.reply);
    // The reload after the payment: the paid request is listed as paid, but only once that read answers.
    const reloadingRequests = deferred();
    READS.reimbursements().replyOnce(ok([reimbursement()])).replyOnce(reloadingRequests.reply);
    renderFinance();
    await startMarkPaid();
    // Working: the confirmation is busy, the button says Paying and is off, a second confirm sends nothing.
    const row = await screen.findByRole("button", { name: "Paying…" });
    expect(row).toBeDisabled();
    expect(within(dialog()).getByRole("button", { name: "Working…" })).toBeDisabled();
    fireEvent.click(within(dialog()).getByRole("button", { name: "Working…" }));
    expect(payCalls()).toHaveLength(1);
    expect(payCalls()[0].args[0]).toMatchObject({ p_reimbursement_id: 5, p_account_name: "Club bank account" });
    // The payment is saved but the lists are still being read: the button stays off.
    await act(async () => { paying.resolve(ok(null)); });
    await flush();
    expect(screen.getByRole("button", { name: "Paying…" })).toBeDisabled();
    // The lists come back with the request paid: the button is gone and the dialog closed.
    await act(async () => { reloadingRequests.resolve(ok([reimbursement({ status: "paid" })])); });
    await waitFor(() => expect(screen.queryByRole("button", { name: /Paying|Mark paid/ })).not.toBeInTheDocument());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(payCalls()).toHaveLength(1);
  });

  it("a payment the database refuses is shown as an error with the database's sentence, then the lists are read again", async () => {
    fake.rpc("pay_personal_reimbursement").reply(fail("Only approved reimbursements can be paid"));
    const notify = renderFinance();
    await startMarkPaid();
    await waitFor(() => expect(notify.find("Only approved reimbursements can be paid").tone).toBe("error"));
    // A failure usually means someone else already paid it: the screen reads again either way.
    await waitFor(() => expect(fake.from("finance_expenses", "select").count).toBe(2));
  });

  it("a payment that throws (no network) says the change could not be saved, as an error", async () => {
    fake.rpc("pay_personal_reimbursement").reply(rejects());
    const notify = renderFinance();
    await startMarkPaid();
    await waitFor(() => expect(notify.find("That change could not be saved. Check your connection and try again.").tone).toBe("error"));
    // And the button is free again.
    await waitFor(() => expect(screen.getByRole("button", { name: "Mark paid" })).toBeEnabled());
  });
});

// Two claims: 3 is "ready" (can go back to editing or be submitted), 4 is a draft whose checklist is complete.
const READY_AND_DRAFT: Partial<Data> = {
  claims: [claim(), claim({ id: 4, title: "Spring workshop", status: "draft" })],
  claimExpenses: [{ claim_id: 4, expense_id: 1, claimed_amount: 80 }],
  documents: [
    { id: 11, document_type: "receipt", title: "Receipt", storage_path: "u/11.pdf", uploaded_by: "member-9" },
    { id: 12, document_type: "bank_statement", title: "Statement", storage_path: "u/12.pdf", uploaded_by: "exec-1" },
    { id: 13, document_type: "funding_approval", title: "Approval", storage_path: "u/13.pdf", uploaded_by: "exec-1" },
  ],
  expenseDocuments: [{ expense_id: 1, document_id: 11 }],
  claimDocuments: [{ claim_id: 4, document_id: 12 }, { claim_id: 4, document_id: 13 }],
};

describe("finance: claim status", () => {
  async function openClaims() {
    await waitForLoad();
    tab("Funding claims");
    await screen.findByText("Fall concert");
  }
  const claimCard = (title: string) => screen.getByText(title).closest("article") as HTMLElement;

  it("claim buttons are off while a change runs: Back to editing, Mark submitted, Mark ready, Void claim", async () => {
    scriptFinance(READY_AND_DRAFT);
    const saving = deferred();
    fake.rpc("set_funding_claim_status").reply(saving.reply);
    renderFinance();
    await openClaims();
    // Before: everything is available (the draft's checklist is complete, so Mark ready is on).
    expect(within(claimCard("Spring workshop")).getByRole("button", { name: "Mark ready" })).toBeEnabled();
    expect(within(claimCard("Fall concert")).getByRole("button", { name: "Mark submitted" })).toBeEnabled();
    fireEvent.click(within(claimCard("Fall concert")).getByRole("button", { name: "Back to editing" }));
    await waitFor(() => expect(within(claimCard("Fall concert")).getByRole("button", { name: "Saving…" })).toBeDisabled());
    expect(claimCalls()[0].args[0]).toEqual({ p_claim_id: 3, p_status: "incomplete" });
    for (const [title, name] of [["Fall concert", "Mark submitted"], ["Fall concert", "Void claim"], ["Spring workshop", "Mark ready"], ["Spring workshop", "Void claim"]] as const) {
      expect(within(claimCard(title)).getByRole("button", { name }), `${title}: ${name}`).toBeDisabled();
    }
    await act(async () => { saving.resolve(ok(null)); });
  });

  it("Mark ready stays off while the checklist is incomplete, and sends nothing", async () => {
    scriptFinance({ claims: [claim({ id: 4, title: "Spring workshop", status: "draft" })] });
    renderFinance();
    await waitForLoad();
    tab("Funding claims");
    const button = within(await screen.findByText("Spring workshop").then((node) => node.closest("article") as HTMLElement)).getByRole("button", { name: "Mark ready" });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(claimCalls()).toHaveLength(0);
  });

  it("Mark submitted asks first: the button sends nothing, the confirmation does, and it stays busy until the change is done", async () => {
    scriptFinance(READY_AND_DRAFT);
    const saving = deferred();
    fake.rpc("set_funding_claim_status").reply(saving.reply);
    renderFinance();
    await openClaims();
    fireEvent.click(within(claimCard("Fall concert")).getByRole("button", { name: "Mark submitted" }));
    expect(claimCalls()).toHaveLength(0);
    expect(within(dialog()).getByText("Mark this claim as submitted?")).toBeInTheDocument();
    fireEvent.click(within(dialog()).getByRole("button", { name: "Mark submitted" }));
    await waitFor(() => expect(claimCalls()).toHaveLength(1));
    expect(claimCalls()[0].args[0]).toEqual({ p_claim_id: 3, p_status: "submitted" });
    // Open and busy while the change is running.
    expect(within(dialog()).getByRole("button", { name: "Working…" })).toBeDisabled();
    expect(within(dialog()).getByRole("button", { name: "Cancel" })).toBeDisabled();
    await act(async () => { saving.resolve(ok(null)); });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(claimCalls()).toHaveLength(1);
  });

  it("a claim change the database refuses is an error toast with the database's sentence", async () => {
    scriptFinance(READY_AND_DRAFT);
    fake.rpc("set_funding_claim_status").reply(fail("A claim that is submitted cannot be marked submitted"));
    const notify = renderFinance();
    await openClaims();
    fireEvent.click(within(claimCard("Fall concert")).getByRole("button", { name: "Back to editing" }));
    await waitFor(() => expect(notify.find("A claim that is submitted cannot be marked submitted").tone).toBe("error"));
  });
});

describe("finance: corrections cannot overlap", () => {
  const pendingPay = () => {
    const paying = deferred();
    fake.rpc("pay_personal_reimbursement").reply(paying.reply);
    return paying;
  };

  it("every Void button is off while a change runs, and on again afterwards", async () => {
    scriptFinance({
      reimbursements: [reimbursement(), reimbursement({ id: 6, expense_id: 2, status: "paid" })],
      expenses: [expense(), expense({ id: 2, description: "Harmonium", status: "settled" })],
      claims: [claim()],
    });
    const paying = pendingPay();
    renderFinance();
    await waitForLoad();
    // Idle: the payment ledger's Void is on.
    expect(screen.getByRole("button", { name: "Void payment: Reimbursement: Tabla repair" })).toBeEnabled();
    tab("reimbursements");
    fireEvent.click(await screen.findByRole("button", { name: "Mark paid" }));
    fireEvent.click(within(dialog()).getByRole("button", { name: "Mark paid" }));
    await screen.findByRole("button", { name: "Paying…" });
    // Reimbursements tab: "Void payment" on the paid request, "Void" on the unpaid one's purchase.
    for (const name of ["Void payment", "Void"]) {
      for (const button of screen.getAllByRole("button", { name })) expect(button, name).toBeDisabled();
    }
    tab("expenses");
    for (const button of screen.getAllByRole("button", { name: /^(Void|Edit)$/ })) expect(button).toBeDisabled();
    tab("overview");
    expect(screen.getByRole("button", { name: "Void payment: Reimbursement: Tabla repair" })).toBeDisabled();
    tab("Funding claims");
    expect(screen.getByRole("button", { name: "Void claim" })).toBeDisabled();
    await act(async () => { paying.resolve(ok(null)); });
    await waitFor(() => expect(screen.getByRole("button", { name: "Void claim" })).toBeEnabled());
  });

  it("a dialog submitted twice sends one change", async () => {
    scriptFinance();
    const voiding = deferred();
    fake.rpc("void_finance_payment").reply(voiding.reply);
    renderFinance();
    await waitForLoad();
    fireEvent.click(screen.getByRole("button", { name: "Void payment: Reimbursement: Tabla repair" }));
    const form = dialog().querySelector("form")!;
    fireEvent.change(within(dialog()).getByLabelText(/Reason/), { target: { value: "Entered twice by mistake" } });
    fireEvent.submit(form);
    fireEvent.submit(form);
    await flush();
    expect(fake.rpc("void_finance_payment").calls).toHaveLength(1);
    expect(fake.rpc("void_finance_payment").calls[0].args[0]).toEqual({ p_payment_id: 7, p_reason: "Entered twice by mistake" });
    await act(async () => { voiding.resolve(ok(null)); });
  });

  it("a correction the database refuses is an error toast and keeps the dialog open for another try", async () => {
    scriptFinance();
    fake.rpc("void_finance_payment").reply(fail("Payment is already voided"));
    const notify = renderFinance();
    await waitForLoad();
    fireEvent.click(screen.getByRole("button", { name: "Void payment: Reimbursement: Tabla repair" }));
    fireEvent.change(within(dialog()).getByLabelText(/Reason/), { target: { value: "Wrong amount" } });
    fireEvent.submit(dialog().querySelector("form")!);
    await waitFor(() => expect(notify.find("Payment is already voided").tone).toBe("error"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("a correction that throws (no network) says it could not be saved, as an error, and keeps the dialog open", async () => {
    scriptFinance();
    fake.rpc("void_finance_payment").reply(rejects());
    const notify = renderFinance();
    await waitForLoad();
    fireEvent.click(screen.getByRole("button", { name: "Void payment: Reimbursement: Tabla repair" }));
    fireEvent.change(within(dialog()).getByLabelText(/Reason/), { target: { value: "Wrong amount" } });
    fireEvent.submit(dialog().querySelector("form")!);
    await waitFor(() => expect(notify.find("That change could not be saved. Check your connection and try again.").tone).toBe("error"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(notify.messages()).not.toContain("Payment voided");
  });
});

describe("finance: removing a document", () => {
  const FILE_LEFT = "The document was removed from the request, but its file is still in storage and could not be deleted. Ask an administrator to remove it.";

  async function removeReceipt() {
    scriptFinance({
      reimbursements: [reimbursement({ status: "submitted" })],
      documents: [{ id: 11, document_type: "receipt", title: "Taxi receipt", storage_path: "member-9/taxi.pdf", uploaded_by: "member-9" }],
      reimbursementDocuments: [{ reimbursement_id: 5, document_id: 11 }],
    });
    fake.rpc("remove_finance_document").reply(ok("member-9/taxi.pdf"));
    const notify = renderFinance();
    await waitForLoad();
    tab("reimbursements");
    fireEvent.click(await screen.findByRole("button", { name: "Remove Taxi receipt" }));
    fireEvent.submit(dialog().querySelector("form")!);
    return notify;
  }

  it("a delete that really happened says Document removed, with no warning", async () => {
    const notify = await removeReceipt();
    await waitFor(() => expect(notify.find("Document removed").tone).toBe("success"));
    expect(notify.messages().filter((message) => /storage|removed from the request/.test(message))).toEqual([]);
    expect(fake.storage("finance-private", "remove").calls[0].args[0]).toEqual(["member-9/taxi.pdf"]);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("the record goes first and the file after", async () => {
    const notify = await removeReceipt();
    await waitFor(() => notify.find("Document removed"));
    expect(fake.rpc("remove_finance_document").calls[0].seq).toBeLessThan(fake.storage("finance-private", "remove").calls[0].seq);
  });

  it.each([
    ["storage answers with an empty list (a refused delete)", () => fake.storage("finance-private", "remove").reply(ok([]))],
    ["storage answers with an error", () => fake.storage("finance-private", "remove").reply(fail("Object not found"))],
    ["storage throws (no network)", () => fake.storage("finance-private", "remove").reply(rejects())],
  ])("when %s: the record is gone, the file is still stored, and nobody is told to retry", async (_name, script) => {
    script();
    const notify = await removeReceipt();
    await waitFor(() => expect(notify.find(FILE_LEFT).tone).toBe("error"));
    expect(notify.messages()).not.toContain("Document removed");
    expect(FILE_LEFT).not.toMatch(/try again|retry/i);
    // The record is already deleted, so the dialog closes rather than offering the same click again.
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("when the record cannot be removed, the file is left alone and the error is shown", async () => {
    scriptFinance({
      reimbursements: [reimbursement({ status: "submitted" })],
      documents: [{ id: 11, document_type: "receipt", title: "Taxi receipt", storage_path: "member-9/taxi.pdf", uploaded_by: "member-9" }],
      reimbursementDocuments: [{ reimbursement_id: 5, document_id: 11 }],
    });
    fake.rpc("remove_finance_document").reply(fail("A request needs at least one receipt"));
    const notify = renderFinance();
    await waitForLoad();
    tab("reimbursements");
    fireEvent.click(await screen.findByRole("button", { name: "Remove Taxi receipt" }));
    fireEvent.submit(dialog().querySelector("form")!);
    await waitFor(() => expect(notify.find("A request needs at least one receipt").tone).toBe("error"));
    expect(fake.storage("finance-private", "remove").calls).toHaveLength(0);
  });
});

describe("finance: the wait for the refresh is bounded (15 s)", () => {
  beforeEach(() => { vi.useFakeTimers(); scriptFinance(); });

  // A refresh that never answers: the second read of the expenses hangs.
  const hangOnRefresh = () => READS.expenses().replyOnce(ok([expense()])).reply(never);

  async function loaded() {
    const notify = renderFinance();
    await advance(1);
    expect(card("Available cash")).toBe("$1,234.00");
    return notify;
  }
  async function confirmPay() {
    tab("reimbursements");
    fireEvent.click(screen.getByRole("button", { name: "Mark paid" }));
    fireEvent.click(within(dialog()).getByRole("button", { name: "Mark paid" }));
    await advance(1);
  }

  it("the dialog waits for a slow refresh for 15 s, then moves on and tells the person the change was saved", async () => {
    fake.rpc("pay_personal_reimbursement").reply(ok(null));
    hangOnRefresh();
    const notify = await loaded();
    await confirmPay();
    // Saved, but the lists have not come back: still busy at 14.9 s, no notice yet.
    await advance(REFRESH_WAIT_MS - 100);
    expect(screen.getByRole("button", { name: "Paying…" })).toBeDisabled();
    expect(notify.messages()).not.toContain(SLOW_SAVED);
    await advance(100);
    expect(notify.find(SLOW_SAVED).tone).toBe("success");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mark paid" })).toBeEnabled();
  });

  it("a refresh that comes back in time says nothing about being slow", async () => {
    fake.rpc("pay_personal_reimbursement").reply(ok(null));
    READS.expenses().replyOnce(ok([expense()])).reply(after(3000, ok([expense()])));
    const notify = await loaded();
    await confirmPay();
    await advance(3000);
    await advance(REFRESH_WAIT_MS);
    expect(notify.messages().filter((message) => /slow to refresh/.test(message))).toEqual([]);
  });

  it("a payment that failed never says Saved, even when the refresh is slow: the notice is an error", async () => {
    fake.rpc("pay_personal_reimbursement").reply(fail("Only approved reimbursements can be paid"));
    hangOnRefresh();
    const notify = await loaded();
    await confirmPay();
    await advance(REFRESH_WAIT_MS);
    expect(notify.find(SLOW_UNSAVED).tone).toBe("error");
    expect(notify.messages()).not.toContain(SLOW_SAVED);
    expect(notify.messages().some((message) => /^Saved/.test(message))).toBe(false);
  });

  it("a claim status change that failed refreshes without claiming Saved", async () => {
    scriptFinance(READY_AND_DRAFT);
    fake.rpc("set_funding_claim_status").reply(fail("A claim that is submitted cannot be marked submitted"));
    hangOnRefresh();
    const notify = await loaded();
    tab("Funding claims");
    fireEvent.click(within(screen.getByText("Fall concert").closest("article") as HTMLElement).getByRole("button", { name: "Back to editing" }));
    await advance(REFRESH_WAIT_MS);
    expect(notify.find(SLOW_UNSAVED).tone).toBe("error");
    expect(notify.messages().some((message) => /^Saved/.test(message))).toBe(false);
  });

  it("a claim status change that was saved says Saved when the refresh is slow", async () => {
    scriptFinance(READY_AND_DRAFT);
    fake.rpc("set_funding_claim_status").reply(ok(null));
    hangOnRefresh();
    const notify = await loaded();
    tab("Funding claims");
    fireEvent.click(within(screen.getByText("Fall concert").closest("article") as HTMLElement).getByRole("button", { name: "Back to editing" }));
    await advance(REFRESH_WAIT_MS);
    expect(notify.find(SLOW_SAVED).tone).toBe("success");
  });

  // Every flow that saves something and then waits for the lists (not only Mark paid and the dialogs).
  const pdfFile = () => new File(["%PDF-1.4"], "statement.pdf", { type: "application/pdf" });
  const attachTo = (name: string) => fireEvent.change(dialog().querySelector(`input[name="${name}"]`)!, { target: { files: [pdfFile()] } });
  const flows: Array<[string, () => void]> = [
    ["a club expense with its receipt", () => {
      fake.rpc("record_club_expense").reply(ok(12));
      fireEvent.click(screen.getByRole("button", { name: /Club expense/ }));
      attachTo("receipt");
      fireEvent.submit(dialog().querySelector("form")!);
    }],
    ["a funding claim with its approval proof", () => {
      fake.rpc("create_funding_claim").reply(ok({ id: 3 }));
      tab("Funding claims");
      fireEvent.click(screen.getByRole("button", { name: /New funding claim/ }));
      fireEvent.click(within(dialog()).getByLabelText("Include Tabla repair"));
      attachTo("funding_approval");
      fireEvent.submit(dialog().querySelector("form")!);
    }],
    ["a receipt added to a request", () => {
      tab("reimbursements");
      fireEvent.click(screen.getByRole("button", { name: /Add receipt/ }));
      attachTo("file");
      fireEvent.submit(dialog().querySelector("form")!);
    }],
    ["a document added to a claim", () => {
      tab("Funding claims");
      fireEvent.click(screen.getByRole("button", { name: /Document/ }));
      attachTo("file");
      fireEvent.submit(dialog().querySelector("form")!);
    }],
  ];
  it.each(flows)("%s: the dialog waits for a slow refresh for 15 s, then moves on and says the change was saved", async (_name, run) => {
    scriptFinance({ reimbursements: [reimbursement({ status: "submitted", member_id: "exec-1" })] });
    fake.from("finance_documents", "insert").reply(ok({ id: 55 }));
    hangOnRefresh();
    const notify = await loaded();
    run();
    await advance(1);
    await advance(REFRESH_WAIT_MS - 100);
    expect(notify.messages()).not.toContain(SLOW_SAVED);
    await advance(200);
    expect(notify.find(SLOW_SAVED).tone).toBe("success");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("a correction made in a dialog: the buttons stay off until the refresh is read or 15 s have passed", async () => {
    fake.rpc("void_finance_payment").reply(ok(null));
    hangOnRefresh();
    const notify = await loaded();
    fireEvent.click(screen.getByRole("button", { name: "Void payment: Reimbursement: Tabla repair" }));
    fireEvent.change(within(dialog()).getByLabelText(/Reason/), { target: { value: "Entered twice" } });
    fireEvent.submit(dialog().querySelector("form")!);
    await advance(1);
    expect(notify.find("Payment voided").tone).toBe("success");
    expect(screen.getByRole("button", { name: "Void payment: Reimbursement: Tabla repair" })).toBeDisabled();
    await advance(REFRESH_WAIT_MS - 100);
    expect(screen.getByRole("button", { name: "Void payment: Reimbursement: Tabla repair" })).toBeDisabled();
    await advance(100);
    expect(notify.find(SLOW_SAVED).tone).toBe("success");
    expect(screen.getByRole("button", { name: "Void payment: Reimbursement: Tabla repair" })).toBeEnabled();
  });
});

describe("finance: saving requests and documents", () => {
  const pdf = () => new File(["%PDF-1.4 receipt"], "taxi receipt.pdf", { type: "application/pdf" });
  const attach = (name: string, file: File) => fireEvent.change(dialog().querySelector(`input[name="${name}"]`)!, { target: { files: [file] } });
  const asked = () => fake.rpc("submit_member_reimbursement").replyOnce(ok({ expense_id: 1, reimbursement_id: 5 }));

  async function openRequestForm() {
    fireEvent.click(await screen.findByRole("button", { name: /Request reimbursement/ }));
    return dialog().querySelector("form")!;
  }

  beforeEach(() => {
    scriptFinance();
    fake.from("finance_documents", "insert").reply(ok({ id: 55 }));
  });

  it("a request is saved first, then its receipt is uploaded privately and linked to the expense and the request", async () => {
    asked();
    const notify = renderFinance({ role: "member", userId: "member-9" });
    const form = await openRequestForm();
    fireEvent.change(form.querySelector('input[name="description"]')!, { target: { value: "Taxi to the venue" } });
    fireEvent.change(form.querySelector('input[name="amount"]')!, { target: { value: "42.5" } });
    attach("receipt", pdf());
    fireEvent.submit(form);
    await waitFor(() => expect(notify.find("Reimbursement request submitted").tone).toBeUndefined());
    expect(fake.rpc("submit_member_reimbursement").calls[0].args[0]).toMatchObject({ p_description: "Taxi to the venue", p_amount: 42.5 });
    const upload = fake.storage("finance-private", "upload").calls[0];
    expect(String(upload.args[0])).toMatch(/^member-9\/[0-9a-f-]{36}-taxi-receipt\.pdf$/);
    expect(upload.args[2]).toMatchObject({ contentType: "application/pdf", upsert: false });
    expect(fake.from("finance_documents", "insert").calls[0].payload).toMatchObject({ document_type: "receipt", storage_path: upload.args[0], uploaded_by: "member-9" });
    expect(fake.from("finance_expense_documents", "insert").calls[0].payload).toEqual({ expense_id: 1, document_id: 55 });
    expect(fake.from("finance_reimbursement_documents", "insert").calls[0].payload).toEqual({ reimbursement_id: 5, document_id: 55 });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("a request without a receipt is saved, and the person is told the receipt is what is missing, as an error", async () => {
    asked();
    const notify = renderFinance({ role: "member", userId: "member-9" });
    fireEvent.submit(await openRequestForm());
    await waitFor(() => expect(notify.find("Request saved; Choose a document to upload").tone).toBe("error"));
    expect(fake.storage("finance-private", "upload").calls).toHaveLength(0);
  });

  it("a receipt over 10 MB is refused before anything is uploaded", async () => {
    asked();
    const notify = renderFinance({ role: "member", userId: "member-9" });
    const form = await openRequestForm();
    attach("receipt", new File([new Uint8Array(10 * 1024 * 1024 + 1)], "big.pdf", { type: "application/pdf" }));
    fireEvent.submit(form);
    await waitFor(() => expect(notify.find("Request saved; Finance documents must be 10 MB or smaller").tone).toBe("error"));
    expect(fake.storage("finance-private", "upload").calls).toHaveLength(0);
  });

  it("a request the database refuses is an error with the database's sentence and uploads nothing", async () => {
    fake.rpc("submit_member_reimbursement").reply(fail("Purchase date cannot be in the future"));
    const notify = renderFinance({ role: "member", userId: "member-9" });
    const form = await openRequestForm();
    attach("receipt", pdf());
    fireEvent.submit(form);
    await waitFor(() => expect(notify.find("Purchase date cannot be in the future").tone).toBe("error"));
    expect(fake.storage("finance-private", "upload").calls).toHaveLength(0);
  });

  it("the wait for the refresh after saving a request is bounded too: 15 s, then it is told the request was saved", async () => {
    vi.useFakeTimers();
    asked();
    READS.expenses().replyOnce(ok([expense()])).reply(never);
    const notify = renderFinance({ role: "member", userId: "member-9" });
    await advance(1);
    fireEvent.click(screen.getByRole("button", { name: /Request reimbursement/ }));
    const form = dialog().querySelector("form")!;
    attach("receipt", pdf());
    fireEvent.submit(form);
    await advance(1);
    expect(notify.messages()).toContain("Reimbursement request submitted");
    await advance(REFRESH_WAIT_MS - 100);
    expect(notify.messages()).not.toContain(SLOW_SAVED);
    await advance(100);
    expect(notify.find(SLOW_SAVED).tone).toBe("success");
  });
});

// Toast tone: every other place this screen shows the database's own sentence.
//
// Replaces the part of tests/toast-call-sites.test.mjs that scanned app/finance.tsx for notify() calls that pass database
// text. The sentence below has none of the usual words of a failure, so only an explicit "error" makes it read as one. The
// sites already pinned above (Mark paid, claim status, the dialogs, the request form) are not repeated.
describe("finance: a failure that shows the database's own sentence is announced as an error", () => {
  const CHEERFUL = "Everything has been saved";
  const cheerful = () => fail(CHEERFUL);
  const toneOf = (notify: ReturnType<typeof notifySpy>) => notify.toasts().filter((toast) => toast.message.includes(CHEERFUL)).map((toast) => toast.tone);
  const pdf = () => new File(["%PDF-1.4"], "statement.pdf", { type: "application/pdf" });
  const attach = (name: string, file: File) => fireEvent.change(dialog().querySelector(`input[name="${name}"]`)!, { target: { files: [file] } });

  beforeEach(() => { scriptFinance(); });

  it("recording a club expense", async () => {
    fake.rpc("record_club_expense").reply(cheerful());
    const notify = renderFinance();
    await waitForLoad();
    fireEvent.click(screen.getByRole("button", { name: /Club expense/ }));
    fireEvent.submit(dialog().querySelector("form")!);
    await waitFor(() => expect(toneOf(notify)).toEqual(["error"]));
  });

  it("an expense that was saved but whose receipt could not be stored", async () => {
    fake.rpc("record_club_expense").reply(ok(12));
    fake.storage("finance-private", "upload").reply(cheerful());
    const notify = renderFinance();
    await waitForLoad();
    fireEvent.click(screen.getByRole("button", { name: /Club expense/ }));
    attach("receipt", pdf());
    fireEvent.submit(dialog().querySelector("form")!);
    await waitFor(() => expect(toneOf(notify)).toEqual(["error"]));
    expect(notify.toasts().find((toast) => toast.message.includes(CHEERFUL))!.message).toBe(`Expense saved; ${CHEERFUL}`);
  });

  it("recording income", async () => {
    fake.rpc("record_finance_income").reply(cheerful());
    const notify = renderFinance();
    await waitForLoad();
    fireEvent.click(screen.getByRole("button", { name: /Record income/ }));
    fireEvent.submit(dialog().querySelector("form")!);
    await waitFor(() => expect(toneOf(notify)).toEqual(["error"]));
  });

  it("building a funding claim, and a claim saved whose approval proof could not be stored", async () => {
    fake.rpc("create_funding_claim").replyOnce(cheerful()).reply(ok({ id: 3 }));
    fake.storage("finance-private", "upload").reply(cheerful());
    const notify = renderFinance();
    await waitForLoad();
    tab("Funding claims");
    fireEvent.click(await screen.findByRole("button", { name: /New funding claim/ }));
    fireEvent.click(within(dialog()).getByLabelText("Include Tabla repair"));
    attach("funding_approval", pdf());
    fireEvent.submit(dialog().querySelector("form")!);
    await waitFor(() => expect(toneOf(notify)).toEqual(["error"]));
    fireEvent.submit(dialog().querySelector("form")!);
    await waitFor(() => expect(toneOf(notify)).toEqual(["error", "error"]));
    expect(notify.toasts()[1].message).toBe(`Claim saved; ${CHEERFUL}`);
  });

  it("adding a receipt to a request, adding a claim document, and recording a funding payment", async () => {
    scriptFinance({ reimbursements: [reimbursement({ status: "submitted", member_id: "exec-1" })], claims: [claim({ status: "approved", approved_amount: 80 })] });
    fake.storage("finance-private", "upload").reply(cheerful());
    fake.rpc("record_funding_claim_payment").reply(cheerful());
    const notify = renderFinance();
    await waitForLoad();
    tab("reimbursements");
    fireEvent.click(await screen.findByRole("button", { name: /Add receipt/ }));
    attach("file", pdf());
    fireEvent.submit(dialog().querySelector("form")!);
    await waitFor(() => expect(toneOf(notify)).toEqual(["error"]));
    fireEvent.click(within(dialog()).getByRole("button", { name: "Close" }));
    tab("Funding claims");
    fireEvent.click(await screen.findByRole("button", { name: /Document/ }));
    attach("file", pdf());
    fireEvent.submit(dialog().querySelector("form")!);
    await waitFor(() => expect(toneOf(notify)).toEqual(["error", "error"]));
    fireEvent.click(within(dialog()).getByRole("button", { name: "Close" }));
    fireEvent.click(await screen.findByRole("button", { name: "Record payment" }));
    fireEvent.change(dialog().querySelector('input[name="amount"]')!, { target: { value: "10" } });
    fireEvent.submit(dialog().querySelector("form")!);
    await waitFor(() => expect(toneOf(notify)).toEqual(["error", "error", "error"]));
  });
});
