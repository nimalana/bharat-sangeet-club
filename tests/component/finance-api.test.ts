// lib/api/finance.ts against the fake Supabase client: every function sends exactly the call the Finance screen used to send
// itself (table, operation, chain, arguments, payload), in the same order, and reports a failure the same way.
//
// What these protect that tests/component/finance.test.tsx does not say in one place: the SHAPE of each call (the argument keys the
// database function expects, the select lists and limits of the load wave, the order of upload -> register -> link, record before
// file). The screen test proves the screen still behaves; these prove the data layer still asks the database the same questions.
//
// A Supabase answer with an error is an ApiError (message and code of the database kept); a call that rejects (no network) is
// not, so the screen can tell "refused" from "could not reach it".

import { describe, expect, it } from "vitest";
import {
  FINANCE_LIST_LIMIT, addFundingClaimExpense, approveFundingClaim, approveReimbursement, createFinanceDocumentUrl, createFundingClaim, declineReimbursement,
  financeAvailable, loadFinanceWave, payPersonalReimbursement, recordClubExpense, recordFinanceIncome, recordFundingClaimDecision, recordFundingClaimPayment,
  removeFinanceDocument, removeFundingClaimExpense, requestReimbursementChanges, setFundingClaimStatus, submitMemberReimbursement, updateFinanceExpense,
  updateMemberReimbursement, uploadFinanceDocument, voidFinanceExpense, voidFinancePayment, voidFundingClaim, withdrawMemberReimbursement,
  type PurchaseDetails,
} from "../../lib/api/finance";
import { ApiError } from "../../lib/errors";
import { fail, fake, ok, rejects, type Call } from "../support/fake-supabase";

/** The chain of a table call as plain arrays: [["select", "*"], ["order", "id", { ascending: false }], ["limit", 500]]. */
const chainOf = (call: Call) => call.chain.map((link) => [link.method, ...link.args]);
const rpcArgs = (name: string, index = 0) => fake.rpc(name).calls[index].args[0];

const details: PurchaseDetails = {
  description: "Tabla repair", vendor: "Raj Music", amount: 80, purchaseDate: "2026-10-01", category: "Instruments", cardLast4: "1234",
  subgroupId: 4, clubEventId: 9, eventRelated: true, eventName: "Fall concert", eventStartsAt: "2026-10-05T23:30:00.000Z", eventAttendeeCount: 60, eventSchedule: "7pm doors",
};

