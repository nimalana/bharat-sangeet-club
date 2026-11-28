// Phase 3.4 on the Finance screen: the tabs follow the tabs pattern, no serious axe violation on any tab or dialog, a button that starts a
// correction is off while a change runs, and the two jobs of the screen can be done with the keyboard alone: a member submits a
// reimbursement with a receipt, and an executive approves it.
//
// axe cannot compute colour contrast in jsdom (tests/support/a11y.ts says so): the contrast of the finance colours is NOT verified here.
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { expectNoSeriousViolations } from "../support/a11y";
import { focusedName, keyboardUser, tabOrder } from "../support/keyboard";
import { fail, fake, never, ok } from "../support/fake-supabase";
import { claim, dialog, expense, openTab, payment, pdf, reimbursement, renderFinance, scriptFinance, waitForLoad, waitForMemberLoad, type Data } from "./finance-fixtures";
import { routeUploads } from "./finance-xhr";

beforeEach(() => { routeUploads(); });

const closed = () => waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
const submitDialog = () => fireEvent.submit(dialog().querySelector("form")!);

// One of everything the screen can show: requests in every status (one of them the executive's own), a club purchase, a voided one, documents, two claims.
const RICH: Partial<Data> = {
  expenses: [
    expense({ id: 1 }),
    expense({ id: 2, description: "Harmonium strap", status: "submitted", paid_by_member_id: "member-9" }),
    expense({ id: 3, description: "Mic cables", paid_by: "club", paid_by_member_id: null, status: "approved", payment_card_last4: "9876" }),
    expense({ id: 4, description: "Poster print", status: "rejected" }),
    expense({ id: 5, description: "Old invoice", status: "voided", voided_by: "exec-2", voided_at: "2026-10-04T15:00:00Z", void_reason: "Entered twice" }),
    expense({ id: 6, description: "Tanpura strings", status: "submitted", paid_by_member_id: "exec-1", created_by: "exec-1" }),
  ],
  reimbursements: [
    reimbursement({ id: 5, expense_id: 1, status: "approved" }),
    reimbursement({ id: 6, expense_id: 2, status: "submitted" }),
    reimbursement({ id: 7, expense_id: 4, status: "rejected", review_note: "Not a club purchase" }),
    reimbursement({ id: 8, expense_id: 5, status: "voided", void_reason: "Entered twice" }),
    reimbursement({ id: 9, expense_id: 6, member_id: "exec-1", status: "submitted" }),
  ],
  payments: [
    payment({ id: 7, status: "posted" }),
    payment({ id: 8, direction: "inflow", purpose: "income", description: "Gig at Memorial Hall", category: "Gig revenue", account_name: "Club bank account", counterparty: "Memorial Hall", reimbursement_id: null, expense_id: null }),
  ],
  documents: [{ id: 20, document_type: "receipt", title: "Harmonium receipt", storage_path: "member-9/harmonium.pdf", uploaded_by: "member-9" }],
  reimbursementDocuments: [{ reimbursement_id: 6, document_id: 20 }],
  claims: [claim({ id: 3, status: "draft" }), claim({ id: 4, title: "Spring showcase", status: "submitted" }), claim({ id: 5, title: "Winter gala", status: "approved", approved_amount: 80 })],
  claimDocuments: [{ claim_id: 3, document_id: 20 }],
  claimExpenses: [{ claim_id: 3, expense_id: 1, claimed_amount: 80 }, { claim_id: 3, expense_id: 3, claimed_amount: 40 }, { claim_id: 4, expense_id: 2, claimed_amount: 40 }],
};

