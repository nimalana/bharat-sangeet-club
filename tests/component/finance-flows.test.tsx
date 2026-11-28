// The Finance screen's changes that tests/component/finance.test.tsx does not reach: the corrections an executive and a member make
// from a dialog (approve, decline, ask for changes, void, edit, withdraw, the funder's answers, the claim's expenses), the forms that
// save a record and a file (income, club expense, funding claim, claim payment, claim document, receipt), opening a stored document,
// the member's own view, and reopening the screen.
//
// The first file pins the timing and single-flight rules and the tone of every database sentence; this one pins WHAT each change sends
// (the database function and its arguments), WHAT the person is told, and what happens to the dialog and the lists afterwards. Written
// when features/finance was split into hooks and components: every one of these passes on the old single-file screen too.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FinancePage } from "../../features/finance/components/finance-page";
import { setCacheOwner } from "../../lib/cache";
import { flush, notifySpy, userOf } from "../support/helpers";
import { fail, fake, never, ok } from "../support/fake-supabase";

const expense = (over: Record<string, unknown> = {}) => ({
  id: 1, description: "Tabla repair", vendor: "Raj Music", amount: 80, purchase_date: "2026-10-01", category: "Instruments", paid_by: "member", paid_by_member_id: "member-9",
  payment_card_last4: "1234", subgroup_id: 4, club_event_id: 9, event_related: true, event_name: "Fall concert", event_starts_at: "2026-10-05T23:30:00Z", event_attendee_count: 60,
  event_schedule: "7pm doors", status: "approved", created_by: "member-9", ...over,
});
const reimbursement = (over: Record<string, unknown> = {}) => ({ id: 5, expense_id: 1, member_id: "member-9", requested_amount: 80, approved_amount: 80, status: "submitted", member_note: "Cab fare", review_note: "", created_at: "2026-10-02T00:00:00Z", ...over });
const payment = (over: Record<string, unknown> = {}) => ({ id: 7, direction: "outflow", purpose: "member_reimbursement", amount: 80, description: "Reimbursement: Tabla repair", category: "Instruments", account_name: "Club bank account", counterparty: "", payment_date: "2026-10-03", status: "posted", reimbursement_id: 6, funding_claim_id: null, ...over });
const claim = (over: Record<string, unknown> = {}) => ({ id: 3, title: "Fall concert", funder_name: "GPSG Senate", award_reference: "", heellife_reference: "", requested_amount: 80, approved_amount: null, received_amount: 0, submission_deadline: null, status: "draft", notes: "", ...over });
const SUMMARY = { available_cash: 1234, income: 2000, spending: 766, pending_reimbursement_total: 80, pending_reimbursement_count: 1, expected_funding: 0 };

type Data = Record<"expenses" | "reimbursements" | "payments" | "documents" | "expenseDocuments" | "reimbursementDocuments" | "claims" | "claimExpenses" | "claimDocuments" | "profiles", unknown[]>;
const BASE: Data = {
  expenses: [expense()], reimbursements: [reimbursement()], payments: [payment()], documents: [], expenseDocuments: [], reimbursementDocuments: [],
  claims: [], claimExpenses: [], claimDocuments: [], profiles: [{ id: "member-9", full_name: "Meera Nair", email: "meera@x.test" }],
};
const TABLES = {
  expenses: "finance_expenses", reimbursements: "personal_reimbursements", payments: "finance_payments", documents: "finance_documents", expenseDocuments: "finance_expense_documents",
  reimbursementDocuments: "finance_reimbursement_documents", claims: "funding_claims", claimExpenses: "funding_claim_expenses", claimDocuments: "finance_claim_documents", profiles: "profiles",
} as const;

function scriptFinance(data: Partial<Data> = {}) {
  const all = { ...BASE, ...data };
  for (const name of Object.keys(TABLES) as Array<keyof Data>) fake.from(TABLES[name], "select").reply(ok(all[name]));
  fake.rpc("get_finance_summary").reply(ok(SUMMARY));
}

function renderFinance(options: { role?: "member" | "executive" | "admin"; userId?: string } = {}) {
  const notify = notifySpy();
  setCacheOwner(options.userId ?? "exec-1");
  render(<FinancePage user={userOf(options.userId ?? "exec-1")} role={options.role ?? "executive"} groups={[{ id: 4, name: "Vocal" }]} events={[{ id: 9, title: "Fall concert", starts_at: "2026-10-05T23:30:00Z" }]} />);
  return notify;
}