describe("the finance api: the load wave", () => {
  it("a manager's wave is the eleven reads, in this order, with these select lists, orders and limits", async () => {
    await loadFinanceWave(true);
    const sent = fake.calls.map((call) => [call.kind, call.target, call.op, ...(call.kind === "from" ? [chainOf(call)] : [])]);
    expect(sent).toEqual([
      ["from", "finance_expenses", "select", [["select", "*"], ["order", "purchase_date", { ascending: false }], ["order", "id", { ascending: false }], ["limit", 500]]],
      ["from", "personal_reimbursements", "select", [["select", "*"], ["order", "created_at", { ascending: false }], ["limit", 500]]],
      ["from", "finance_payments", "select", [["select", "*"], ["order", "payment_date", { ascending: false }], ["order", "id", { ascending: false }], ["limit", 500]]],
      ["from", "finance_documents", "select", [["select", "id,document_type,title,storage_path,uploaded_by"], ["order", "created_at", { ascending: false }], ["limit", 2000]]],
      ["from", "finance_expense_documents", "select", [["select", "expense_id,document_id"], ["limit", 2000]]],
      ["from", "finance_reimbursement_documents", "select", [["select", "reimbursement_id,document_id"], ["limit", 2000]]],
      ["rpc", "get_finance_summary", "get_finance_summary"],
      ["from", "funding_claims", "select", [["select", "*"], ["order", "created_at", { ascending: false }], ["limit", 500]]],
      ["from", "funding_claim_expenses", "select", [["select", "claim_id,expense_id,claimed_amount"], ["limit", 2000]]],
      ["from", "finance_claim_documents", "select", [["select", "claim_id,document_id"], ["limit", 2000]]],
      ["from", "profiles", "select", [["select", "id,full_name,email"], ["order", "full_name"], ["limit", 2000]]],
    ]);
    expect(FINANCE_LIST_LIMIT).toBe(500);
  });

  it("anyone else's wave is the seven reads their role may make: the claims and the profiles are not asked for and answer empty", async () => {
    const wave = await loadFinanceWave(false);
    expect(fake.calls.map((call) => call.target)).toEqual([
      "finance_expenses", "personal_reimbursements", "finance_payments", "finance_documents", "finance_expense_documents", "finance_reimbursement_documents", "get_finance_summary",
    ]);
    for (const name of ["claims", "claimExpenses", "claimDocuments", "profiles"] as const) expect(wave[name]).toEqual({ data: [], error: null });
  });

  it("each answer comes back under its own name, rows and error side by side", async () => {
    fake.from("finance_expenses").reply(ok([{ id: 1 }]));
    fake.from("personal_reimbursements").reply(ok([{ id: 2 }]));
    fake.from("finance_payments").reply(ok([{ id: 3 }]));
    fake.from("finance_documents").reply(ok([{ id: 4 }]));
    fake.from("finance_expense_documents").reply(ok([{ expense_id: 5 }]));
    fake.from("finance_reimbursement_documents").reply(ok([{ reimbursement_id: 6 }]));
    fake.rpc("get_finance_summary").reply(ok({ available_cash: "12.5" }));
    fake.from("funding_claims").reply(ok([{ id: 7 }]));
    fake.from("funding_claim_expenses").reply(ok([{ claim_id: 8 }]));
    fake.from("finance_claim_documents").reply(ok([{ claim_id: 9 }]));
    fake.from("profiles").reply(ok([{ id: "p" }]));
    const wave = await loadFinanceWave(true);
    expect(wave).toEqual({
      expenses: { data: [{ id: 1 }], error: null }, reimbursements: { data: [{ id: 2 }], error: null }, payments: { data: [{ id: 3 }], error: null },
      documents: { data: [{ id: 4 }], error: null }, expenseDocuments: { data: [{ expense_id: 5 }], error: null }, reimbursementDocuments: { data: [{ reimbursement_id: 6 }], error: null },
      summary: { data: { available_cash: "12.5" }, error: null }, claims: { data: [{ id: 7 }], error: null }, claimExpenses: { data: [{ claim_id: 8 }], error: null },
      claimDocuments: { data: [{ claim_id: 9 }], error: null }, profiles: { data: [{ id: "p" }], error: null },
    });
  });

  it("a failed read does not throw: it is that answer's error (an ApiError with the database's message and code) and the others still arrive", async () => {
    fake.from("finance_payments").reply(fail("canceling statement due to statement timeout", "57014"));
    fake.rpc("get_finance_summary").reply(ok({ available_cash: 1 }));
    const wave = await loadFinanceWave(true);
    expect(wave.payments.data).toBeNull();
    expect(wave.payments.error).toBeInstanceOf(ApiError);
    expect(wave.payments.error).toMatchObject({ message: "canceling statement due to statement timeout", code: "57014" });
    expect(wave.summary).toEqual({ data: { available_cash: 1 }, error: null });
    expect(wave.expenses.error).toBeNull();
  });

  it("a read that rejects (no network) is not swallowed", async () => {
    fake.from("profiles").reply(rejects());
    await expect(loadFinanceWave(true)).rejects.toThrow("Failed to fetch");
  });
});