describe("finance: the tabs", () => {
  it("are the tabs pattern: one tab stop, arrow keys, Home and End open the tab they land on, and the open tab names its panel", async () => {
    scriptFinance(RICH);
    renderFinance();
    await waitForLoad();
    const names = ["overview", "expenses", "reimbursements", "Funding claims"];
    const tabs = () => names.map((name) => screen.getByRole("tab", { name }));
    expect(screen.getByRole("tablist", { name: "Finance sections" })).toBeInTheDocument();
    expect(tabs().map((tab) => tab.getAttribute("tabindex"))).toEqual(["0", "-1", "-1", "-1"]);
    expect(tabs()[0]).toHaveAttribute("aria-controls", screen.getByRole("tabpanel").id);
    expect(screen.getByRole("tabpanel")).toHaveAccessibleName("overview");

    const user = keyboardUser();
    tabs()[0].focus();
    await user.keyboard("{ArrowRight}");
    await waitFor(() => expect(screen.getByRole("tab", { name: "expenses" })).toHaveAttribute("aria-selected", "true"));
    expect(screen.getByRole("tab", { name: "expenses" })).toHaveFocus();
    expect(screen.getByRole("tabpanel")).toHaveAccessibleName("expenses");
    expect(screen.getByText("Expense register")).toBeInTheDocument();
    expect(tabs().map((tab) => tab.getAttribute("tabindex"))).toEqual(["-1", "0", "-1", "-1"]);

    await user.keyboard("{End}");
    await waitFor(() => expect(screen.getByRole("tab", { name: "Funding claims" })).toHaveAttribute("aria-selected", "true"));
    expect(screen.getByRole("tab", { name: "Funding claims" })).toHaveFocus();
    await user.keyboard("{ArrowRight}");   // after the last comes the first
    await waitFor(() => expect(screen.getByRole("tab", { name: "overview" })).toHaveAttribute("aria-selected", "true"));
    expect(screen.getByRole("tab", { name: "overview" })).toHaveFocus();
    await user.keyboard("{ArrowLeft}");   // before the first comes the last
    await waitFor(() => expect(screen.getByRole("tab", { name: "Funding claims" })).toHaveAttribute("aria-selected", "true"));
    await user.keyboard("{Home}");
    await waitFor(() => expect(screen.getByRole("tab", { name: "overview" })).toHaveAttribute("aria-selected", "true"));
    // Tab leaves the tab list for the panel: only the open tab was a tab stop.
    await user.tab();
    expect(screen.getByRole("tabpanel")).toContainElement(document.activeElement as HTMLElement);
  });

  it("a member has the one tab, with its panel", async () => {
    scriptFinance(RICH);
    renderFinance({ role: "member", userId: "member-9" });
    await waitForMemberLoad();
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["reimbursements"]);
    expect(screen.getByRole("tabpanel")).toHaveAccessibleName("reimbursements");
  });
});

