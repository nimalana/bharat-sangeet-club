// features/finance/model.ts and features/finance/forms.ts: what the finance screen works out from the rows it loaded and from a form.
// Pure functions, so these run without the screen. The screen tests (finance.test.tsx) pin what the person sees; these pin the rules
// behind it that a screen test only reaches through one example: which payments count toward the balance, which expenses a funder has
// locked, which can still go on a claim, and the six things a claim needs before it can be marked ready.
import { describe, expect, it } from "vitest";
import type { FinanceWave } from "../../lib/api/finance";
import { buildSnapshot, claimEditable, deriveFinance, filterPayments, snapshotFromCache } from "../../features/finance/model";
import { readPurchaseDetails } from "../../features/finance/forms";
import type { FinanceSnapshot } from "../../features/finance/types";

/* eslint-disable @typescript-eslint/no-explicit-any */
const expense = (over: Record<string, unknown> = {}): any => ({
  id: 1, description: "Tabla repair", vendor: "Raj Music", amount: 80, purchase_date: "2026-10-01", category: "Instruments", paid_by: "member", paid_by_member_id: "m9",
  payment_card_last4: "1234", subgroup_id: null, club_event_id: null, event_related: false, event_name: "", event_starts_at: null, event_attendee_count: null, event_schedule: "", status: "approved", created_by: "m9", ...over,
});
const request = (over: Record<string, unknown> = {}): any => ({ id: 5, expense_id: 1, member_id: "m9", requested_amount: 80, approved_amount: null, status: "submitted", member_note: "", review_note: "", created_at: "", ...over });
const payment = (over: Record<string, unknown> = {}): any => ({ id: 7, direction: "outflow", purpose: "member_reimbursement", amount: 80, description: "Tabla repair", category: "Instruments", account_name: "Club", counterparty: "Raj Music", payment_date: "2026-10-03", status: "posted", reimbursement_id: 5, funding_claim_id: null, ...over });
const claim = (over: Record<string, unknown> = {}): any => ({ id: 3, title: "Fall", funder_name: "GPSG", award_reference: "", heellife_reference: "", requested_amount: 80, approved_amount: null, received_amount: 0, submission_deadline: null, status: "draft", notes: "", ...over });
const snapshot = (over: Partial<FinanceSnapshot> = {}): FinanceSnapshot => ({
  expenses: [], reimbursements: [], payments: [], documents: [], expenseDocuments: [], reimbursementDocuments: [], claims: [], claimExpenses: [], claimDocuments: [], profiles: [], summary: null, ...over,
});

describe("the snapshot", () => {
  it("a screen opened with nothing cached starts empty, with no totals", () => {
    expect(snapshotFromCache(undefined)).toEqual(snapshot());
  });

  it("a cached snapshot is kept as it is, and a field it lacks is empty", () => {
    const cached = { ...snapshot({ expenses: [expense()], summary: { available_cash: 5, income: 6, spending: 1, pending_reimbursement_total: 0, pending_reimbursement_count: 0, expected_funding: 0 } }), claims: undefined } as unknown as FinanceSnapshot;
    const result = snapshotFromCache(cached);
    expect(result.expenses).toHaveLength(1);
    expect(result.summary?.available_cash).toBe(5);
    expect(result.claims).toEqual([]);
  });

  const answers = (over: Partial<Record<keyof FinanceWave, unknown>> = {}): FinanceWave => {
    const empty = { data: [], error: null };
    return { expenses: empty, reimbursements: empty, payments: empty, documents: empty, expenseDocuments: empty, reimbursementDocuments: empty, summary: { data: null, error: null }, claims: empty, claimExpenses: empty, claimDocuments: empty, profiles: empty, ...over } as FinanceWave;
  };

  it("a wave becomes a snapshot: each answer under its own name, the totals' values read as numbers", () => {
    const built = buildSnapshot(answers({
      expenses: { data: [expense()], error: null }, payments: { data: [payment()], error: null }, claims: { data: [claim()], error: null },
      summary: { data: { available_cash: "1234.5", income: 2000, spending: "766", pending_reimbursement_total: "80", pending_reimbursement_count: "2", expected_funding: 0 }, error: null },
    }));
    expect(built.expenses).toHaveLength(1);
    expect(built.payments).toHaveLength(1);
    expect(built.claims).toHaveLength(1);
    expect(built.reimbursements).toEqual([]);
    expect(built.summary).toEqual({ available_cash: 1234.5, income: 2000, spending: 766, pending_reimbursement_total: 80, pending_reimbursement_count: 2, expected_funding: 0 });
  });

  it("an answer with no rows is an empty list, and totals that did not arrive are no totals (the cards then add up the lists)", () => {
    const built = buildSnapshot(answers({ expenses: { data: null, error: null }, summary: { data: null, error: null } }));
    expect(built.expenses).toEqual([]);
    expect(built.summary).toBeNull();
  });
});