describe("the finance api: requests, club expenses and income", () => {
  it("submit_member_reimbursement sends these argument names with these values, and answers the first row", async () => {
    fake.rpc("submit_member_reimbursement").reply(ok([{ expense_id: 11, reimbursement_id: 12 }]));
    const row = await submitMemberReimbursement(details, "Please pay by Friday");
    expect(row).toEqual({ expense_id: 11, reimbursement_id: 12 });
    expect(rpcArgs("submit_member_reimbursement")).toEqual({
      p_description: "Tabla repair", p_vendor: "Raj Music", p_amount: 80, p_purchase_date: "2026-10-01", p_category: "Instruments", p_payment_card_last4: "1234",
      p_member_note: "Please pay by Friday", p_subgroup_id: 4, p_club_event_id: 9, p_event_related: true, p_event_name: "Fall concert",
      p_event_starts_at: "2026-10-05T23:30:00.000Z", p_event_attendee_count: 60, p_event_schedule: "7pm doors",
    });
  });

  it("submit_member_reimbursement also accepts an answer that is one object, and passes null for what the form left empty", async () => {
    fake.rpc("submit_member_reimbursement").reply(ok({ expense_id: 1, reimbursement_id: 2 }));
    expect(await submitMemberReimbursement({ ...details, subgroupId: null, clubEventId: null, eventStartsAt: null, eventAttendeeCount: null, eventRelated: false }, "")).toEqual({ expense_id: 1, reimbursement_id: 2 });
    expect(rpcArgs("submit_member_reimbursement")).toMatchObject({ p_subgroup_id: null, p_club_event_id: null, p_event_starts_at: null, p_event_attendee_count: null, p_event_related: false, p_member_note: "" });
  });

  it("record_club_expense sends the account it was paid from and answers the new expense's id", async () => {
    fake.rpc("record_club_expense").reply(ok(21));
    expect(await recordClubExpense(details, "Club bank account")).toBe(21);
    expect(rpcArgs("record_club_expense")).toEqual({
      p_description: "Tabla repair", p_vendor: "Raj Music", p_amount: 80, p_purchase_date: "2026-10-01", p_category: "Instruments", p_account_name: "Club bank account",
      p_payment_card_last4: "1234", p_subgroup_id: 4, p_club_event_id: 9, p_event_related: true, p_event_name: "Fall concert",
      p_event_starts_at: "2026-10-05T23:30:00.000Z", p_event_attendee_count: 60, p_event_schedule: "7pm doors",
    });
  });

  it("record_finance_income", async () => {
    await recordFinanceIncome({ description: "Gig", amount: 250, paymentDate: "2026-10-09", category: "Gig revenue", counterparty: "Memorial Hall", accountName: "Club bank account" });
    expect(rpcArgs("record_finance_income")).toEqual({
      p_description: "Gig", p_amount: 250, p_payment_date: "2026-10-09", p_category: "Gig revenue", p_counterparty: "Memorial Hall", p_account_name: "Club bank account",
    });
  });

  it("a refused request is an ApiError that keeps the database's sentence and code, so friendlyError reads it as it read the raw error", async () => {
    fake.rpc("submit_member_reimbursement").reply(fail("Purchase date cannot be in the future", "P0001"));
    const error = await submitMemberReimbursement(details, "").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ message: "Purchase date cannot be in the future", code: "P0001" });
  });

  it("a call that rejects (no network) is passed on as it is, not turned into a refusal", async () => {
    fake.rpc("record_club_expense").reply(rejects());
    const error = await recordClubExpense(details, "Club bank account").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(TypeError);
    expect(error).not.toBeInstanceOf(ApiError);
  });
});