describe("finance: no serious accessibility violation (colour contrast is not computed in jsdom)", () => {
  it("every tab of an executive's screen, with a request in every status", async () => {
    scriptFinance(RICH);
    const { view } = renderFinance();
    await waitForLoad();
    for (const name of ["overview", "expenses", "reimbursements", "Funding claims"]) {
      await openTab(name);
      await expectNoSeriousViolations(view.baseElement);
    }
  });

  it("every tab of an executive's screen with nothing in it, and a member's screen with and without requests", async () => {
    scriptFinance({ expenses: [], reimbursements: [], payments: [], claims: [] });
    const first = renderFinance();
    await waitForLoad();
    for (const name of ["overview", "expenses", "reimbursements", "Funding claims"]) {
      await openTab(name);
      await expectNoSeriousViolations(first.view.baseElement);
    }
    first.view.unmount();

    scriptFinance(RICH);
    const member = renderFinance({ role: "member", userId: "member-9" });
    await waitForMemberLoad();
    await expectNoSeriousViolations(member.view.baseElement);
  });

  // Each case opens one dialog the way a person does.
  const opens: Array<[string, Partial<Data>, "executive" | "member", (() => Promise<void> | void)]> = [
    ["Record income", {}, "executive", () => { fireEvent.click(screen.getByRole("button", { name: /Record income/ })); }],
    ["Club expense", {}, "executive", () => { fireEvent.click(screen.getByRole("button", { name: /Club expense/ })); }],
    ["Request reimbursement (event purchase)", {}, "member", async () => { fireEvent.click(screen.getByRole("button", { name: /Request reimbursement/ })); fireEvent.click(within(await screen.findByRole("dialog")).getByLabelText(/This purchase was for an event/)); }],
    ["New funding claim", RICH, "executive", async () => { await openTab("Funding claims"); fireEvent.click(screen.getByRole("button", { name: /New funding claim/ })); }],
    ["Add claim document", RICH, "executive", async () => { await openTab("Funding claims"); fireEvent.click(screen.getAllByRole("button", { name: /＋ Document/ })[0]); }],
    ["Record claim payment", RICH, "executive", async () => { await openTab("Funding claims"); fireEvent.click(screen.getByRole("button", { name: "Record payment" })); }],
    ["Add a receipt", RICH, "member", () => { fireEvent.click(screen.getByRole("button", { name: /Add receipt/ })); }],
    ["Approve reimbursement", RICH, "executive", async () => { await openTab("reimbursements"); fireEvent.click(screen.getAllByRole("button", { name: "Approve" })[0]); }],
    ["Void payment (danger)", RICH, "executive", () => { fireEvent.click(screen.getAllByRole("button", { name: /Void payment:/ })[0]); }],
    ["Withdraw request (no fields)", RICH, "member", () => { fireEvent.click(screen.getAllByRole("button", { name: "Withdraw" })[0]); }],
    ["Mark paid (confirm)", RICH, "executive", async () => { await openTab("reimbursements"); fireEvent.click(screen.getByRole("button", { name: "Mark paid" })); }],
    ["Mark submitted (confirm)", { ...RICH, claims: [claim({ id: 3, status: "ready" })] }, "executive", async () => { await openTab("Funding claims"); fireEvent.click(screen.getByRole("button", { name: "Mark submitted" })); }],
  ];
  it.each(opens)("%s", async (_name, data, who, open) => {
    scriptFinance(data);
    const { view } = who === "member" ? renderFinance({ role: "member", userId: "member-9" }) : renderFinance();
    if (who === "member") await waitForMemberLoad(); else await waitForLoad();
    await act(async () => { await open(); });
    await screen.findByRole("dialog");
    await expectNoSeriousViolations(view.baseElement);
  });
});

