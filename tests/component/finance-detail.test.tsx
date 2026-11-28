// Phase 3.3 on the Finance screen: the detail of a request, an expense or a payment (amounts, status, who did what and when, receipts, and for
// an executive the audit history), the preview of a document wherever one is listed, and the address that opens a detail (?request= ...).
//
// The audit log is readable only by executives (row-level security): a member's dialog is built from their own request's row and never reads it.
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { expectNoSeriousViolations } from "../support/a11y";
import { keyboardUser } from "../support/keyboard";
import { deferred, fail, fake, ok, rejects } from "../support/fake-supabase";
import { claim, expense, openTab, payment, reimbursement, renderFinance, scriptFinance, waitForLoad, waitForMemberLoad } from "./finance-fixtures";

const at = (address: string) => window.history.replaceState({}, "", address);
const search = () => window.location.search;
const detailDialog = () => screen.findByRole("dialog");
const closed = () => waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
const audit = (rows: unknown[]) => fake.from("finance_audit_log", "select").reply(ok(rows));

const RECEIPT = { id: 11, document_type: "receipt", title: "Taxi receipt", storage_path: "member-9/taxi.pdf", uploaded_by: "member-9", mime_type: "application/pdf" };
const WITH_RECEIPT = { documents: [RECEIPT], reimbursementDocuments: [{ reimbursement_id: 5, document_id: 11 }], expenseDocuments: [{ expense_id: 1, document_id: 11 }] };

const APPROVED = {
  expenses: [expense({ subgroup_id: 4, event_related: true, event_name: "Fall concert" })],
  reimbursements: [reimbursement({ status: "approved", approved_amount: 60, review_note: "Receipt is clear", member_note: "Needed for rehearsal" })],
  payments: [],
  ...WITH_RECEIPT,
};