describe("the totals the cards fall back to", () => {
  it("only posted and cleared payments count toward the balance; a voided one is out of the ledger altogether", () => {
    const { balance, income, activePayments } = deriveFinance(snapshot({ payments: [
      payment({ id: 1, direction: "inflow", amount: 500, status: "cleared" }), payment({ id: 2, direction: "outflow", amount: 80, status: "posted" }),
      payment({ id: 3, direction: "outflow", amount: 999, status: "pending" }), payment({ id: 4, direction: "inflow", amount: 7, status: "voided" }),
    ] }));
    expect(balance).toBe(420);
    expect(income).toBe(500);
    expect(activePayments.map((item) => item.id)).toEqual([1, 2, 3]);
  });

  it("spending is the approved and settled purchases", () => {
    const { spending } = deriveFinance(snapshot({ expenses: [expense({ amount: 10, status: "approved" }), expense({ id: 2, amount: 5, status: "settled" }), expense({ id: 3, amount: 100, status: "voided" }), expense({ id: 4, amount: 100, status: "pending" })] }));
    expect(spending).toBe(15);
  });

  it("pending reimbursements are the open requests, each worth what was approved or else what was requested", () => {
    const { pendingReimbursements, pendingTotal } = deriveFinance(snapshot({ reimbursements: [
      request({ id: 1, status: "submitted", requested_amount: 50 }), request({ id: 2, status: "approved", requested_amount: 80, approved_amount: 60 }),
      request({ id: 3, status: "changes_requested", requested_amount: 10 }), request({ id: 4, status: "paid", requested_amount: 999 }), request({ id: 5, status: "rejected", requested_amount: 999 }),
    ] }));
    expect(pendingReimbursements.map((item) => item.id)).toEqual([1, 2, 3]);
    expect(pendingTotal).toBe(120);
  });

  it("expected funding is what approved and partly paid claims still have to receive, never below zero", () => {
    const { expectedFunding } = deriveFinance(snapshot({ claims: [
      claim({ id: 1, status: "approved", approved_amount: 100, received_amount: 30 }), claim({ id: 2, status: "partially_paid", approved_amount: 50, received_amount: 60 }),
      claim({ id: 3, status: "paid", approved_amount: 70, received_amount: 70 }), claim({ id: 4, status: "submitted", approved_amount: 70, received_amount: 0 }),
    ] }));
    expect(expectedFunding).toBe(70);
  });
});

describe("which expenses a claim locks, and which can go on one", () => {
  const links = [{ claim_id: 1, expense_id: 11, claimed_amount: 1 }, { claim_id: 2, expense_id: 12, claimed_amount: 1 }, { claim_id: 3, expense_id: 13, claimed_amount: 1 }, { claim_id: 4, expense_id: 14, claimed_amount: 1 }, { claim_id: 5, expense_id: 15, claimed_amount: 1 }];

  it("an expense is locked once the funder has its claim (submitted, decided or paid), not while the claim is being built or after it was voided", () => {
    const { lockedExpenseIds } = deriveFinance(snapshot({
      claims: [claim({ id: 1, status: "draft" }), claim({ id: 2, status: "submitted" }), claim({ id: 3, status: "paid" }), claim({ id: 4, status: "voided" }), claim({ id: 5, status: "changes_requested" })],
      claimExpenses: links,
    }));
    expect([...lockedExpenseIds].sort()).toEqual([12, 13]);
  });

  it("only approved or settled purchases not on a live claim can go on a new one", () => {
    const { unclaimedExpenses } = deriveFinance(snapshot({
      expenses: [expense({ id: 11, status: "approved" }), expense({ id: 12, status: "settled" }), expense({ id: 13, status: "approved" }), expense({ id: 14, status: "pending" }), expense({ id: 15, status: "voided" })],
      claims: [claim({ id: 1, status: "draft" }), claim({ id: 2, status: "voided" })],
      claimExpenses: [{ claim_id: 1, expense_id: 11, claimed_amount: 1 }, { claim_id: 2, expense_id: 12, claimed_amount: 1 }],
    }));
    // 11 is on a live claim; 12's claim was voided, so it is free again; 14 and 15 are not approved.
    expect(unclaimedExpenses.map((item) => item.id)).toEqual([12, 13]);
  });

  it("a claim can be edited until the funder has it", () => {
    for (const status of ["draft", "incomplete", "ready", "changes_requested"]) expect(claimEditable(claim({ status }))).toBe(true);
    for (const status of ["submitted", "approved", "partially_paid", "paid", "denied", "voided"]) expect(claimEditable(claim({ status }))).toBe(false);
  });
});