describe("finance: a button that starts a correction is off while a change is running", () => {
  it("an executive's: after Approve, the buttons of the other requests wait for the lists to be read again, as Void and Mark paid do", async () => {
    scriptFinance({
      expenses: [expense({ id: 1, status: "submitted" }), expense({ id: 2, description: "Harmonium strap", status: "submitted" })],
      reimbursements: [reimbursement({ id: 5, expense_id: 1, status: "submitted" }), reimbursement({ id: 6, expense_id: 2, status: "submitted" })],
    });
    fake.rpc("review_personal_reimbursement").reply(ok(null));
    renderFinance();
    await waitForLoad();
    await openTab("reimbursements");
    fireEvent.click((await screen.findAllByRole("button", { name: "Approve" }))[0]);
    // The lists are read again after the change; that read hangs, so the change is still "running".
    fake.from("finance_expenses", "select").reply(never);
    submitDialog();
    await closed();
    for (const name of ["Approve", "Decline", "Request changes"]) {
      for (const button of screen.getAllByRole("button", { name })) expect(button).toBeDisabled();
    }
  });

  it("a member's: Edit, Withdraw and the remove-receipt button wait while another of their requests is being withdrawn", async () => {
    scriptFinance({
      expenses: [expense({ id: 1, status: "submitted" }), expense({ id: 2, description: "Harmonium strap", status: "submitted" })],
      reimbursements: [reimbursement({ id: 5, expense_id: 1, status: "submitted" }), reimbursement({ id: 6, expense_id: 2, status: "submitted" })],
      documents: [{ id: 20, document_type: "receipt", title: "Harmonium receipt", storage_path: "member-9/h.pdf", uploaded_by: "member-9" }],
      reimbursementDocuments: [{ reimbursement_id: 6, document_id: 20 }],
    });
    fake.rpc("withdraw_member_reimbursement").reply(ok(null));
    renderFinance({ role: "member", userId: "member-9" });
    await waitForMemberLoad();
    fireEvent.click(screen.getAllByRole("button", { name: "Withdraw" })[0]);
    fake.from("finance_expenses", "select").reply(never);
    submitDialog();
    await closed();
    for (const button of [...screen.getAllByRole("button", { name: "Edit" }), ...screen.getAllByRole("button", { name: "Withdraw" }), screen.getByRole("button", { name: "Remove Harmonium receipt" })]) expect(button).toBeDisabled();
    // Opening the form that adds a receipt is not a change: it stays available.
    expect(screen.getAllByRole("button", { name: /Add receipt/ })[0]).toBeEnabled();
  });

  it("the claims': Changes requested, Denied, Mark approved, Add expense and Remove expense wait while a claim is being voided", async () => {
    scriptFinance(RICH);
    fake.rpc("void_funding_claim").reply(ok(null));
    renderFinance();
    await waitForLoad();
    await openTab("Funding claims");
    expect(screen.getByRole("button", { name: "Denied" })).toBeEnabled();
    fireEvent.click(screen.getAllByRole("button", { name: "Void claim" })[0]);
    fake.from("finance_expenses", "select").reply(never);
    fireEvent.change(within(dialog()).getByLabelText("Reason"), { target: { value: "Duplicate claim" } });
    submitDialog();
    await closed();
    for (const name of ["Changes requested", "Denied", "Mark approved"]) expect(screen.getByRole("button", { name })).toBeDisabled();
    for (const button of screen.getAllByRole("button", { name: "＋ Add expense" })) expect(button).toBeDisabled();
    for (const button of screen.getAllByRole("button", { name: /^Remove .* from this claim$/ })) expect(button).toBeDisabled();
  });
});

describe("finance: the ledger's search has a name", () => {
  it("Search payments, for a screen reader (the glyph and the placeholder are not a name)", async () => {
    scriptFinance(RICH);
    renderFinance();
    await waitForLoad();
    expect(screen.getByRole("textbox", { name: "Search payments" })).toBeInTheDocument();
  });
});

