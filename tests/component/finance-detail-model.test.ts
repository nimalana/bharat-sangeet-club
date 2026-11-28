// features/finance/detail.ts: what the detail dialog says about a request, an expense or a payment, worked out from the rows. Pure.
// The dates are the club's own time zone (America/New_York): 15:00 UTC in October is 11:00 AM.
import { describe, expect, it } from "vitest";
import type { Expense, FinanceAuditRow, Payment, Reimbursement } from "../../lib/api/finance";
import type { Profile } from "../../lib/db";
import { auditLines, buildDetail, expenseDetail, paymentDetail, requestDetail, when, whoIs, type DetailSource } from "../../features/finance/detail";
import { expense, payment, reimbursement } from "./finance-fixtures";

const profiles = new Map<string, Profile>([
  ["member-9", { id: "member-9", full_name: "Meera Nair", email: "meera@x.test" } as Profile],
  ["exec-2", { id: "exec-2", full_name: "Dev Menon", email: "dev@x.test" } as Profile],
  ["exec-3", { id: "exec-3", full_name: "", email: "noor@x.test" } as Profile],
]);
const asExec = whoIs({ userId: "exec-1", canManage: true, profileById: profiles });
const asMember = whoIs({ userId: "member-9", canManage: false, profileById: new Map() });
const names = (who = asExec) => ({ who, groupName: (id: number | null | undefined) => (id === 4 ? "Vocal" : null) });
const labels = (steps: Array<{ label: string }>) => steps.map((step) => step.label);

const request = (over = {}) => reimbursement(over) as unknown as Reimbursement;
const spent = (over = {}) => expense(over) as unknown as Expense;
const paid = (over = {}) => payment(over) as unknown as Payment;
const detailOf = (req: Reimbursement, exp: Expense | undefined, payments: Payment[] = [], who = asExec) => requestDetail({ request: req, expense: exp, payments, documentIds: [], names: names(who), payerName: "Meera Nair" });

describe("who", () => {
  it("is You for the viewer, a name for someone the screen knows (the email when there is no name), and the role for someone it does not", () => {
    expect(asExec("exec-1")).toBe("You");
    expect(asExec("exec-2")).toBe("Dev Menon");
    expect(asExec("exec-3")).toBe("noor@x.test");
    expect(asExec("someone-else")).toBe("Another person");
    expect(asExec(null)).toBeNull();
    expect(asMember("member-9")).toBe("You");
    expect(asMember("exec-2")).toBe("An executive");
  });

  it("when() writes a calendar day as written and an instant in the club's time zone", () => {
    expect(when("2026-10-03")).toBe("Oct 3, 2026");
    expect(when("2026-10-03T15:00:00Z")).toBe("Oct 3, 2026, 11:00 AM");
    expect(when(null)).toBe("");
  });
});