describe("the finance api: one-click changes and the claim decisions", () => {
  it("pay_personal_reimbursement", async () => {
    await payPersonalReimbursement(5, "2026-10-09", "Club bank account");
    expect(rpcArgs("pay_personal_reimbursement")).toEqual({ p_reimbursement_id: 5, p_payment_date: "2026-10-09", p_account_name: "Club bank account" });
  });

  it("set_funding_claim_status with a status alone sends nothing else (no amount, no note)", async () => {
    await setFundingClaimStatus(3, "incomplete");
    expect(rpcArgs("set_funding_claim_status")).toEqual({ p_claim_id: 3, p_status: "incomplete" });
    expect(Object.keys(rpcArgs("set_funding_claim_status") as object)).toEqual(["p_claim_id", "p_status"]);
  });

  it("set_funding_claim_status for the funder's answers: approved carries the amount, the others carry the funder's words", async () => {
    await approveFundingClaim(3, 75, "Partly");
    await recordFundingClaimDecision(3, "denied", "Out of budget");
    await recordFundingClaimDecision(4, "changes_requested", "Add the flyer");
    expect(fake.rpc("set_funding_claim_status").calls.map((call) => call.args[0])).toEqual([
      { p_claim_id: 3, p_status: "approved", p_approved_amount: 75, p_note: "Partly" },
      { p_claim_id: 3, p_status: "denied", p_note: "Out of budget" },
      { p_claim_id: 4, p_status: "changes_requested", p_note: "Add the flyer" },
    ]);
  });

  it("a refused status change is an ApiError", async () => {
    fake.rpc("set_funding_claim_status").reply(fail("A claim that is submitted cannot be marked submitted"));
    await expect(setFundingClaimStatus(3, "submitted")).rejects.toBeInstanceOf(ApiError);
  });
});

describe("the finance api: corrections", () => {
  const edit = { description: "Tabla", vendor: "Raj", category: "Instruments", cardLast4: "1234" as string | null, subgroupId: null, clubEventId: null, eventRelated: false, eventName: "", eventStartsAt: null, eventAttendeeCount: null, eventSchedule: "" };

  it("void_finance_payment, void_finance_expense and void_funding_claim carry the reason", async () => {
    await voidFinancePayment(7, "Entered twice");
    await voidFinanceExpense(1, "Wrong amount");
    await voidFundingClaim(3, "Funder withdrew");
    expect(rpcArgs("void_finance_payment")).toEqual({ p_payment_id: 7, p_reason: "Entered twice" });
    expect(rpcArgs("void_finance_expense")).toEqual({ p_expense_id: 1, p_reason: "Wrong amount" });
    expect(rpcArgs("void_funding_claim")).toEqual({ p_claim_id: 3, p_reason: "Funder withdrew" });
  });

  it("update_finance_expense sends the details the expense keeps, and no amount or date", async () => {
    await updateFinanceExpense(1, edit);
    expect(rpcArgs("update_finance_expense")).toEqual({
      p_expense_id: 1, p_description: "Tabla", p_vendor: "Raj", p_category: "Instruments", p_payment_card_last4: "1234",
      p_subgroup_id: null, p_club_event_id: null, p_event_related: false, p_event_name: "", p_event_starts_at: null, p_event_attendee_count: null, p_event_schedule: "",
    });
  });

  it("update_finance_expense sends no card digits as null (the form left them empty)", async () => {
    await updateFinanceExpense(1, { ...edit, cardLast4: null });
    expect(rpcArgs("update_finance_expense")).toMatchObject({ p_payment_card_last4: null });
  });

  it("update_member_reimbursement adds the amount, the date and the note to the same details", async () => {
    await updateMemberReimbursement(5, { ...edit, cardLast4: "9876" }, { amount: 42.5, purchaseDate: "2026-10-02", memberNote: "Receipt replaced" });
    expect(rpcArgs("update_member_reimbursement")).toEqual({
      p_reimbursement_id: 5, p_description: "Tabla", p_vendor: "Raj", p_category: "Instruments", p_payment_card_last4: "9876",
      p_subgroup_id: null, p_club_event_id: null, p_event_related: false, p_event_name: "", p_event_starts_at: null, p_event_attendee_count: null, p_event_schedule: "",
      p_amount: 42.5, p_purchase_date: "2026-10-02", p_member_note: "Receipt replaced",
    });
  });

  it("the member's own withdrawal and the reviewer's three answers", async () => {
    await withdrawMemberReimbursement(5);
    await approveReimbursement(5, 60, "Lower amount");
    await declineReimbursement(5, "Not a club purchase");
    await requestReimbursementChanges(5, "Receipt is blurry");
    expect(rpcArgs("withdraw_member_reimbursement")).toEqual({ p_reimbursement_id: 5 });
    expect(fake.rpc("review_personal_reimbursement").calls.map((call) => call.args[0])).toEqual([
      { p_reimbursement_id: 5, p_decision: "approved", p_approved_amount: 60, p_review_note: "Lower amount" },
      { p_reimbursement_id: 5, p_decision: "rejected", p_approved_amount: null, p_review_note: "Not a club purchase" },
    ]);
    expect(rpcArgs("request_reimbursement_changes")).toEqual({ p_reimbursement_id: 5, p_note: "Receipt is blurry" });
  });

  it("adding and removing an expense on a claim", async () => {
    await addFundingClaimExpense(3, 1);
    await removeFundingClaimExpense(3, 2);
    expect(rpcArgs("add_funding_claim_expense")).toEqual({ p_claim_id: 3, p_expense_id: 1 });
    expect(rpcArgs("remove_funding_claim_expense")).toEqual({ p_claim_id: 3, p_expense_id: 2 });
  });
});