describe("the claim checklist (six things before a claim can be marked ready)", () => {
  const doc = (id: number, type: string) => ({ id, document_type: type, title: type, storage_path: `u/${id}.pdf`, uploaded_by: "x" });
  const complete = () => snapshot({
    expenses: [expense({ id: 1 })],
    claims: [claim({ id: 3 })], claimExpenses: [{ claim_id: 3, expense_id: 1, claimed_amount: 80 }],
    documents: [doc(11, "receipt"), doc(12, "bank_statement"), doc(13, "funding_approval")],
    expenseDocuments: [{ expense_id: 1, document_id: 11 }], claimDocuments: [{ claim_id: 3, document_id: 12 }, { claim_id: 3, document_id: 13 }],
  });
  const check = (data: FinanceSnapshot) => { const { claimChecklist } = deriveFinance(data); return claimChecklist(data.claims[0]); };
  const done = (data: FinanceSnapshot) => check(data).checks.map((item) => item.done);

  it("a claim with all six is complete, and the checks are these six in this order", () => {
    const result = check(complete());
    expect(result.checks.map((item) => item.label)).toEqual([
      "Exact purchase date on every expense", "Receipt for every transaction", "Payment card last four recorded", "Bank or card statement PDF",
      "Event flyer/agenda and event details", "GPSG/Senate funding approval",
    ]);
    expect(result.complete).toBe(true);
    expect(result.linkedExpenses.map((item) => item.id)).toEqual([1]);
  });

  it("a claim with no expenses has none of the three expense checks", () => {
    expect(done(snapshot({ claims: [claim()], documents: [doc(12, "bank_statement"), doc(13, "funding_approval")], claimDocuments: [{ claim_id: 3, document_id: 12 }, { claim_id: 3, document_id: 13 }] }))).toEqual([false, false, false, true, true, true]);
  });

  it("each check turns off by itself when its proof goes missing", () => {
    const base = complete();
    expect(done({ ...base, expenseDocuments: [] })).toEqual([true, false, true, true, true, true]);
    expect(done({ ...base, expenses: [expense({ id: 1, payment_card_last4: "12" })] })).toEqual([true, true, false, true, true, true]);
    expect(done({ ...base, expenses: [expense({ id: 1, payment_card_last4: null })] })).toEqual([true, true, false, true, true, true]);
    expect(done({ ...base, claimDocuments: [{ claim_id: 3, document_id: 13 }] })).toEqual([true, true, true, false, true, true]);
    expect(done({ ...base, claimDocuments: [{ claim_id: 3, document_id: 12 }] })).toEqual([true, true, true, true, true, false]);
    expect(done({ ...base, expenses: [expense({ id: 1, purchase_date: "" })] })[0]).toBe(false);
  });

  it("a card statement counts as well as a bank statement", () => {
    const base = complete();
    expect(done({ ...base, documents: [doc(11, "receipt"), doc(12, "card_statement"), doc(13, "funding_approval")] })[3]).toBe(true);
  });

  it("a document on another claim does not count", () => {
    const base = complete();
    expect(done({ ...base, claimDocuments: [{ claim_id: 99, document_id: 12 }, { claim_id: 3, document_id: 13 }] })[3]).toBe(false);
  });

  it("an event purchase needs the flyer and every event detail; a purchase that was not for an event needs none", () => {
    const base = complete();
    const event = expense({ id: 1, event_related: true, event_name: "Fall concert", event_starts_at: "2026-10-05T23:30:00Z", event_attendee_count: 0, event_schedule: "7pm" });
    const withFlyer = { documents: [...base.documents, doc(14, "event_support")], claimDocuments: [...base.claimDocuments, { claim_id: 3, document_id: 14 }] };
    expect(done({ ...base, expenses: [event] })[4]).toBe(false);
    expect(done({ ...base, ...withFlyer, expenses: [event] })[4]).toBe(true);
    for (const missing of [{ event_name: "" }, { event_starts_at: null }, { event_attendee_count: null }, { event_schedule: "" }]) {
      expect(done({ ...base, ...withFlyer, expenses: [{ ...event, ...missing }] })[4], JSON.stringify(missing)).toBe(false);
    }
  });
});