describe("finance: with the keyboard alone", () => {
  /** Types into the focused field and moves on to the next one. */
  const fill = async (user: ReturnType<typeof keyboardUser>, text: string) => { await user.keyboard(text); await user.tab(); };
  const at = () => (document.activeElement as HTMLElement | null)?.getAttribute("name") ?? focusedName();

  it("a member submits a reimbursement with a receipt: open it, fill it, choose the receipt, submit with Enter; the dialog closes and focus is back on the button", async () => {
    scriptFinance({ expenses: [], reimbursements: [], payments: [] });
    fake.rpc("submit_member_reimbursement").reply(ok({ expense_id: 1, reimbursement_id: 5 }));
    fake.rpc("register_finance_document").reply(ok(55));
    const { notify } = renderFinance({ role: "member", userId: "member-9" });
    await waitForMemberLoad();
    const user = keyboardUser();

    // From the top of the page, Tab reaches the button that opens the form.
    const reached = await tabOrder(user, 6);
    expect(reached).toContain("＋ Request reimbursement");
    while (focusedName() !== "＋ Request reimbursement") await user.tab();
    await user.keyboard("{Enter}");
    await screen.findByRole("dialog", { name: "Request reimbursement" });
    // Focus starts on the first field, not on Close.
    expect(at()).toBe("description");

    await fill(user, "Taxi to the venue");               // description
    expect(at()).toBe("vendor");
    await fill(user, "Yellow Cab");                       // vendor
    await fill(user, "42.5");                             // amount
    expect(at()).toBe("purchase_date");
    await user.tab();                                     // the date keeps today
    expect(at()).toBe("category");
    await user.tab();                                     // the category keeps Food
    expect(at()).toBe("last4");
    await fill(user, "1234");
    expect(at()).toBe("subgroup_id");
    await user.tab();
    expect(at()).toBe("event_related");
    await user.tab();
    expect(at()).toBe("receipt");
    // The browser's own file picker cannot be opened here: the receipt is given to the focused input the way the picker would.
    fireEvent.change(document.activeElement as HTMLInputElement, { target: { files: [pdf("taxi.pdf")] } });
    await user.tab(); expect(at()).toBe("statement");
    await user.tab(); expect(at()).toBe("note");
    await user.tab();
    expect(focusedName()).toBe("Submit reimbursement");
    // jsdom cannot count a file given this way as the input's file, so it alone reports "missing"; every field a person typed is valid.
    // The browser's own check is skipped for that one field (noValidate); the screen's behaviour is what Enter does next.
    const invalid = Array.from(dialog().querySelectorAll<HTMLInputElement>("input,select,textarea")).filter((element) => !element.validity.valid).map((element) => element.name);
    expect(invalid).toEqual(["receipt"]);
    dialog().querySelector("form")!.noValidate = true;
    await user.keyboard("{Enter}");

    await waitFor(() => expect(notify.find("Reimbursement request submitted")).toBeTruthy());
    await closed();
    expect(fake.rpc("submit_member_reimbursement").count).toBe(1);
    expect(fake.rpc("submit_member_reimbursement").calls[0].args[0]).toMatchObject({ p_description: "Taxi to the venue", p_vendor: "Yellow Cab", p_amount: 42.5, p_payment_card_last4: "1234" });
    expect(fake.rpc("register_finance_document").count).toBe(1);
    expect(focusedName()).toBe("＋ Request reimbursement");
  });

  it("an executive approves a request: tabs, into the list, the Approve button, the amount, Enter; the dialog closes", async () => {
    scriptFinance({
      expenses: [expense({ status: "submitted" })],
      reimbursements: [reimbursement({ status: "submitted" })],
    });
    fake.rpc("review_personal_reimbursement").reply(ok(null));
    const { notify } = renderFinance();
    await waitForLoad();
    const user = keyboardUser();

    // To the tab list, then the arrow keys to "reimbursements" (one tab stop, not four).
    while (focusedName() !== "overview") await user.tab();
    await user.keyboard("{ArrowRight}{ArrowRight}");
    await waitFor(() => expect(screen.getByRole("tab", { name: "reimbursements" })).toHaveAttribute("aria-selected", "true"));
    expect(focusedName()).toBe("reimbursements");
    // Into the panel: the request's buttons come in reading order.
    expect(await tabOrder(user, 4)).toEqual(["Details of Tabla repair", "Decline", "Request changes", "Approve"]);
    await user.keyboard("{Enter}");
    await screen.findByRole("dialog", { name: "Approve reimbursement" });
    expect((document.activeElement as HTMLInputElement).getAttribute("name")).toBe("amount");
    await user.keyboard("{Control>}a{/Control}60");
    expect((document.activeElement as HTMLInputElement).value).toBe("60");
    await user.tab();                                      // the note
    await user.keyboard("Receipt is clear");
    await user.tab(); expect(focusedName()).toBe("Cancel");
    await user.tab(); expect(focusedName()).toBe("Approve");
    await user.keyboard("{Enter}");

    await waitFor(() => expect(notify.find("Reimbursement approved")).toBeTruthy());
    await closed();
    expect(fake.rpc("review_personal_reimbursement").calls[0].args[0]).toMatchObject({ p_reimbursement_id: 5, p_decision: "approved", p_approved_amount: 60, p_review_note: "Receipt is clear" });
  });

  it("Escape closes a finance dialog and puts focus back on the button that opened it", async () => {
    scriptFinance();
    renderFinance();
    await waitForLoad();
    const user = keyboardUser();
    while (focusedName() !== "＋ Record income") await user.tab();
    await user.keyboard("{Enter}");
    await screen.findByRole("dialog", { name: "Record money received" });
    await user.keyboard("{Escape}");
    await closed();
    expect(focusedName()).toBe("＋ Record income");
  });

  it("a refused request leaves the form open with the focus inside it, not on the page behind", async () => {
    scriptFinance();
    fake.rpc("record_finance_income").reply(fail("Payment date cannot be in the future"));
    renderFinance();
    await waitForLoad();
    const user = keyboardUser();
    while (focusedName() !== "＋ Record income") await user.tab();
    await user.keyboard("{Enter}");
    await screen.findByRole("dialog");
    await user.keyboard("Gig");
    fireEvent.change(within(dialog()).getByLabelText("Amount"), { target: { value: "10" } });
    submitDialog();
    await waitFor(() => expect(fake.rpc("record_finance_income").count).toBe(1));
    await waitFor(() => expect(within(dialog()).getByRole("button", { name: "Record income" })).toBeEnabled());
    expect(dialog()).toContainElement(document.activeElement as HTMLElement);
  });
});