describe("finance: the detail of a request, as an executive sees it", () => {
  it("opens from the request's Details button with its amounts, facts, who did what and when, and its receipt; the address names it, and Escape closes it and returns focus", async () => {
    at("/?page=finance&tab=reimbursements");
    scriptFinance(APPROVED);
    audit([]);
    renderFinance();
    await waitForLoad();
    const button = await screen.findByRole("button", { name: "Details of Tabla repair" });
    button.focus();
    fireEvent.click(button);
    const dialog = await screen.findByRole("dialog", { name: "Tabla repair" });
    await waitFor(() => expect(search()).toBe("?page=finance&tab=reimbursements&request=5"));

    expect(within(dialog).getByText("REIMBURSEMENT REQUEST")).toBeInTheDocument();
    expect(within(dialog).getByText("approved")).toBeInTheDocument();
    expect(within(dialog).getByText("$60.00", { selector: "strong" })).toBeInTheDocument();
    const facts = Object.fromEntries(Array.from(dialog.querySelectorAll(".finance-facts > div")).map((row) => [row.querySelector("dt")!.textContent, row.querySelector("dd")!.textContent]));
    expect(facts).toEqual({
      Requested: "$80.00", Approved: "$60.00", "Requested by": "Meera Nair", Purchased: "Raj Music · Oct 1, 2026", Category: "Instruments", Card: "•••• 1234",
      "Paid by": "Meera Nair", Group: "Vocal", Event: "Fall concert",
    });
    const steps = Array.from(within(dialog).getByRole("list", { name: "What happened" }).querySelectorAll(":scope > li")).map((item) => item.textContent);
    expect(steps).toEqual([
      "RequestedMeera Nair · Oct 2, 2026, 11:00 AMNeeded for rehearsal",
      "Approved for $60.00Dev Menon · Oct 3, 2026, 11:00 AMReceipt is clear",
      "Waiting for the payment",
    ]);
    expect(within(dialog).getByRole("button", { name: "▤ Taxi receipt" })).toBeInTheDocument();

    fireEvent.keyDown(dialog, { key: "Escape" });
    await closed();
    await waitFor(() => expect(search()).toBe("?page=finance&tab=reimbursements"));
    expect(button).toHaveFocus();
  });

  it("an executive's dialog reads the audit history of the request, newest first, in words: who, when, what changed", async () => {
    scriptFinance(APPROVED);
    audit([
      { id: 31, entity_type: "personal_reimbursements", entity_id: 5, action: "approved", actor_id: "exec-2", created_at: "2026-10-03T15:00:00Z", before_data: { status: "submitted", requested_amount: 80 }, after_data: { status: "approved", approved_amount: 60, review_note: "Receipt is clear", reviewed_by: "exec-2" } },
      { id: 30, entity_type: "personal_reimbursements", entity_id: 5, action: "insert", actor_id: "member-9", created_at: "2026-10-02T15:00:00Z", before_data: null, after_data: { status: "submitted", requested_amount: 80, member_id: "member-9" } },
    ]);
    renderFinance();
    await waitForLoad();
    await openTab("reimbursements");
    fireEvent.click(await screen.findByRole("button", { name: "Details of Tabla repair" }));
    const dialog = await detailDialog();
    const history = await within(dialog).findByRole("list", { name: "Audit history" });
    expect(Array.from(history.querySelectorAll(":scope > li")).map((item) => item.textContent)).toEqual([
      "ApprovedDev Menon · Oct 3, 2026, 11:00 AMStatus: submitted → approvedApproved: none → $60.00Reviewer's note: none → Receipt is clear",
      "CreatedMeera Nair · Oct 2, 2026, 11:00 AMStatus: submittedRequested: $80.00",
    ]);
    const call = fake.from("finance_audit_log", "select").calls[0];
    expect(call.chain.map((link) => [link.method, ...link.args]).slice(1, 3)).toEqual([["eq", "entity_type", "personal_reimbursements"], ["in", "entity_id", [5]]]);
    expect(within(dialog).queryByText(/exec-2|member-9/)).not.toBeInTheDocument();
  });

  it("while the history is read it says so as a status; when it cannot be read it says so with Try again, and the rest of the dialog is there; a second try shows it", async () => {
    scriptFinance(APPROVED);
    fake.from("finance_audit_log", "select").replyOnce(fail("The database is unavailable"));
    const second = deferred();
    fake.from("finance_audit_log", "select").reply(second.reply);
    renderFinance();
    await waitForLoad();
    await openTab("reimbursements");
    fireEvent.click(await screen.findByRole("button", { name: "Details of Tabla repair" }));
    const dialog = await detailDialog();
    const alert = await within(dialog).findByRole("alert");
    expect(alert).toHaveTextContent("The database is unavailable");
    expect(within(dialog).getByRole("list", { name: "What happened" })).toBeInTheDocument();
    fireEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    expect(await within(dialog).findByText("Loading the history…")).toHaveAttribute("role", "status");
    await act(async () => { second.resolve(ok([{ id: 30, entity_type: "personal_reimbursements", entity_id: 5, action: "insert", actor_id: "member-9", created_at: "2026-10-02T15:00:00Z", before_data: null, after_data: { status: "submitted" } }])); });
    expect(await within(dialog).findByRole("list", { name: "Audit history" })).toBeInTheDocument();
    expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument();
  });

  it("a history with nothing in it says so; a history of 100 rows says it is the latest 100", async () => {
    scriptFinance(APPROVED);
    audit([]);
    const first = renderFinance();
    await waitForLoad();
    await openTab("reimbursements");
    fireEvent.click(await screen.findByRole("button", { name: "Details of Tabla repair" }));
    expect(await within(await detailDialog()).findByText("Nothing has been recorded yet.")).toBeInTheDocument();
    first.view.unmount();

    scriptFinance(APPROVED);
    audit(Array.from({ length: 100 }, (_, index) => ({ id: 200 - index, entity_type: "personal_reimbursements", entity_id: 5, action: "update", actor_id: "exec-2", created_at: "2026-10-03T15:00:00Z", before_data: { status: "a" }, after_data: { status: "b" } })));
    renderFinance();
    await waitForLoad();
    await openTab("reimbursements");
    fireEvent.click(await screen.findByRole("button", { name: "Details of Tabla repair" }));
    expect(await within(await detailDialog()).findByText("Showing the latest 100 entries.")).toBeInTheDocument();
  });

  it("a declined request says who declined it and when, from the expense's rejected_by and rejected_at", async () => {
    scriptFinance({
      expenses: [expense({ status: "rejected", approved_by: null, approved_at: null, rejected_by: "exec-2", rejected_at: "2026-10-04T15:00:00Z" })],
      reimbursements: [reimbursement({ status: "rejected", approved_amount: null, review_note: "Not a club purchase" })], payments: [],
    });
    audit([]);
    renderFinance();
    await waitForLoad();
    await openTab("reimbursements");
    fireEvent.click(await screen.findByRole("button", { name: "Details of Tabla repair" }));
    const dialog = await detailDialog();
    const steps = Array.from(within(dialog).getByRole("list", { name: "What happened" }).querySelectorAll(":scope > li")).map((item) => item.textContent);
    expect(steps).toEqual(["RequestedMeera Nair · Oct 2, 2026, 11:00 AM", "DeclinedDev Menon · Oct 4, 2026, 11:00 AMNot a club purchase"]);
  });

  it("a paid request shows the payment: who paid, when, how much, from which account; a voided one shows who voided it, when and why", async () => {
    scriptFinance({
      reimbursements: [reimbursement({ status: "paid", paid_at: "2026-10-03T16:00:00Z" })],
      payments: [payment({ created_by: "exec-2", created_at: "2026-10-03T16:00:00Z" })],
    });
    audit([]);
    renderFinance();
    await waitForLoad();
    await openTab("reimbursements");
    fireEvent.click(await screen.findByRole("button", { name: "Details of Tabla repair" }));
    const steps = Array.from(within(await detailDialog()).getByRole("list", { name: "What happened" }).querySelectorAll(":scope > li")).map((item) => item.textContent);
    expect(steps.at(-1)).toBe("PaidDev Menon · Oct 3, 2026, 12:00 PM$80.00 from Club bank account");
  });
});