describe("a request's steps come from the request's own columns", () => {
  it("submitted: requested, and what it waits for", () => {
    const detail = detailOf(request({ status: "submitted", reviewed_by: null, reviewed_at: null, approved_amount: null, member_note: "Needed for rehearsal" }), spent({ status: "submitted" }));
    expect(detail.steps).toEqual([
      { id: "requested", label: "Requested", who: "Meera Nair", at: "2026-10-02T15:00:00Z", note: "Needed for rehearsal" },
      { id: "next", label: "Waiting for a review", who: null, at: null, pending: true },
    ]);
    expect(detail.facts).toContainEqual({ label: "Requested", value: "$80.00" });
    expect(detail.facts.map((fact) => fact.label)).not.toContain("Approved");
  });

  it("approved for part of it: who approved it, when, for how much, with the note; waiting for the payment", () => {
    const detail = detailOf(request({ status: "approved", approved_amount: 60, review_note: "Receipt is clear" }), spent());
    expect(detail.steps.map((step) => [step.label, step.who, step.at, step.note])).toEqual([
      ["Requested", "Meera Nair", "2026-10-02T15:00:00Z", undefined],
      ["Approved for $60.00", "Dev Menon", "2026-10-03T15:00:00Z", "Receipt is clear"],
      ["Waiting for the payment", null, null, undefined],
    ]);
    expect(detail.amount).toBe("$60.00");
    expect(detail.facts).toContainEqual({ label: "Approved", value: "$60.00" });
  });

  it("declined: the expense's rejected_by and rejected_at say who and when, not the approved pair", () => {
    const detail = detailOf(request({ status: "rejected", approved_amount: null, review_note: "Not a club purchase", reviewed_by: "exec-2" }), spent({ status: "rejected", approved_by: null, approved_at: null, rejected_by: "exec-3", rejected_at: "2026-10-04T15:00:00Z" }));
    expect(detail.steps.map((step) => [step.label, step.who, step.at, step.note])).toEqual([
      ["Requested", "Meera Nair", "2026-10-02T15:00:00Z", undefined],
      ["Declined", "noor@x.test", "2026-10-04T15:00:00Z", "Not a club purchase"],
    ]);
    expect(labels(detail.steps)).not.toContain("Approved for $80.00");
  });

  it("declined with only the request's row (a member's): the reviewer and the time of the review", () => {
    const detail = detailOf(request({ status: "rejected", approved_amount: null, review_note: "Not a club purchase" }), undefined, [], asMember);
    expect(detail.steps.map((step) => [step.label, step.who])).toEqual([["Requested", "You"], ["Declined", "An executive"]]);
  });

  it("changes requested: said as that; after the member sent it again the step says changes were requested and the request was sent again", () => {
    const asked = detailOf(request({ status: "changes_requested", approved_amount: null, review_note: "Photo is blurry" }), spent());
    expect(asked.steps.map((step) => step.label)).toEqual(["Requested", "Changes requested", "Waiting for the request to be edited and sent again"]);
    expect(asked.steps[1].note).toBe("Photo is blurry");
    const again = detailOf(request({ status: "submitted", approved_amount: null, review_note: "Photo is blurry" }), spent());
    expect(again.steps.map((step) => step.label)).toEqual(["Requested", "Changes were requested, then the request was sent again", "Waiting for a review"]);
  });

  it("paid: the payment's who, when, amount and account; the request's paid_at alone is enough when no payment is readable", () => {
    const withPayment = detailOf(request({ status: "paid", paid_at: "2026-10-03T16:00:00Z" }), spent({ status: "settled" }), [paid({ created_by: "exec-3", created_at: "2026-10-03T16:00:00Z" })]);
    expect(withPayment.steps.map((step) => [step.label, step.who, step.note])).toEqual([
      ["Requested", "Meera Nair", undefined], ["Approved for $80.00", "Dev Menon", undefined], ["Paid", "noor@x.test", "$80.00 from Club bank account"],
    ]);
    const withoutPayment = detailOf(request({ status: "paid", paid_at: "2026-10-03T16:00:00Z" }), spent({ status: "settled" }), []);
    expect(withoutPayment.steps.at(-1)).toEqual({ id: "paid", label: "Paid", who: null, at: "2026-10-03T16:00:00Z" });
  });

  it("a payment that was voided: paid, then voided with who, when and why, then waiting for the payment again", () => {
    const detail = detailOf(request({ status: "approved", paid_at: null }), spent(), [paid({ status: "voided", created_by: "exec-2", created_at: "2026-10-03T16:00:00Z", voided_by: "exec-3", voided_at: "2026-10-04T16:00:00Z", void_reason: "Wrong account" })]);
    expect(detail.steps.map((step) => [step.label, step.who, step.note])).toEqual([
      ["Requested", "Meera Nair", undefined], ["Approved for $80.00", "Dev Menon", undefined], ["Paid", "Dev Menon", "$80.00 from Club bank account"],
      ["Payment voided", "noor@x.test", "Wrong account"], ["Waiting for the payment", null, undefined],
    ]);
  });

  it("voided: who, when and the reason; a request that was approved first keeps its approval step", () => {
    const detail = detailOf(request({ status: "voided", voided_by: "member-9", voided_at: "2026-10-05T15:00:00Z", void_reason: "Withdrawn by member", approved_amount: null, reviewed_by: null, reviewed_at: null }), spent({ status: "voided" }), [], asMember);
    expect(detail.steps.map((step) => [step.label, step.who, step.at, step.note])).toEqual([
      ["Requested", "You", "2026-10-02T15:00:00Z", undefined], ["Voided", "You", "2026-10-05T15:00:00Z", "Withdrawn by member"],
    ]);
    const afterApproval = detailOf(request({ status: "voided", voided_by: "exec-3", voided_at: "2026-10-05T15:00:00Z", void_reason: "Entered twice" }), spent({ status: "voided" }));
    expect(labels(afterApproval.steps)).toEqual(["Requested", "Approved for $80.00", "Voided"]);
  });

  it("the steps are in the order they happened, whatever order the columns were read in", () => {
    const detail = detailOf(request({ status: "paid", paid_at: "2026-10-03T16:00:00Z" }), spent(), [paid({ created_at: "2026-10-03T16:00:00Z", created_by: "exec-2" })]);
    const times = detail.steps.map((step) => step.at);
    expect([...times].sort()).toEqual(times);
  });

  it("paid again after a void: the two payments are read newest first but the steps come out oldest first", () => {
    const newer = paid({ id: 9, created_by: "exec-3", created_at: "2026-10-10T16:00:00Z" });
    const older = paid({ id: 7, status: "voided", created_by: "exec-2", created_at: "2026-10-03T16:00:00Z", voided_by: "exec-3", voided_at: "2026-10-09T16:00:00Z", void_reason: "Wrong account" });
    const detail = detailOf(request({ status: "paid", paid_at: "2026-10-10T16:00:00Z" }), spent(), [newer, older]);
    expect(detail.steps.map((step) => [step.label, step.at])).toEqual([
      ["Requested", "2026-10-02T15:00:00Z"], ["Approved for $80.00", "2026-10-03T15:00:00Z"], ["Paid", "2026-10-03T16:00:00Z"], ["Payment voided", "2026-10-09T16:00:00Z"], ["Paid", "2026-10-10T16:00:00Z"],
    ]);
  });

  it("a member's own purchase has its facts; a group and an event are named when the expense has them", () => {
    const detail = detailOf(request(), spent({ subgroup_id: 4, event_related: true, event_name: "Fall concert" }));
    expect(detail.facts).toEqual([
      { label: "Requested", value: "$80.00" }, { label: "Approved", value: "$80.00" }, { label: "Requested by", value: "Meera Nair" },
      { label: "Purchased", value: "Raj Music · Oct 1, 2026" }, { label: "Category", value: "Instruments" }, { label: "Card", value: "•••• 1234" },
      { label: "Paid by", value: "Meera Nair" }, { label: "Group", value: "Vocal" }, { label: "Event", value: "Fall concert" },
    ]);
  });
});