describe("finance: text of 12px or more, and tap targets of 44px on a small screen", () => {
  const dir = join(__dirname, "..", "..", "features", "finance");
  const css = readFileSync(join(dir, "finance.css"), "utf8");
  const px = (value: string, unit: string) => (unit === "rem" ? Number(value) * 16 : Number(value));
  const small = (text: string) => [...text.matchAll(/font(?:-size)?:\s*(?:[^;}]*?\s)?(\d*\.?\d+)(px|rem)\b/g)].map((hit) => ({ text: hit[0], size: px(hit[1], hit[2]) })).filter((hit) => hit.size < 12);
  const sources = (folder: string): string[] => readdirSync(folder, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? sources(join(folder, entry.name)) : /\.tsx?$/.test(entry.name) ? [join(folder, entry.name)] : []);

  it("the finder finds a small size (so an empty answer below means something)", () => {
    expect(small(".a{font-size:9px}.b{font:italic 8px Georgia}.c{font-size:.7rem}")).toHaveLength(3);
    expect(small(".a{font-size:12px}.b{font:400 25px Georgia,serif}")).toHaveLength(0);
  });

  it("finance.css has no text under 12px", () => {
    expect(small(css)).toEqual([]);
  });

  it("the classes and inline sizes of the finance components have none either", () => {
    const found: string[] = [];
    for (const file of sources(dir)) {
      const source = readFileSync(file, "utf8");
      for (const hit of source.matchAll(/text-\[(\d*\.?\d+)(px|rem)\]/g)) if (px(hit[1], hit[2]) < 12) found.push(`${file}: ${hit[0]}`);
      for (const hit of source.matchAll(/fontSize:\s*["']?(\d*\.?\d+)(px|rem)?/g)) if (px(hit[1], hit[2] ?? "px") < 12) found.push(`${file}: ${hit[0]}`);
    }
    expect(found).toEqual([]);
  });

  it("under 700px the tabs, queue items, chips, row buttons and card buttons are at least 44px tall and wide", () => {
    const block = /@media \(max-width:700px\)\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? "";
    const rule = /([^{}]*)\{min-height:44px;min-width:44px\}/.exec(block)?.[1] ?? "";
    for (const selector of [".finance-tabs button", ".finance-queue-item", ".document-chip", ".finance-row-action", ".reimbursement-actions button", ".claim-actions button", ".claim-expenses button"]) expect(rule).toContain(selector);
  });
});