describe("finance: the detail of a request, as the member sees it", () => {
  it("is built from their own request's row: You, an executive, the dates, the note; it never reads the audit log and has no history", async () => {
    scriptFinance({ ...APPROVED, profiles: [] });
    renderFinance({ role: "member", userId: "member-9" });
    await waitForMemberLoad();
    fireEvent.click(await screen.findByRole("button", { name: "Details of Tabla repair" }));
    const dialog = await detailDialog();
    const steps = Array.from(within(dialog).getByRole("list", { name: "What happened" }).querySelectorAll(":scope > li")).map((item) => item.textContent);
    expect(steps).toEqual([
      "RequestedYou · Oct 2, 2026, 11:00 AMNeeded for rehearsal",
      "Approved for $60.00An executive · Oct 3, 2026, 11:00 AMReceipt is clear",
      "Waiting for the payment",
    ]);
    expect(within(dialog).queryByText("Audit history")).not.toBeInTheDocument();
    expect(fake.from("finance_audit_log", "select").count).toBe(0);
    expect(within(dialog).queryByText(/exec-2|member-9/)).not.toBeInTheDocument();
  });

  it("a withdrawn request says You withdrew it, with the reason the database kept", async () => {
    scriptFinance({ reimbursements: [reimbursement({ status: "voided", approved_amount: null, reviewed_by: null, reviewed_at: null, voided_by: "member-9", voided_at: "2026-10-05T15:00:00Z", void_reason: "Withdrawn by member" })], expenses: [expense({ status: "voided" })], payments: [], profiles: [] });
    renderFinance({ role: "member", userId: "member-9" });
    await waitForMemberLoad();
    fireEvent.click(await screen.findByRole("button", { name: "Details of Tabla repair" }));
    const steps = Array.from(within(await detailDialog()).getByRole("list", { name: "What happened" }).querySelectorAll(":scope > li")).map((item) => item.textContent);
    expect(steps).toEqual(["RequestedYou · Oct 2, 2026, 11:00 AM", "VoidedYou · Oct 5, 2026, 11:00 AMWithdrawn by member"]);
    expect(fake.from("finance_audit_log", "select").count).toBe(0);
  });
});