describe("an expense's and a payment's steps", () => {
  it("an expense: recorded, approved, paid and voided, each with who and when; a declined one says declined", () => {
    const voided = expenseDetail({ expense: spent({ status: "voided", created_by: "member-9", voided_by: "exec-2", voided_at: "2026-10-06T15:00:00Z", void_reason: "Entered twice" }), payments: [paid()], documentIds: [], names: names(), payerName: "Meera Nair" });
    expect(voided.steps.map((step) => [step.label, step.who, step.note])).toEqual([
      ["Recorded", "Meera Nair", undefined], ["Approved", "Dev Menon", undefined], ["Paid", "Dev Menon", "$80.00 from Club bank account"], ["Voided", "Dev Menon", "Entered twice"],
    ]);
    const declined = expenseDetail({ expense: spent({ status: "rejected", approved_by: null, approved_at: null, rejected_by: "exec-2", rejected_at: "2026-10-04T15:00:00Z" }), payments: [], documentIds: [], names: names(), payerName: "Meera Nair" });
    expect(labels(declined.steps)).toEqual(["Recorded", "Declined"]);
    const waiting = expenseDetail({ expense: spent({ status: "submitted", approved_by: null, approved_at: null }), payments: [], documentIds: [], names: names(), payerName: "Meera Nair" });
    expect(waiting.steps.at(-1)).toMatchObject({ label: "Waiting for a review", pending: true });
  });

  it("a payment: recorded, cleared on a day, voided; money in is a plus", () => {
    const detail = paymentDetail({ payment: paid({ direction: "inflow", purpose: "income", amount: 120, status: "voided", cleared_date: "2026-10-05", voided_by: "exec-2", voided_at: "2026-10-07T15:00:00Z", void_reason: "Duplicate" }), documentIds: [], names: names() });
    expect(detail.amount).toBe("+$120.00");
    expect(detail.facts).toContainEqual({ label: "Direction", value: "Money in" });
    expect(detail.facts).toContainEqual({ label: "Kind", value: "income" });
    expect(detail.steps.map((step) => [step.label, step.who, step.at, step.note])).toEqual([
      ["Recorded", "Dev Menon", "2026-10-03T16:00:00Z", undefined], ["Cleared the bank", null, "2026-10-05", undefined], ["Voided", "Dev Menon", "2026-10-07T15:00:00Z", "Duplicate"],
    ]);
  });
});