describe("the finance api: funding claims", () => {
  const claim = { title: "Fall concert", funderName: "GPSG Senate", awardReference: "A-1", heellifeReference: "H-2", submissionDeadline: "2026-11-30" as string | null, notes: "Food", expenseIds: [1, 2] };

  it("create_funding_claim sends the claim and its expenses in one call and answers the claim", async () => {
    fake.rpc("create_funding_claim").reply(ok({ id: 3, title: "Fall concert" }));
    expect(await createFundingClaim(claim)).toEqual({ id: 3, title: "Fall concert" });
    expect(fake.rpc("create_funding_claim").calls).toHaveLength(1);
    expect(rpcArgs("create_funding_claim")).toEqual({
      p_title: "Fall concert", p_funder_name: "GPSG Senate", p_award_reference: "A-1", p_heellife_reference: "H-2", p_submission_deadline: "2026-11-30", p_notes: "Food", p_expense_ids: [1, 2],
    });
  });

  it("no deadline is sent as null", async () => {
    fake.rpc("create_funding_claim").reply(ok({ id: 3 }));
    await createFundingClaim({ ...claim, submissionDeadline: null });
    expect(rpcArgs("create_funding_claim")).toMatchObject({ p_submission_deadline: null });
  });

  it("an answer with no row and no error is a refusal with no message (the screen then says its own fallback)", async () => {
    fake.rpc("create_funding_claim").reply(ok(null));
    const error = await createFundingClaim(claim).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).message).toBe("");
  });

  it("a refused claim keeps the database's sentence", async () => {
    fake.rpc("create_funding_claim").reply(fail("Expense 2 is already on another claim"));
    await expect(createFundingClaim(claim)).rejects.toMatchObject({ message: "Expense 2 is already on another claim" });
  });

  it("record_funding_claim_payment", async () => {
    await recordFundingClaimPayment({ claimId: 3, amount: 80, paymentDate: "2026-11-02", accountName: "Club bank account" });
    expect(rpcArgs("record_funding_claim_payment")).toEqual({ p_claim_id: 3, p_amount: 80, p_payment_date: "2026-11-02", p_account_name: "Club bank account" });
  });
});