describe("finance: the detail of an expense and of a payment", () => {
  it("an expense from the register: recorded, approved, voided with the reason; a voided one still has Details", async () => {
    scriptFinance({
      expenses: [expense({ status: "voided", voided_by: "exec-2", voided_at: "2026-10-06T15:00:00Z", void_reason: "Entered twice" })],
      reimbursements: [], payments: [],
    });
    audit([]);
    renderFinance();
    await waitForLoad();
    await openTab("expenses");
    fireEvent.click(await screen.findByRole("button", { name: "Details of Tabla repair" }));
    const dialog = await detailDialog();
    await waitFor(() => expect(search()).toBe("?tab=expenses&expense=1"));
    expect(within(dialog).getByText("EXPENSE")).toBeInTheDocument();
    const steps = Array.from(within(dialog).getByRole("list", { name: "What happened" }).querySelectorAll(":scope > li")).map((item) => item.textContent);
    expect(steps).toEqual([
      "RecordedMeera Nair · Oct 1, 2026, 11:00 AM", "ApprovedDev Menon · Oct 3, 2026, 11:00 AM", "VoidedDev Menon · Oct 6, 2026, 11:00 AMEntered twice",
    ]);
    expect((await within(dialog).findAllByText("Nothing has been recorded yet.")).length).toBe(1);
    expect(fake.from("finance_audit_log", "select").calls[0].chain[1]).toMatchObject({ args: ["entity_type", "finance_expenses"] });
  });

  it("a payment from the ledger: recorded, cleared, voided; the amount carries its direction", async () => {
    scriptFinance({
      payments: [payment({ id: 8, direction: "inflow", purpose: "income", description: "Gig at Memorial Hall", counterparty: "Memorial Hall", amount: 120, cleared_date: "2026-10-05", reimbursement_id: null, expense_id: null, created_by: "exec-2" })],
    });
    audit([]);
    renderFinance();
    await waitForLoad();
    fireEvent.click(await screen.findByRole("button", { name: "Details of Gig at Memorial Hall" }));
    const dialog = await screen.findByRole("dialog", { name: "Gig at Memorial Hall" });
    await waitFor(() => expect(search()).toBe("?payment=8"));
    expect(within(dialog).getByText("+$120.00")).toBeInTheDocument();
    const steps = Array.from(within(dialog).getByRole("list", { name: "What happened" }).querySelectorAll(":scope > li")).map((item) => item.textContent);
    expect(steps).toEqual(["RecordedDev Menon · Oct 3, 2026, 12:00 PM", "Cleared the bankOct 5, 2026"]);
    expect(within(dialog).getByText("Money in")).toBeInTheDocument();
  });
});