describe("the cash ledger's filter", () => {
  const payments = [
    payment({ id: 1, description: "Gig at Memorial Hall", category: "Gig revenue", counterparty: "UNC Union", direction: "inflow", purpose: "income" }),
    payment({ id: 2, description: "Tabla repair", category: "Instruments", counterparty: "Raj Music", direction: "outflow", purpose: "member_reimbursement" }),
    payment({ id: 3, description: "Senate grant", category: "Grant", counterparty: "GPSG", direction: "inflow", purpose: "external_reimbursement" }),
  ];
  const ids = (query: string, flow: string) => filterPayments(payments, query, flow).map((item) => item.id);

  it("searches the description, the category and who it was paid by, ignoring case", () => {
    expect(ids("memorial", "all")).toEqual([1]);
    expect(ids("INSTRUMENTS", "all")).toEqual([2]);
    expect(ids("gpsg", "all")).toEqual([3]);
    expect(ids("", "all")).toEqual([1, 2, 3]);
    expect(ids("nothing", "all")).toEqual([]);
  });

  it("filters by direction or by purpose", () => {
    expect(ids("", "inflow")).toEqual([1, 3]);
    expect(ids("", "outflow")).toEqual([2]);
    expect(ids("", "member_reimbursement")).toEqual([2]);
    expect(ids("", "external_reimbursement")).toEqual([3]);
    expect(ids("grant", "inflow")).toEqual([3]);
  });
});

describe("reading the purchase form", () => {
  const form = (fields: Record<string, string>) => { const data = new FormData(); for (const [name, value] of Object.entries(fields)) data.append(name, value); return data; };

  it("a form with everything filled in", () => {
    expect(readPurchaseDetails(form({
      description: "Tabla repair", vendor: "Raj Music", amount: "42.5", purchase_date: "2026-10-01", category: "Instruments", subgroup_id: "4", club_event_id: "9",
      event_related: "on", event_name: "Fall concert", event_starts_at: "2026-10-05T18:30", event_attendee_count: "60", event_schedule: "7pm",
    }), "1234")).toEqual({
      description: "Tabla repair", vendor: "Raj Music", amount: 42.5, purchaseDate: "2026-10-01", category: "Instruments", cardLast4: "1234", subgroupId: 4, clubEventId: 9,
      eventRelated: true, eventName: "Fall concert", eventStartsAt: new Date("2026-10-05T18:30").toISOString(), eventAttendeeCount: 60, eventSchedule: "7pm",
    });
  });

  it("what was left empty is null, an unticked box is false, the category falls back to Other", () => {
    expect(readPurchaseDetails(form({ description: "x", vendor: "y", amount: "1", purchase_date: "2026-10-01", subgroup_id: "", event_attendee_count: "" }), "")).toEqual({
      description: "x", vendor: "y", amount: 1, purchaseDate: "2026-10-01", category: "Other", cardLast4: "", subgroupId: null, clubEventId: null,
      eventRelated: false, eventName: "", eventStartsAt: null, eventAttendeeCount: null, eventSchedule: "",
    });
  });

  it("zero attendees is a number, not 'left empty' (the form field says '0')", () => {
    // An empty text is "no answer"; the text "0" is truthy and is read as the number 0.
    expect(readPurchaseDetails(form({ event_attendee_count: "0" }), "").eventAttendeeCount).toBe(0);
  });

  it("an event time that is not a date is refused, as it always was", () => {
    expect(() => readPurchaseDetails(form({ event_starts_at: "not a date" }), "")).toThrow(RangeError);
  });
});