describe("buildDetail finds the record a link names, with its documents", () => {
  const snapshot: DetailSource["snapshot"] = {
    expenses: [spent(), spent({ id: 2, description: "Harmonium strap" })], reimbursements: [request({ id: 5, expense_id: 1 })], payments: [paid({ id: 7, expense_id: 1, reimbursement_id: 5 }), paid({ id: 8, expense_id: null, reimbursement_id: null, funding_claim_id: 3, purpose: "external_reimbursement" })],
    documents: [{ id: 11, title: "Taxi receipt" }, { id: 12, title: "Statement" }, { id: 13, title: "Flyer" }] as DetailSource["snapshot"]["documents"],
    expenseDocuments: [{ expense_id: 1, document_id: 11 }, { expense_id: 1, document_id: 99 }], reimbursementDocuments: [{ reimbursement_id: 5, document_id: 11 }, { reimbursement_id: 5, document_id: 12 }],
    claimDocuments: [{ claim_id: 3, document_id: 13 }],
  };
  const source: DetailSource = { snapshot, names: names() };

  it("a request: its receipts and its expense's, each once, and only the documents the screen has", () => {
    expect(buildDetail({ kind: "request", id: 5 }, source)?.documentIds).toEqual([11, 12]);
  });
  it("an expense: its documents and its requests'", () => {
    expect(buildDetail({ kind: "expense", id: 1 }, source)?.documentIds).toEqual([11, 12]);
    expect(buildDetail({ kind: "expense", id: 2 }, source)?.documentIds).toEqual([]);
  });
  it("a payment: its expense's documents, or its claim's", () => {
    expect(buildDetail({ kind: "payment", id: 7 }, source)?.documentIds).toEqual([11]);
    expect(buildDetail({ kind: "payment", id: 8 }, source)?.documentIds).toEqual([13]);
  });
  it("a record the screen does not have is null", () => {
    expect(buildDetail({ kind: "request", id: 404 }, source)).toBeNull();
    expect(buildDetail({ kind: "expense", id: 404 }, source)).toBeNull();
    expect(buildDetail({ kind: "payment", id: 404 }, source)).toBeNull();
  });
});

describe("the audit history in words", () => {
  const row = (over: Partial<FinanceAuditRow>): FinanceAuditRow => ({ id: 1, entity_type: "personal_reimbursements", entity_id: 5, action: "update", actor_id: "exec-2", created_at: "2026-10-03T15:00:00Z", before_data: null, after_data: null, ...over });

  it("names the action, who did it and when, and what changed: money as money, no ids", () => {
    const [approved] = auditLines([row({ action: "approved", before_data: { status: "submitted", requested_amount: 80 }, after_data: { status: "approved", approved_amount: 60, review_note: "Receipt is clear", reviewed_by: "exec-2", reviewed_at: "2026-10-03T15:00:00Z", expense_id: 1 } })], asExec);
    expect(approved).toMatchObject({ label: "Approved", who: "Dev Menon", at: "2026-10-03T15:00:00Z" });
    expect(approved.changes).toEqual(["Status: submitted → approved", "Approved: none → $60.00", "Reviewer's note: none → Receipt is clear"]);
    expect(approved.changes.join(" ")).not.toMatch(/exec-2|reviewed|expense_id/);
  });

  it("an insert says what it started as; an update says what differs; a change of nothing readable says nothing", () => {
    const [created, updated, quiet] = auditLines([
      row({ id: 1, action: "insert", after_data: { status: "submitted", requested_amount: 80, id: 5, member_id: "member-9" } }),
      row({ id: 2, action: "update", before_data: { status: "approved", paid_at: null }, after_data: { status: "paid", paid_at: "2026-10-03T16:00:00Z" } }),
      row({ id: 3, action: "update", before_data: { updated_at: "a" }, after_data: { updated_at: "b" } }),
    ], asExec);
    expect(created).toMatchObject({ label: "Created", changes: ["Status: submitted", "Requested: $80.00"] });
    expect(updated).toMatchObject({ label: "Changed", changes: ["Status: approved → paid"] });
    expect(quiet.changes).toEqual([]);
  });

  it("a row with no actor has no name, and an unknown action is worded from its name", () => {
    const [line] = auditLines([row({ action: "payment_voided", actor_id: null })], asExec);
    expect(line.who).toBeNull();
    expect(line.label).toBe("payment voided");
  });
});