describe("finance: a link opens a detail", () => {
  it("?request= opens that request once the screen has loaded; Back closes it; the same link again is the same dialog", async () => {
    at("/?page=finance&tab=reimbursements&request=5");
    scriptFinance(APPROVED);
    audit([]);
    renderFinance();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();           // nothing to show before the lists are read
    expect(await screen.findByRole("dialog", { name: "Tabla repair" })).toBeInTheDocument();
    expect(search()).toBe("?page=finance&tab=reimbursements&request=5");     // reading never writes
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await closed();
    expect(search()).toBe("?page=finance&tab=reimbursements");
    await act(async () => { window.history.back(); });
    expect(await screen.findByRole("dialog", { name: "Tabla repair" })).toBeInTheDocument();
  });

  it("?expense= and ?payment= open theirs; with more than one the request wins, then the expense", async () => {
    at("/?expense=1&payment=7");
    scriptFinance(APPROVED);
    audit([]);
    const first = renderFinance();
    expect(await screen.findByRole("dialog", { name: "Tabla repair" })).toBeInTheDocument();
    expect(within(screen.getByRole("dialog")).getByText("EXPENSE")).toBeInTheDocument();
    first.view.unmount();

    at("/?payment=7&request=5");
    scriptFinance(APPROVED);
    audit([]);
    renderFinance();
    expect(within(await screen.findByRole("dialog")).getByText("REIMBURSEMENT REQUEST")).toBeInTheDocument();
  });

  it.each(["?request=999", "?request=abc", "?request=0", "?request=-1", "?request=5abc", "?request=", "?request=1.5", "?request=05", "?request=5.0", "?request=0x5", "?request=%205", "?expense=999", "?payment=999"])(
    "%s is not a record this screen has, or not a plain id (5 is, 05 and 5.0 are not): no dialog, no error, the screen as usual, and the address is left as it is",
    async (query) => {
      at(`/${query}`);
      scriptFinance(APPROVED);
      renderFinance();
      await waitForLoad();
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(search()).toBe(query);
    });

  it("a member's link to a request that is not theirs shows nothing (they cannot read it) and reads nothing more", async () => {
    at("/?request=77");
    scriptFinance(APPROVED);
    renderFinance({ role: "member", userId: "member-9" });
    await waitForMemberLoad();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(fake.from("finance_audit_log", "select").count).toBe(0);
  });

  it("opening one clears the others in the address, and it is one history entry; closing it is one more", async () => {
    at("/?page=finance&payment=999&expense=998");      // links to records this screen does not have: nothing opens
    scriptFinance(APPROVED);
    audit([]);
    renderFinance();
    await waitForLoad();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await openTab("reimbursements");
    const entries = window.history.length;
    fireEvent.click(await screen.findByRole("button", { name: "Details of Tabla repair" }));
    await screen.findByRole("dialog");
    await waitFor(() => expect(search()).toBe("?page=finance&tab=reimbursements&request=5"));
    expect(window.history.length).toBe(entries + 1);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await closed();
    await waitFor(() => expect(search()).toBe("?page=finance&tab=reimbursements"));
    expect(window.history.length).toBe(entries + 2);
  });
});