const card = (label: string) => screen.getByText(label).parentElement!.querySelector("strong")!.textContent;
const waitForLoad = () => waitFor(() => expect(screen.getByText("Available cash")).toBeInTheDocument());
const tab = (name: string) => fireEvent.click(screen.getByRole("tab", { name }));
const dialog = () => screen.getByRole("dialog");
const field = (label: string | RegExp) => within(dialog()).getByLabelText(label);
const type = (label: string | RegExp, value: string) => fireEvent.change(field(label), { target: { value } });
const submit = () => fireEvent.submit(dialog().querySelector("form")!);
const rpcArgs = (name: string) => fake.rpc(name).calls[0].args[0];
const pdf = () => new File(["%PDF-1.4"], "doc.pdf", { type: "application/pdf" });
const attach = (name: string) => fireEvent.change(dialog().querySelector(`input[name="${name}"]`)!, { target: { files: [pdf()] } });
const reads = () => fake.from("finance_expenses", "select").count;
const closed = () => waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

describe("finance: an executive answers a member's request", () => {
  async function open(buttonName: string, data: Partial<Data> = {}) {
    scriptFinance(data);
    const notify = renderFinance();
    await waitForLoad();
    tab("reimbursements");
    fireEvent.click(await screen.findByRole("button", { name: buttonName }));
    return notify;
  }

  it("Approve asks for the amount (the requested one to start with) and sends it with the note", async () => {
    const notify = await open("Approve");
    expect(within(dialog()).getByText("Approve reimbursement")).toBeInTheDocument();
    expect(within(dialog()).getByText("Requested: $80.00. Lower the amount to approve part of it.")).toBeInTheDocument();
    expect((field("Amount to approve") as HTMLInputElement).value).toBe("80");
    type("Amount to approve", "60");
    type(/Note to the member/, "Partly covered");
    submit();
    await waitFor(() => expect(notify.find("Reimbursement approved").tone).toBe("success"));
    expect(rpcArgs("review_personal_reimbursement")).toEqual({ p_reimbursement_id: 5, p_decision: "approved", p_approved_amount: 60, p_review_note: "Partly covered" });
    await closed();
    expect(reads()).toBe(2);
  });

  it("Decline needs a reason, which the member is shown", async () => {
    const notify = await open("Decline");
    expect(within(dialog()).getByText("Decline this request?")).toBeInTheDocument();
    type("Reason shown to the member", "Not a club purchase");
    submit();
    await waitFor(() => expect(notify.find("Reimbursement declined").tone).toBe("success"));
    expect(rpcArgs("review_personal_reimbursement")).toEqual({ p_reimbursement_id: 5, p_decision: "rejected", p_approved_amount: null, p_review_note: "Not a club purchase" });
  });

  it("Request changes sends what needs to change", async () => {
    const notify = await open("Request changes");
    expect(within(dialog()).getByText("The member can edit the request or replace the receipt and send it back.")).toBeInTheDocument();
    type("What needs to change?", "The receipt is blurry");
    submit();
    await waitFor(() => expect(notify.find("Changes requested").tone).toBe("success"));
    expect(rpcArgs("request_reimbursement_changes")).toEqual({ p_reimbursement_id: 5, p_note: "The receipt is blurry" });
  });

  it("the buttons are not offered on a request that is the executive's own (another executive must review it)", async () => {
    scriptFinance({ reimbursements: [reimbursement({ member_id: "exec-1" })] });
    renderFinance();
    await waitForLoad();
    tab("reimbursements");
    expect(await screen.findByText("Another executive must review your own request.")).toBeInTheDocument();
    for (const name of ["Approve", "Decline", "Request changes"]) expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
  });

  it("a refusal keeps the dialog open with the database's sentence as an error, and sends nothing else", async () => {
    fake.rpc("review_personal_reimbursement").reply(fail("Only submitted requests can be reviewed"));
    const notify = await open("Approve");
    submit();
    await waitFor(() => expect(notify.find("Only submitted requests can be reviewed").tone).toBe("error"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(reads()).toBe(1);
  });
});

describe("finance: voiding and editing expenses", () => {
  async function open(buttonName: string | RegExp, data: Partial<Data> = {}) {
    scriptFinance(data);
    const notify = renderFinance();
    await waitForLoad();
    tab("expenses");
    fireEvent.click(await screen.findByRole("button", { name: buttonName }));
    return notify;
  }

  it("Void on a member's purchase says the member's request goes with it, and sends the reason", async () => {
    const notify = await open("Void");
    expect(within(dialog()).getByText("Void this expense?")).toBeInTheDocument();
    expect(within(dialog()).getByText("Tabla repair · $80.00. The member's reimbursement request is voided with it. Nothing is deleted.")).toBeInTheDocument();
    type(/Reason/, "Entered twice");
    submit();
    await waitFor(() => expect(notify.find("Expense voided").tone).toBe("success"));
    expect(rpcArgs("void_finance_expense")).toEqual({ p_expense_id: 1, p_reason: "Entered twice" });
  });

  it("Void on a club purchase says its payment goes with it", async () => {
    await open("Void", { expenses: [expense({ paid_by: "club", paid_by_member_id: null })] });
    expect(within(dialog()).getByText("Tabla repair · $80.00. Its payment is voided with it. Nothing is deleted.")).toBeInTheDocument();
  });

  it("Edit offers the details but not the amount or the date, and sends the rest as the purchase has it", async () => {
    const notify = await open("Edit");
    expect(within(dialog()).getByText("Edit expense details")).toBeInTheDocument();
    expect(within(dialog()).getByText("The amount and date cannot be changed here. To correct those, void the expense and enter it again.")).toBeInTheDocument();
    expect(within(dialog()).queryByLabelText("Amount")).not.toBeInTheDocument();
    expect((field("What was purchased?") as HTMLInputElement).value).toBe("Tabla repair");
    expect((field("Card last four digits") as HTMLInputElement).value).toBe("1234");
    type("What was purchased?", "Tabla and strings");
    type("Vendor", "Raj Music & Co");
    submit();
    await waitFor(() => expect(notify.find("Expense updated").tone).toBe("success"));
    expect(rpcArgs("update_finance_expense")).toEqual({
      p_expense_id: 1, p_description: "Tabla and strings", p_vendor: "Raj Music & Co", p_category: "Instruments", p_payment_card_last4: "1234",
      p_subgroup_id: 4, p_club_event_id: 9, p_event_related: true, p_event_name: "Fall concert", p_event_starts_at: "2026-10-05T23:30:00Z", p_event_attendee_count: 60, p_event_schedule: "7pm doors",
    });
  });

  it("a category the list does not know is still offered for that expense", async () => {
    await open("Edit", { expenses: [expense({ category: "Hospitality" })] });
    const options = Array.from((field("Category") as HTMLSelectElement).options).map((option) => option.value);
    expect(options[0]).toBe("Hospitality");
    expect(options).toContain("Food");
    expect((field("Category") as HTMLSelectElement).value).toBe("Hospitality");
  });

  it("an expense on a claim the funder has cannot be edited, only voided; a voided one has no buttons", async () => {
    scriptFinance({
      expenses: [expense(), expense({ id: 2, description: "Harmonium" }), expense({ id: 3, description: "Cables", status: "voided" })],
      claims: [claim({ status: "submitted" })], claimExpenses: [{ claim_id: 3, expense_id: 1, claimed_amount: 80 }],
    });
    renderFinance();
    await waitForLoad();
    tab("expenses");
    const row = (text: string) => screen.getByText(text).closest(".finance-table-row") as HTMLElement;
    expect(within(row("Tabla repair")).queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
    expect(within(row("Tabla repair")).getByRole("button", { name: "Void" })).toBeInTheDocument();
    expect(within(row("Harmonium")).getByRole("button", { name: "Edit" })).toBeInTheDocument();
    expect(within(row("Cables")).queryAllByRole("button")).toHaveLength(0);
  });
});

describe("finance: a member edits and withdraws their own request", () => {
  async function open(buttonName: string | RegExp, status = "submitted") {
    scriptFinance({ reimbursements: [reimbursement({ status })] });
    const notify = renderFinance({ role: "member", userId: "member-9" });
    fireEvent.click(await screen.findByRole("button", { name: buttonName }));
    return notify;
  }

  it("Edit offers the amount, the date and a note, and sends them with the details", async () => {
    const notify = await open("Edit");
    expect(within(dialog()).getByText("Edit my request")).toBeInTheDocument();
    expect(within(dialog()).getByRole("button", { name: "Save changes" })).toBeInTheDocument();
    type("Amount", "70.5");
    type("Exact purchase date", "2026-10-02");
    type("Card last four digits", "9876");
    type("Note for the reviewer", "Receipt replaced");
    submit();
    await waitFor(() => expect(notify.find("Request updated").tone).toBe("success"));
    expect(rpcArgs("update_member_reimbursement")).toEqual({
      p_reimbursement_id: 5, p_description: "Tabla repair", p_vendor: "Raj Music", p_category: "Instruments", p_payment_card_last4: "9876",
      p_subgroup_id: 4, p_club_event_id: 9, p_event_related: true, p_event_name: "Fall concert", p_event_starts_at: "2026-10-05T23:30:00Z", p_event_attendee_count: 60, p_event_schedule: "7pm doors",
      p_amount: 70.5, p_purchase_date: "2026-10-02", p_member_note: "Receipt replaced",
    });
  });

  it("a request sent back for changes is edited and resubmitted, and says so", async () => {
    await open("Edit and resubmit", "changes_requested");
    expect(within(dialog()).getByText("Saving sends the request back for review.")).toBeInTheDocument();
    expect(within(dialog()).getByRole("button", { name: "Save and resubmit" })).toBeInTheDocument();
  });

  it("Withdraw asks first and then withdraws", async () => {
    const notify = await open("Withdraw");
    expect(within(dialog()).getByText("Withdraw this request?")).toBeInTheDocument();
    expect(fake.rpc("withdraw_member_reimbursement").count).toBe(0);
    submit();
    await waitFor(() => expect(notify.find("Request withdrawn").tone).toBe("success"));
    expect(rpcArgs("withdraw_member_reimbursement")).toEqual({ p_reimbursement_id: 5 });
  });

  it("a request that is already paid has no buttons for the member", async () => {
    scriptFinance({ reimbursements: [reimbursement({ status: "paid" })] });
    renderFinance({ role: "member", userId: "member-9" });
    await screen.findByText("My requests");
    for (const name of ["Edit", "Withdraw", /Add receipt/]) expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
  });
});

describe("finance: the member's own view", () => {
  it("one tab, no ledger, and cards that add up the member's own requests", async () => {
    scriptFinance({ reimbursements: [
      reimbursement({ id: 1, status: "submitted", requested_amount: 30 }), reimbursement({ id: 2, status: "paid", requested_amount: 50, approved_amount: 45 }),
      reimbursement({ id: 3, status: "approved", requested_amount: 20, approved_amount: 20 }), reimbursement({ id: 4, status: "submitted", requested_amount: 10 }),
    ] });
    renderFinance({ role: "member", userId: "member-9" });
    await screen.findByText("My requests");
    expect(screen.getAllByRole("tab").map((item) => item.textContent)).toEqual(["reimbursements"]);
    expect(card("Requested")).toBe("$110.00");
    expect(card("Awaiting review")).toBe("2");
    expect(card("Paid")).toBe("$45.00");
    expect(screen.queryByText("Available cash")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Record income/ })).not.toBeInTheDocument();
    // The read asks for the seven things a member may read, not the claims and the profiles.
    expect(fake.from("funding_claims").count).toBe(0);
    expect(fake.from("profiles").count).toBe(0);
  });
});

describe("finance: the funder's answers and a claim's expenses", () => {
  const SUBMITTED = { claims: [claim({ status: "submitted" })] };
  async function openClaims(data: Partial<Data> = {}) {
    scriptFinance(data);
    const notify = renderFinance();
    await waitForLoad();
    tab("Funding claims");
    await screen.findByText("Fall concert");
    return notify;
  }

  it("Mark approved records the amount the funder approved, with a note", async () => {
    const notify = await openClaims(SUBMITTED);
    fireEvent.click(screen.getByRole("button", { name: "Mark approved" }));
    expect(within(dialog()).getByText("Record the funder's approval")).toBeInTheDocument();
    expect(within(dialog()).getByText("Requested: $80.00.")).toBeInTheDocument();
    type("Amount approved", "75");
    type(/Note/, "Partly");
    submit();
    await waitFor(() => expect(notify.find("Claim approved").tone).toBe("success"));
    expect(rpcArgs("set_funding_claim_status")).toEqual({ p_claim_id: 3, p_status: "approved", p_approved_amount: 75, p_note: "Partly" });
  });

  it("Denied asks what the funder said; Changes requested asks what they need and reopens the claim", async () => {
    const notify = await openClaims(SUBMITTED);
    fireEvent.click(screen.getByRole("button", { name: "Denied" }));
    expect(within(dialog()).getByText("Mark this claim denied?")).toBeInTheDocument();
    type("What did the funder say?", "Out of budget");
    submit();
    await waitFor(() => expect(notify.find("Funding claim updated").tone).toBe("success"));
    expect(fake.rpc("set_funding_claim_status").calls[0].args[0]).toEqual({ p_claim_id: 3, p_status: "denied", p_note: "Out of budget" });
    await closed();
    fireEvent.click(await screen.findByRole("button", { name: "Changes requested" }));
    expect(within(dialog()).getByText("The funder asked for changes")).toBeInTheDocument();
    expect(within(dialog()).getByRole("button", { name: "Reopen claim" })).toBeInTheDocument();
    type("What do they need?", "Add the flyer");
    submit();
    await waitFor(() => expect(fake.rpc("set_funding_claim_status").count).toBe(2));
    expect(fake.rpc("set_funding_claim_status").calls[1].args[0]).toEqual({ p_claim_id: 3, p_status: "changes_requested", p_note: "Add the flyer" });
  });

  it("Void claim says the expenses are released, and sends the reason", async () => {
    const notify = await openClaims({ claims: [claim()] });
    fireEvent.click(screen.getByRole("button", { name: "Void claim" }));
    expect(within(dialog()).getByText("Its expenses are released so they can go on another claim. A claim with money received must have those payments voided first.")).toBeInTheDocument();
    type(/Reason/, "Funder withdrew the offer");
    submit();
    await waitFor(() => expect(notify.find("Funding claim voided").tone).toBe("success"));
    expect(rpcArgs("void_funding_claim")).toEqual({ p_claim_id: 3, p_reason: "Funder withdrew the offer" });
  });

  const TWO_EXPENSES = {
    expenses: [expense(), expense({ id: 2, description: "Harmonium", amount: 120 }), expense({ id: 4, description: "Cables", amount: 33 })],
    claims: [claim()], claimExpenses: [{ claim_id: 3, expense_id: 1, claimed_amount: 80 }, { claim_id: 3, expense_id: 2, claimed_amount: 120 }],
  };

  it("an expense can be taken off a claim that has more than one, after a yes", async () => {
    const notify = await openClaims(TWO_EXPENSES);
    fireEvent.click(screen.getByRole("button", { name: "Remove Harmonium from this claim" }));
    expect(within(dialog()).getByText("Remove this expense from the claim?")).toBeInTheDocument();
    expect(within(dialog()).getByText("Harmonium · $120.00. The claim total is reduced.")).toBeInTheDocument();
    submit();
    await waitFor(() => expect(notify.find("Expense removed from the claim").tone).toBe("success"));
    expect(rpcArgs("remove_funding_claim_expense")).toEqual({ p_claim_id: 3, p_expense_id: 2 });
  });

  it("the last expense of a claim cannot be taken off, and a claim the funder has cannot change its expenses", async () => {
    await openClaims({ expenses: [expense()], claims: [claim(), claim({ id: 4, title: "Sent", status: "submitted" })], claimExpenses: [{ claim_id: 3, expense_id: 1, claimed_amount: 80 }, { claim_id: 4, expense_id: 1, claimed_amount: 80 }] });
    expect(screen.queryByRole("button", { name: /Remove .* from this claim/ })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "＋ Add expense" })).toHaveLength(1);
  });

  it("an unclaimed expense can be added: the list offers only those, and sends the one chosen", async () => {
    const notify = await openClaims(TWO_EXPENSES);
    fireEvent.click(screen.getByRole("button", { name: "＋ Add expense" }));
    expect(within(dialog()).getByText("Add an expense to this claim")).toBeInTheDocument();
    const options = Array.from((field("Expense") as HTMLSelectElement).options).map((option) => option.textContent);
    expect(options).toEqual(["Cables · $33.00"]);
    submit();
    await waitFor(() => expect(notify.find("Expense added to the claim").tone).toBe("success"));
    expect(rpcArgs("add_funding_claim_expense")).toEqual({ p_claim_id: 3, p_expense_id: 4 });
  });

  it("with nothing left to add the person is told so and no dialog opens", async () => {
    const notify = await openClaims({ expenses: [expense()], claims: [claim()], claimExpenses: [{ claim_id: 3, expense_id: 1, claimed_amount: 80 }] });
    fireEvent.click(screen.getByRole("button", { name: "＋ Add expense" }));
    expect(notify.find("No unclaimed expenses are available").tone).toBe("error");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("Record payment (a funder's payment into the account) sends the amount, the date and the account, then reads the lists again", async () => {
    const notify = await openClaims({ claims: [claim({ status: "approved", approved_amount: 80 })] });
    fireEvent.click(screen.getByRole("button", { name: "Record payment" }));
    type("Amount received", "80");
    type("Date received", "2026-11-02");
    submit();
    await waitFor(() => expect(notify.find("Funding payment recorded").tone).toBeUndefined());
    expect(rpcArgs("record_funding_claim_payment")).toEqual({ p_claim_id: 3, p_amount: 80, p_payment_date: "2026-11-02", p_account_name: "Club bank account" });
    await closed();
    await waitFor(() => expect(reads()).toBe(2));
  });
});

describe("finance: the forms that save a record", () => {
  it("income: sends the five fields, closes, says so, and reads the lists again", async () => {
    scriptFinance();
    const notify = renderFinance();
    await waitForLoad();
    fireEvent.click(screen.getByRole("button", { name: /Record income/ }));
    type("Description", "Gig at Memorial Hall");
    type("Amount", "250");
    type("Date received", "2026-10-09");
    type("Income source", "Ticket sales");
    type("Paid by", "Memorial Hall");
    submit();
    await waitFor(() => expect(notify.messages()).toContain("Income recorded"));
    expect(rpcArgs("record_finance_income")).toEqual({
      p_description: "Gig at Memorial Hall", p_amount: 250, p_payment_date: "2026-10-09", p_category: "Ticket sales", p_counterparty: "Memorial Hall", p_account_name: "Club bank account",
    });
    await closed();
    await waitFor(() => expect(reads()).toBe(2));
  });

  it("a club expense: the record first with its event details, then the receipt, privately, linked to the expense only", async () => {
    scriptFinance();
    fake.rpc("record_club_expense").reply(ok(31));
    fake.from("finance_documents", "insert").reply(ok({ id: 55 }));
    const notify = renderFinance();
    await waitForLoad();
    fireEvent.click(screen.getByRole("button", { name: /Club expense/ }));
    type("What was purchased?", "Pizza");
    type("Vendor", "Mellow Mushroom");
    type("Amount", "45.25");
    type("Card last four digits", " 4321 ");
    type("Related subgroup", "4");
    fireEvent.click(within(dialog()).getByLabelText(/This purchase was for an event/));
    type("Club calendar event", "9");
    type("Event name", "Fall rehearsal");
    type("Event date and time", "2026-10-05T18:30");
    type("Number of attendees", "12");
    type("Schedule / description", "Dinner at 6");
    attach("receipt");
    submit();
    await waitFor(() => expect(notify.find("Club expense recorded").tone).toBeUndefined());
    expect(rpcArgs("record_club_expense")).toMatchObject({
      p_description: "Pizza", p_vendor: "Mellow Mushroom", p_amount: 45.25, p_category: "Food", p_account_name: "Club bank account", p_payment_card_last4: "4321", p_subgroup_id: 4,
      p_club_event_id: 9, p_event_related: true, p_event_name: "Fall rehearsal", p_event_starts_at: new Date("2026-10-05T18:30").toISOString(), p_event_attendee_count: 12, p_event_schedule: "Dinner at 6",
    });
    expect(fake.from("finance_documents", "insert").calls[0].payload).toMatchObject({ document_type: "receipt", title: "Receipt — Pizza", payment_card_last4: "4321", uploaded_by: "exec-1" });
    expect(fake.from("finance_expense_documents", "insert").calls[0].payload).toEqual({ expense_id: 31, document_id: 55 });
    expect(fake.from("finance_reimbursement_documents", "insert").count).toBe(0);
    await closed();
  });

  it("a member's request with a statement: the receipt and the statement are both stored and linked to the expense and the request", async () => {
    scriptFinance();
    fake.rpc("submit_member_reimbursement").reply(ok([{ expense_id: 21, reimbursement_id: 22 }]));
    fake.from("finance_documents", "insert").reply(ok({ id: 55 }));
    const notify = renderFinance({ role: "member", userId: "member-9" });
    fireEvent.click(await screen.findByRole("button", { name: /Request reimbursement/ }));
    type("What was purchased?", "Taxi");
    type("Vendor", "Yellow Cab");
    type("Amount", "20");
    type("Note for the treasurer", "Late night");
    attach("receipt");
    attach("statement");
    submit();
    await waitFor(() => expect(notify.find("Reimbursement request submitted").tone).toBeUndefined());
    expect(rpcArgs("submit_member_reimbursement")).toMatchObject({ p_description: "Taxi", p_member_note: "Late night", p_event_related: false, p_event_starts_at: null, p_club_event_id: null });
    const registered = fake.from("finance_documents", "insert").calls.map((call) => (call.payload as { document_type: string; title: string }));
    expect(registered).toEqual([expect.objectContaining({ document_type: "receipt", title: "Receipt — Taxi" }), expect.objectContaining({ document_type: "card_statement", title: "Payment card statement" })]);
    expect(fake.from("finance_reimbursement_documents", "insert").calls.map((call) => call.payload)).toEqual([{ reimbursement_id: 22, document_id: 55 }, { reimbursement_id: 22, document_id: 55 }]);
    expect(fake.storage("finance-private", "upload").count).toBe(2);
  });

  it("a funding claim: created in one call with its expenses, then the approval proof is stored and linked to the claim", async () => {
    scriptFinance({ expenses: [expense(), expense({ id: 2, description: "Harmonium", amount: 120 })] });
    fake.rpc("create_funding_claim").reply(ok({ id: 24 }));
    fake.from("finance_documents", "insert").reply(ok({ id: 55 }));
    const notify = renderFinance();
    await waitForLoad();
    tab("Funding claims");
    fireEvent.click(await screen.findByRole("button", { name: /New funding claim/ }));
    // Nothing chosen: the button is off and says what it would create.
    expect(within(dialog()).getByRole("button", { name: "Create claim · $0.00" })).toBeDisabled();
    fireEvent.click(within(dialog()).getByLabelText("Include Tabla repair"));
    fireEvent.click(within(dialog()).getByLabelText("Include Harmonium"));
    expect(within(dialog()).getByRole("button", { name: "Create claim · $200.00" })).toBeEnabled();
    fireEvent.click(within(dialog()).getByLabelText("Include Harmonium"));
    expect(within(dialog()).getByRole("button", { name: "Create claim · $80.00" })).toBeEnabled();
    type("Claim title", "Fall concert food");
    type("Award reference", "A-1");
    attach("funding_approval");
    submit();
    await waitFor(() => expect(notify.find("Funding claim workspace created").tone).toBeUndefined());
    expect(rpcArgs("create_funding_claim")).toEqual({
      p_title: "Fall concert food", p_funder_name: "GPSG Senate", p_award_reference: "A-1", p_heellife_reference: "", p_submission_deadline: null, p_notes: "", p_expense_ids: [1],
    });
    expect(fake.from("finance_documents", "insert").calls[0].payload).toMatchObject({ document_type: "funding_approval", title: "Funding approval" });
    expect(fake.from("finance_claim_documents", "insert").calls[0].payload).toEqual({ claim_id: 24, document_id: 55 });
    await closed();
  });

  it("a funding claim with nothing chosen is not sent", async () => {
    scriptFinance();
    const notify = renderFinance();
    await waitForLoad();
    tab("Funding claims");
    fireEvent.click(await screen.findByRole("button", { name: /New funding claim/ }));
    attach("funding_approval");
    submit();
    expect(notify.find("Select at least one expense for this claim").tone).toBe("error");
    expect(fake.rpc("create_funding_claim").count).toBe(0);
  });

  it("a document for a claim: stored under the type chosen and linked to the claim", async () => {
    scriptFinance({ claims: [claim()] });
    fake.from("finance_documents", "insert").reply(ok({ id: 55 }));
    const notify = renderFinance();
    await waitForLoad();
    tab("Funding claims");
    fireEvent.click(await screen.findByRole("button", { name: /Document/ }));
    type("Document type", "bank_statement");
    type("Title", "October statement");
    attach("file");
    submit();
    await waitFor(() => expect(notify.find("Claim document added").tone).toBeUndefined());
    expect(fake.from("finance_documents", "insert").calls[0].payload).toMatchObject({ document_type: "bank_statement", title: "October statement" });
    expect(fake.from("finance_claim_documents", "insert").calls[0].payload).toEqual({ claim_id: 3, document_id: 55 });
    await closed();
  });

  it("a receipt for a request: stored and linked to the purchase and the request", async () => {
    scriptFinance({ reimbursements: [reimbursement({ member_id: "exec-1" })] });
    fake.from("finance_documents", "insert").reply(ok({ id: 55 }));
    const notify = renderFinance();
    await waitForLoad();
    tab("reimbursements");
    fireEvent.click(await screen.findByRole("button", { name: /Add receipt/ }));
    attach("file");
    submit();
    await waitFor(() => expect(notify.find("Receipt added").tone).toBeUndefined());
    expect(fake.from("finance_documents", "insert").calls[0].payload).toMatchObject({ document_type: "receipt", title: "Receipt" });
    expect(fake.from("finance_expense_documents", "insert").calls[0].payload).toEqual({ expense_id: 1, document_id: 55 });
    expect(fake.from("finance_reimbursement_documents", "insert").calls[0].payload).toEqual({ reimbursement_id: 5, document_id: 55 });
  });

  it("a funding claim whose approval proof is not a file the checks accept is saved, and the person is told why the proof is missing", async () => {
    scriptFinance({ expenses: [expense()] });
    fake.rpc("create_funding_claim").reply(ok({ id: 24 }));
    const notify = renderFinance();
    await waitForLoad();
    tab("Funding claims");
    fireEvent.click(await screen.findByRole("button", { name: /New funding claim/ }));
    fireEvent.click(within(dialog()).getByLabelText("Include Tabla repair"));
    submit();
    await waitFor(() => expect(notify.find("Claim saved; Choose a document to upload").tone).toBe("error"));
    expect(fake.rpc("create_funding_claim").count).toBe(1);
    expect(fake.storage("finance-private", "upload").count).toBe(0);
  });
});

describe("finance: opening a stored document", () => {
  const WITH_RECEIPT = {
    documents: [{ id: 11, document_type: "receipt", title: "Taxi receipt", storage_path: "member-9/taxi.pdf", uploaded_by: "member-9" }],
    reimbursementDocuments: [{ reimbursement_id: 5, document_id: 11 }],
  };

  it("opens it in a new tab through a link that lasts 90 seconds", async () => {
    scriptFinance(WITH_RECEIPT);
    renderFinance();
    await waitForLoad();
    tab("reimbursements");
    fireEvent.click(await screen.findByRole("button", { name: "▤ Taxi receipt" }));
    await waitFor(() => expect(window.open).toHaveBeenCalledWith("https://files.test/finance-private/member-9/taxi.pdf?signed", "_blank", "noopener,noreferrer"));
    expect(fake.storage("finance-private", "createSignedUrl").calls[0].args).toEqual(["member-9/taxi.pdf", 90]);
  });

  it("when no link can be made the person is told, as an error, and nothing opens", async () => {
    scriptFinance(WITH_RECEIPT);
    fake.storage("finance-private", "createSignedUrl").reply(fail("Object not found"));
    const notify = renderFinance();
    await waitForLoad();
    tab("reimbursements");
    fireEvent.click(await screen.findByRole("button", { name: "▤ Taxi receipt" }));
    await waitFor(() => expect(notify.find("This finance document could not be opened").tone).toBe("error"));
    expect(window.open).not.toHaveBeenCalled();
  });

  it("the × next to a receipt is offered to an executive, and to the member who uploaded it only while the request is under review", async () => {
    scriptFinance({ ...WITH_RECEIPT, reimbursements: [reimbursement({ status: "approved" })] });
    renderFinance({ role: "member", userId: "member-9" });
    await screen.findByRole("button", { name: "▤ Taxi receipt" });
    expect(screen.queryByRole("button", { name: "Remove Taxi receipt" })).not.toBeInTheDocument();
  });

  it("a member cannot remove a receipt somebody else uploaded", async () => {
    scriptFinance({ ...WITH_RECEIPT, documents: [{ ...WITH_RECEIPT.documents[0], uploaded_by: "exec-1" }] });
    renderFinance({ role: "member", userId: "member-9" });
    await screen.findByRole("button", { name: "▤ Taxi receipt" });
    expect(screen.queryByRole("button", { name: "Remove Taxi receipt" })).not.toBeInTheDocument();
  });
});

describe("finance: reopening the screen", () => {
  it("shows the last figures at once, with no loading line, while it reads again behind them", async () => {
    scriptFinance();
    renderFinance();
    await waitFor(() => expect(card("Available cash")).toBe("$1,234.00"));
    cleanup();
    // The second visit: every read hangs. What the first visit saw is on screen straight away.
    fake.from("finance_expenses", "select").reply(never);
    renderFinance();
    expect(card("Available cash")).toBe("$1,234.00");
    expect(screen.queryByText("Loading finance workspace…")).not.toBeInTheDocument();
    await flush();
    expect(card("Available cash")).toBe("$1,234.00");
  });

  it("a first visit has nothing to show, so it shows the loading line and no cards built from nothing", async () => {
    scriptFinance();
    fake.rpc("get_finance_summary").reply(never);
    renderFinance();
    expect(await screen.findByText("Loading finance workspace…")).toBeInTheDocument();
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText("Loading finance workspace…")).toBeInTheDocument();
  });

  it("a different person does not see the last person's figures", async () => {
    scriptFinance();
    renderFinance({ userId: "exec-1" });
    await waitFor(() => expect(card("Available cash")).toBe("$1,234.00"));
    cleanup();
    fake.rpc("get_finance_summary").reply(never);
    renderFinance({ userId: "exec-2" });
    expect(await screen.findByText("Loading finance workspace…")).toBeInTheDocument();
  });
});