describe("the finance api: documents", () => {
  const file = new File(["%PDF-1.4 receipt"], "receipt.pdf", { type: "application/pdf" });
  const upload = (links: Parameters<typeof uploadFinanceDocument>[0]["links"], over: Partial<Parameters<typeof uploadFinanceDocument>[0]> = {}) =>
    uploadFinanceDocument({ file, storagePath: "member-9/abc-receipt.pdf", mimeType: "application/pdf", documentType: "receipt", title: "Receipt", cardLast4: "1234", links, ...over });

  it("the file goes into the private bucket first, then ONE call registers the record and every link, and the document's id comes back", async () => {
    fake.rpc("register_finance_document").reply(ok(55));
    const id = await upload({ expenseId: 1, reimbursementId: 5, claimId: 3 });
    expect(id).toBe(55);
    expect(fake.calls.map((call) => `${call.kind}:${call.target}:${call.op}`)).toEqual([
      "storage:finance-private:upload", "rpc:register_finance_document:register_finance_document",
    ]);
    const stored = fake.storage("finance-private", "upload").calls[0];
    expect(stored.args[0]).toBe("member-9/abc-receipt.pdf");
    expect(stored.args[1]).toBe(file);
    expect(stored.args[2]).toEqual({ contentType: "application/pdf", upsert: false });
    expect(rpcArgs("register_finance_document")).toEqual({
      p_storage_path: "member-9/abc-receipt.pdf", p_document_type: "receipt", p_title: "Receipt", p_mime_type: "application/pdf",
      p_file_size_bytes: file.size, p_payment_card_last4: "1234", p_expense_id: 1, p_reimbursement_id: 5, p_claim_id: 3,
    });
    expect(fake.rpc("register_finance_document").calls[0].seq).toBeGreaterThan(stored.seq);
  });

  it("nobody is named as the uploader and no table is written: the database takes the uploader from the signed-in person", async () => {
    fake.rpc("register_finance_document").reply(ok(55));
    await upload({ expenseId: 1 });
    expect(Object.keys(rpcArgs("register_finance_document") as object)).not.toContain("p_uploaded_by");
    expect(fake.calls.filter((call) => call.kind === "from")).toEqual([]);
  });

  it("only the targets that were asked for are sent, and no card digits are sent as nothing", async () => {
    fake.rpc("register_finance_document").reply(ok(8));
    await upload({ claimId: 3 }, { cardLast4: null });
    const sent = rpcArgs("register_finance_document") as Record<string, unknown>;
    expect(sent.p_claim_id).toBe(3);
    expect(sent.p_expense_id).toBeUndefined();
    expect(sent.p_reimbursement_id).toBeUndefined();
    expect(sent.p_payment_card_last4).toBeUndefined();
  });

  it("the id comes back as a number even when the database answers with text", async () => {
    fake.rpc("register_finance_document").reply(ok("57"));
    expect(await upload({ expenseId: 1 })).toBe(57);
  });

  it("when the file cannot be stored nothing is registered and nothing is removed", async () => {
    fake.storage("finance-private", "upload").reply(fail("The resource already exists"));
    const error = await upload({ expenseId: 1 }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toBeInstanceOf(Error);
    expect((error as ApiError).message).toBe("The resource already exists");
    expect(fake.calls.map((call) => call.target)).toEqual(["finance-private"]);
  });

  it("when the registration is refused the database's sentence is thrown and the stored file is removed again", async () => {
    fake.rpc("register_finance_document").reply(fail("This purchase has been voided, so documents can no longer be added", "22023"));
    await expect(upload({ expenseId: 1 })).rejects.toMatchObject({ message: "This purchase has been voided, so documents can no longer be added", code: "22023" });
    expect(fake.calls.map((call) => `${call.kind}:${call.target}:${call.op}`)).toEqual([
      "storage:finance-private:upload", "rpc:register_finance_document:register_finance_document", "storage:finance-private:remove",
    ]);
    expect(fake.storage("finance-private", "remove").calls[0].args[0]).toEqual(["member-9/abc-receipt.pdf"]);
  });

  it("a file that cannot be removed after a refusal does not hide the refusal", async () => {
    fake.rpc("register_finance_document").reply(fail("The file must be stored in your own folder", "42501"));
    fake.storage("finance-private", "remove").reply(rejects());
    await expect(upload({ expenseId: 1 })).rejects.toMatchObject({ message: "The file must be stored in your own folder", code: "42501" });
  });

  it("a file that is already registered is left in the bucket: a record points at it", async () => {
    fake.rpc("register_finance_document").reply(fail("This file has already been registered as a finance document", "23505"));
    await expect(upload({ expenseId: 1 })).rejects.toMatchObject({ code: "23505" });
    expect(fake.storage("*", "remove").count).toBe(0);
  });

  it("a registration that got no answer (the network went away) leaves the file: it may have gone through", async () => {
    fake.rpc("register_finance_document").reply(rejects());
    await expect(upload({ expenseId: 1 })).rejects.toBeInstanceOf(TypeError);
    expect(fake.storage("*", "remove").count).toBe(0);
  });

  it("an answer with no id is a failure: the stored file is removed and the sentence is the old one", async () => {
    fake.rpc("register_finance_document").reply(ok(null));
    await expect(upload({ expenseId: 1 })).rejects.toMatchObject({ message: "Document record could not be created" });
    expect(fake.storage("finance-private", "remove").count).toBe(1);
  });

  it("a signed link for a stored document lasts 90 seconds", async () => {
    const url = await createFinanceDocumentUrl("member-9/taxi.pdf");
    expect(url).toBe("https://files.test/finance-private/member-9/taxi.pdf?signed");
    const call = fake.storage("finance-private", "createSignedUrl").calls[0];
    expect(call.args).toEqual(["member-9/taxi.pdf", 90]);
  });

  it("a link that cannot be made is an ApiError", async () => {
    fake.storage("finance-private", "createSignedUrl").reply(fail("Object not found"));
    await expect(createFinanceDocumentUrl("x.pdf")).rejects.toBeInstanceOf(ApiError);
  });
});

describe("the finance api: removing a document", () => {
  const sentences = { refusedMessage: "refused sentence", failedMessage: "failed sentence" };

  it("the record goes first and the file after, and a deleted file leaves nothing to report", async () => {
    fake.rpc("remove_finance_document").reply(ok("member-9/taxi.pdf"));
    expect(await removeFinanceDocument(11, sentences)).toEqual({ fileLeft: null });
    expect(rpcArgs("remove_finance_document")).toEqual({ p_document_id: 11 });
    const removed = fake.storage("finance-private", "remove").calls[0];
    expect(removed.args[0]).toEqual(["member-9/taxi.pdf"]);
    expect(fake.rpc("remove_finance_document").calls[0].seq).toBeLessThan(removed.seq);
  });

  it("a record with no stored file is removed and storage is not asked for anything", async () => {
    fake.rpc("remove_finance_document").reply(ok(null));
    expect(await removeFinanceDocument(11, sentences)).toEqual({ fileLeft: null });
    expect(fake.storage("*", "remove").count).toBe(0);
  });

  it("an empty answer from storage (a refused delete) is reported with the caller's sentence", async () => {
    fake.rpc("remove_finance_document").reply(ok("a.pdf"));
    fake.storage("finance-private", "remove").reply(ok([]));
    expect(await removeFinanceDocument(11, sentences)).toEqual({ fileLeft: "refused sentence" });
  });

  it("a storage error, and a storage call that throws, are reported with the other sentence (the record is gone either way)", async () => {
    fake.rpc("remove_finance_document").reply(ok("a.pdf"));
    fake.storage("finance-private", "remove").replyOnce(fail("Object not found")).replyOnce(rejects());
    expect(await removeFinanceDocument(11, sentences)).toEqual({ fileLeft: "failed sentence" });
    expect(await removeFinanceDocument(11, sentences)).toEqual({ fileLeft: "failed sentence" });
  });

  it("when the record cannot be removed the file is left alone and the refusal is thrown", async () => {
    fake.rpc("remove_finance_document").reply(fail("A request needs at least one receipt"));
    await expect(removeFinanceDocument(11, sentences)).rejects.toMatchObject({ message: "A request needs at least one receipt" });
    expect(fake.storage("*", "remove").count).toBe(0);
  });
});

describe("the finance api: the client", () => {
  it("is available when Supabase is configured", () => {
    expect(financeAvailable()).toBe(true);
  });
});