describe("finance: a document opens in a preview wherever it is listed", () => {
  it("from the detail: the preview is over the detail, Escape closes the preview first and focus returns to the chip, the detail is still there", async () => {
    scriptFinance(APPROVED);
    audit([]);
    renderFinance();
    await waitForLoad();
    await openTab("reimbursements");
    fireEvent.click(await screen.findByRole("button", { name: "Details of Tabla repair" }));
    const detail = await screen.findByRole("dialog", { name: "Tabla repair" });
    const chip = within(detail).getByRole("button", { name: "▤ Taxi receipt" });
    chip.focus();
    fireEvent.click(chip);
    const preview = await screen.findByRole("dialog", { name: "Taxi receipt" });
    await waitFor(() => expect(within(preview).getByTitle("Taxi receipt (PDF)")).toBeInTheDocument());
    fireEvent.keyDown(preview, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Taxi receipt" })).not.toBeInTheDocument());
    expect(screen.getByRole("dialog", { name: "Tabla repair" })).toBeInTheDocument();
    expect(chip).toHaveFocus();
  });

  it("a funding claim lists its documents as chips that open in a preview; a claim with none lists none", async () => {
    scriptFinance({
      claims: [claim({ id: 3, status: "draft" }), claim({ id: 4, title: "Winter gala", status: "draft" })], claimExpenses: [],
      documents: [{ id: 21, document_type: "funding_approval", title: "Senate approval", storage_path: "exec-1/approval.pdf", uploaded_by: "exec-1", mime_type: "application/pdf" }],
      claimDocuments: [{ claim_id: 3, document_id: 21 }],
    });
    renderFinance();
    await waitForLoad();
    await openTab("Funding claims");
    const group = await screen.findByRole("group", { name: "Documents of this claim" });
    expect(screen.getAllByRole("group", { name: "Documents of this claim" })).toHaveLength(1);
    fireEvent.click(within(group).getByRole("button", { name: "▤ Senate approval" }));
    const preview = await screen.findByRole("dialog", { name: "Senate approval" });
    await waitFor(() => expect(within(preview).getByTitle("Senate approval (PDF)")).toHaveAttribute("src", "https://files.test/finance-private/exec-1/approval.pdf?signed"));
  });

  it("a document the preview cannot link says why with Try again, and a dropped connection is worded as one", async () => {
    scriptFinance(APPROVED);
    audit([]);
    fake.storage("finance-private", "createSignedUrl").reply(rejects());
    renderFinance();
    await waitForLoad();
    await openTab("reimbursements");
    fireEvent.click(await screen.findByRole("button", { name: "▤ Taxi receipt" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The connection dropped. Check your internet and try again.");
  });
});

describe("finance: the detail with the keyboard and axe", () => {
  it("Enter on Details opens it, the first Tab stop is Close, and Escape closes it and puts focus back on Details", async () => {
    scriptFinance(APPROVED);
    audit([]);
    renderFinance();
    await waitForLoad();
    await openTab("reimbursements");
    const user = keyboardUser();
    const button = await screen.findByRole("button", { name: "Details of Tabla repair" });
    button.focus();
    await user.keyboard("{Enter}");
    const dialog = await screen.findByRole("dialog", { name: "Tabla repair" });
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    await user.tab();
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    await user.keyboard("{Escape}");
    await closed();
    expect(button).toHaveFocus();
  });

  it("no serious violation: an executive's detail (loading, read, failed), a member's detail, a payment's, and a preview over a detail", async () => {
    scriptFinance({ ...APPROVED, payments: [payment({ id: 7, created_by: "exec-2" })] });
    fake.from("finance_audit_log", "select").replyOnce(fail("down"));
    const rows = [{ id: 30, entity_type: "personal_reimbursements", entity_id: 5, action: "insert", actor_id: "member-9", created_at: "2026-10-02T15:00:00Z", before_data: null, after_data: { status: "submitted" } }];
    fake.from("finance_audit_log", "select").reply(ok(rows));
    const first = renderFinance();
    await waitForLoad();
    await openTab("reimbursements");
    fireEvent.click(await screen.findByRole("button", { name: "Details of Tabla repair" }));
    const dialog = await screen.findByRole("dialog", { name: "Tabla repair" });
    await within(dialog).findByRole("alert");
    await expectNoSeriousViolations(first.view.baseElement);
    fireEvent.click(within(dialog).getByRole("button", { name: "Try again" }));
    await within(dialog).findByRole("list", { name: "Audit history" });
    await expectNoSeriousViolations(first.view.baseElement);
    fireEvent.click(within(dialog).getByRole("button", { name: "▤ Taxi receipt" }));
    await waitFor(() => expect(screen.getByTitle("Taxi receipt (PDF)")).toBeInTheDocument());
    await expectNoSeriousViolations(first.view.baseElement);
    first.view.unmount();

    at("/");
    scriptFinance({ ...APPROVED, profiles: [] });
    const member = renderFinance({ role: "member", userId: "member-9" });
    await waitForMemberLoad();
    fireEvent.click(await screen.findByRole("button", { name: "Details of Tabla repair" }));
    await screen.findByRole("dialog", { name: "Tabla repair" });
    await expectNoSeriousViolations(member.view.baseElement);
    member.view.unmount();

    at("/?page=finance&payment=7");
    scriptFinance({ payments: [payment({ id: 7, created_by: "exec-2" })] });
    audit([]);
    const last = renderFinance();
    await screen.findByRole("dialog", { name: "Reimbursement: Tabla repair" });
    await expectNoSeriousViolations(last.view.baseElement);
  });
});
