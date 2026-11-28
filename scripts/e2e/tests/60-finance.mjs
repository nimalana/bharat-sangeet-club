// Finance: member reimbursements (submit, edit, withdraw, request changes, replace a receipt, approve a lower
// amount, pay, void the payment), club expenses, income, funding claims (readiness rules, approval, payments,
// voids), the five summary cards against a hand-computed ledger, and the race on create_funding_claim.
// Money is never hard-deleted by the app, so every row here is marked [e2e] for cleanup.sql.
import { ok, equal, near, refused, succeeded, rowsOf, firstRow, nothingHappened, describeError } from "../lib/assert.mjs";
import { mark } from "../lib/ctx.mjs";
import { png, pdf, sha256, text } from "../lib/fixtures.mjs";
import { put, sign, download, freshUrl, proveGone, uid } from "../lib/storage.mjs";

const BUCKET = "finance-private";
const today = () => new Date().toISOString().slice(0, 10);
const KEYS = ["available_cash", "income", "spending", "pending_reimbursement_total", "pending_reimbursement_count", "expected_funding"];
const money = (n) => Math.round(Number(n) * 100) / 100;

export default async function finance(t, ctx) {
  const { c, id } = ctx;
  const s = (ctx.state.fin = {});
  t.setSection("60 finance");

  // ---- helpers -----------------------------------------------------------------------------------------
  const summary = async (key) => succeeded(await c[key].rpc("get_finance_summary"), `${key} get_finance_summary`);
  let last = null;
  // Compares the executive's summary with the previous snapshot. Any key not named in `expected` must not move.
  async function moved(expected, label) {
    const now = await summary("execA");
    const before = last;
    last = now;
    if (before) for (const key of KEYS) near(Number(now[key]) - Number(before[key]), expected[key] ?? 0, `${label}: change in ${key}`);
    return now;
  }
  const one = async (query, label) => firstRow(succeeded(await query, label));
  const expenseRow = (key, expenseId) => one(c[key].from("finance_expenses").select("*").eq("id", expenseId).single(), `${key} reads expense ${expenseId}`);
  const reimbursementRow = (key, reimbursementId) => one(c[key].from("personal_reimbursements").select("*").eq("id", reimbursementId).single(), `${key} reads reimbursement ${reimbursementId}`);
  const claimRow = (claimId) => one(c.execA.from("funding_claims").select("*").eq("id", claimId).single(), `read claim ${claimId}`);
  const paymentRow = (paymentId) => one(c.execA.from("finance_payments").select("*").eq("id", paymentId).single(), `read payment ${paymentId}`);
  const message = (error) => `${error.message || ""} ${error.details || ""}`;

  // The app's uploadDocument(): the file goes to finance-private, then ONE register_finance_document call creates the record and every
  // link (the four document tables take no direct writes: 20261128029000). On a refusal the stored file is removed, as the app does.
  const registerDoc = (client, params) => client.rpc("register_finance_document", params);
  async function uploadDoc(client, userId, { type = "receipt", title, buffer = png(), mime = "image/png", name = "receipt.png", last4 = null, links = {} }) {
    const path = `${userId}/${uid()}-${name}`;
    const up = await put(client, BUCKET, path, buffer, mime);
    if (up.error) throw new Error(`upload of ${type} to ${BUCKET} failed: ${describeError(up.error)}`);
    const saved = await registerDoc(client, {
      p_storage_path: path, p_document_type: type, p_title: title, p_mime_type: mime, p_file_size_bytes: buffer.length, p_payment_card_last4: last4 ?? undefined,
      p_expense_id: links.expenseId || undefined, p_reimbursement_id: links.reimbursementId || undefined, p_claim_id: links.claimId || undefined,
    });
    if (saved.error) {
      await client.storage.from(BUCKET).remove([path]);
      throw new Error(`registering ${type} failed: ${describeError(saved.error)}`);
    }
    return { id: Number(saved.data), path, buffer };
  }
  // A direct write to one of the four document tables: refused for everybody with "permission denied" (42501).
  const directRefused = (res, label) => equal(refused(res, label, /permission denied/i).code, "42501", `${label}: error code`);

  // Once remove_finance_document has dropped the record, the file is an unregistered file in the owner's folder: the owner (and an
  // executive) can delete it through the Storage API (20261127050200). Returns how many objects the API removed.
  async function deleteFinanceFile(client, path) {
    const direct = await client.storage.from(BUCKET).remove([path]);
    if (direct.error) throw new Error(`remove ${path} failed: ${describeError(direct.error)}`);
    return (direct.data || []).length;
  }

  async function memberRequest(key, label, amount, { receipt = true } = {}) {
    const description = mark(label);
    const sub = firstRow(succeeded(await c[key].rpc("submit_member_reimbursement", {
      p_description: description, p_vendor: "Music Shop", p_amount: amount, p_purchase_date: today(), p_category: "Supplies",
      p_payment_card_last4: "1234", p_member_note: "e2e",
    }), `${key} submit_member_reimbursement`));
    const request = { description, expenseId: Number(sub.expense_id), reimbursementId: Number(sub.reimbursement_id), doc: null };
    if (receipt) request.doc = await uploadDoc(c[key], id[key], { type: "receipt", title: mark(`Receipt ${label}`), last4: "1234", links: { expenseId: request.expenseId, reimbursementId: request.reimbursementId } });
    return request;
  }

  async function clubExpense(label, amount, { receipt = true, eventRelated = false } = {}) {
    const description = mark(label);
    const expenseId = Number(succeeded(await c.execA.rpc("record_club_expense", {
      p_description: description, p_vendor: "E2E Vendor", p_amount: amount, p_purchase_date: today(), p_category: "Supplies",
      p_account_name: "Club bank account", p_payment_card_last4: "4321", p_event_related: eventRelated,
      // An event purchase is recorded with its event details (20261128020200); the flyer or agenda is what the claim still lacks.
      ...(eventRelated ? { p_event_name: mark("E2E rehearsal"), p_event_starts_at: new Date(Date.now() + 86400000).toISOString(), p_event_attendee_count: 12, p_event_schedule: "Doors 6pm, music 7pm" } : {}),
    }), `record_club_expense ${label}`));
    const doc = receipt ? await uploadDoc(c.execA, id.execA, { type: "receipt", title: mark(`Receipt ${label}`), last4: "4321", links: { expenseId } }) : null;
    return { id: expenseId, description, doc };
  }

  const createClaim = (key, title, expenseIds) => c[key].rpc("create_funding_claim", {
    p_title: title, p_funder_name: "GPSG Senate", p_award_reference: "E2E-1", p_heellife_reference: "", p_submission_deadline: null, p_notes: "e2e", p_expense_ids: expenseIds,
  });
  const claimStatus = (claimId, status, extra = {}) => c.execA.rpc("set_funding_claim_status", { p_claim_id: claimId, p_status: status, ...extra });
  const addClaimDocuments = async (claimId) => {
    await uploadDoc(c.execA, id.execA, { type: "funding_approval", title: mark("Funding approval"), links: { claimId } });
    await uploadDoc(c.execA, id.execA, { type: "bank_statement", title: mark("Bank statement"), buffer: pdf("statement"), mime: "application/pdf", name: "statement.pdf", links: { claimId } });
  };

  // ---- member reimbursement ------------------------------------------------------------------------------
  await t.test("member1 submits a reimbursement with a receipt (RPC, upload to finance-private, record, links); the bytes round-trip; it is private to the member and the executives", async () => {
    await moved({}, "baseline");
    s.r1 = await memberRequest("member1", "Reimbursement 1", 40);
    const reimbursement = await reimbursementRow("member1", s.r1.reimbursementId);
    equal(reimbursement.status, "submitted", "reimbursement status");
    equal(money(reimbursement.requested_amount), 40, "requested amount");
    const expense = await expenseRow("member1", s.r1.expenseId);
    equal([expense.status, expense.paid_by, expense.paid_by_member_id, expense.payment_card_last4], ["submitted", "member", id.member1, "1234"], "expense fields");

    const signed = succeeded(await sign(c.member1, BUCKET, s.r1.doc.path, 120), "member1 signs the receipt");
    const got = await download(signed.signedUrl);
    equal(got.status, 200, "receipt download status");
    equal(got.sha, sha256(s.r1.doc.buffer), "receipt bytes");

    for (const key of ["member2", "manager", "leader"]) {
      equal(rowsOf(await c[key].from("finance_expenses").select("id").eq("id", s.r1.expenseId), `${key} reads expense`).length, 0, `${key} can see another member's expense`);
      equal(rowsOf(await c[key].from("personal_reimbursements").select("id").eq("id", s.r1.reimbursementId), `${key} reads reimbursement`).length, 0, `${key} can see another member's reimbursement`);
      equal(rowsOf(await c[key].from("finance_documents").select("id").eq("id", s.r1.doc.id), `${key} reads document`).length, 0, `${key} can see another member's receipt record`);
      ok((await sign(c[key], BUCKET, s.r1.doc.path, 60)).error, `${key} could sign another member's receipt`);
    }
    const viaExec = succeeded(await sign(c.execB, BUCKET, s.r1.doc.path, 60), "executive signs a member's receipt");
    equal((await download(viaExec.signedUrl)).sha, sha256(s.r1.doc.buffer), "executive download bytes");
    await moved({ pending_reimbursement_total: 40, pending_reimbursement_count: 1 }, "after submit");
  });

  await t.test("member1 edits the amount while the request waits; others cannot; direct table writes are refused; the only receipt cannot be removed while waiting", async () => {
    const edit = (key, amount, extra = {}) => c[key].rpc("update_member_reimbursement", {
      p_reimbursement_id: s.r1.reimbursementId, p_description: s.r1.description, p_vendor: "Music Shop", p_amount: amount, p_purchase_date: today(),
      p_category: "Supplies", p_payment_card_last4: "1234", p_member_note: "edited by member", ...extra,
    });
    refused(await edit("member2", 10), "member2 editing member1's request", /not found/i);
    refused(await edit("member1", 0), "amount zero", /greater than zero/i);
    refused(await edit("member1", 45.5, { p_payment_card_last4: "12" }), "short card number", /last four/i);
    const updated = firstRow(succeeded(await edit("member1", 45.5), "member1 edits the amount"));
    equal(money(updated.requested_amount), 45.5, "requested amount after edit");
    equal(money((await expenseRow("member1", s.r1.expenseId)).amount), 45.5, "expense amount follows the edit");
    await moved({ pending_reimbursement_total: 5.5 }, "after amount edit");

    nothingHappened(await c.member1.from("personal_reimbursements").update({ requested_amount: 1 }).eq("id", s.r1.reimbursementId).select(), "member1 updating personal_reimbursements directly");
    nothingHappened(await c.member1.from("finance_expenses").update({ amount: 1 }).eq("id", s.r1.expenseId).select(), "member1 updating finance_expenses directly");
    nothingHappened(await c.member1.from("finance_payments").insert({ direction: "inflow", purpose: "income", amount: 1, description: mark("forged income") }).select(), "member1 inserting a payment");
    equal(money((await reimbursementRow("member1", s.r1.reimbursementId)).requested_amount), 45.5, "amount after the direct write attempts");

    refused(await c.member1.rpc("remove_finance_document", { p_document_id: s.r1.doc2.id }), "removing the only receipt of a waiting request", /needs a receipt/i);
    refused(await c.member2.rpc("remove_finance_document", { p_document_id: s.r1.doc2.id }), "another member removing the receipt", /not found/i);
    const direct = await c.member1.storage.from(BUCKET).remove([s.r1.doc.path]);
    equal((direct.data || []).length, 0, "objects removed straight from storage while the record exists");
    succeeded(await sign(c.member1, BUCKET, s.r1.doc.path, 60), "the registered receipt is still signable");
  });

  await t.test("member1 submits a second request and withdraws it: both rows are voided with a reason, the pending total returns, and it cannot be withdrawn or edited again", async () => {
    s.r2 = await memberRequest("member1", "Reimbursement 2", 12);
    await moved({ pending_reimbursement_total: 12, pending_reimbursement_count: 1 }, "after second submit");
    refused(await c.member2.rpc("withdraw_member_reimbursement", { p_reimbursement_id: s.r2.reimbursementId }), "another member withdrawing", /not found/i);
    const withdrawn = firstRow(succeeded(await c.member1.rpc("withdraw_member_reimbursement", { p_reimbursement_id: s.r2.reimbursementId }), "withdraw"));
    equal(withdrawn.status, "voided", "reimbursement status");
    equal(withdrawn.void_reason, "Withdrawn by member", "void reason");
    const expense = await expenseRow("member1", s.r2.expenseId);
    equal([expense.status, expense.void_reason], ["voided", "Withdrawn by member"], "expense after withdrawal");
    await moved({ pending_reimbursement_total: -12, pending_reimbursement_count: -1 }, "after withdrawal");
    refused(await c.member1.rpc("withdraw_member_reimbursement", { p_reimbursement_id: s.r2.reimbursementId }), "withdrawing twice", /already been decided/i);
    refused(await c.member1.rpc("update_member_reimbursement", {
      p_reimbursement_id: s.r2.reimbursementId, p_description: s.r2.description, p_vendor: "x", p_amount: 5, p_purchase_date: today(), p_category: "Supplies", p_payment_card_last4: "1234",
    }), "editing a withdrawn request", /already been decided/i);
    const lateDoc = (extra) => ({ p_storage_path: `${id.member1}/${uid()}-late.png`, p_document_type: "receipt", p_title: mark("late receipt"), p_mime_type: "image/png", p_file_size_bytes: 10, ...extra });
    refused(await registerDoc(c.member1, lateDoc({ p_expense_id: s.r2.expenseId, p_reimbursement_id: s.r2.reimbursementId })), "a receipt added to a withdrawn request", /already been decided/i);
    refused(await registerDoc(c.member1, lateDoc({ p_expense_id: s.r2.expenseId })), "a receipt added to a withdrawn purchase", /has been voided/i);
  });

  await t.observe("the receipt of a withdrawn request can no longer be removed by the member or by an executive (remove_finance_document refuses)", async () => {
    const member = await c.member1.rpc("remove_finance_document", { p_document_id: s.r2.doc.id });
    const exec = await c.execA.rpc("remove_finance_document", { p_document_id: s.r2.doc.id });
    const stillThere = !(await sign(c.member1, BUCKET, s.r2.doc.path, 60)).error;
    const direct = await c.execA.storage.from(BUCKET).remove([s.r2.doc.path]);
    const table = await c.execA.from("finance_documents").delete().eq("id", s.r2.doc.id).select("id");
    return `member: ${member.error ? describeError(member.error) : "removed"}; executive: ${exec.error ? describeError(exec.error) : "removed"}; the file is still signable by its owner: ${stillThere}. `
      + `A decided request keeps its documents (20261127050200, deliberate). While the record exists the Storage API refuses too (executive remove() returned ${JSON.stringify(direct.data)}), and authenticated has no DELETE on finance_documents (${table.error ? describeError(table.error) : `it deleted ${JSON.stringify(table.data)}`}). `
      + "So the file of a withdrawn request stays in finance-private until the rows are cleaned up outside the app (cleanup.sql, then cleanup.mjs removes the then-unregistered file).";
  });

  await t.test("an executive asks for changes: the note reaches the member, short notes and members are refused, and the request stays in the pending total", async () => {
    refused(await c.member1.rpc("request_reimbursement_changes", { p_reimbursement_id: s.r1.reimbursementId, p_note: "I want changes" }), "member asking for changes", /executive/i);
    refused(await c.execA.rpc("request_reimbursement_changes", { p_reimbursement_id: s.r1.reimbursementId, p_note: "x" }), "a one-letter note", /Tell the member/i);
    const asked = firstRow(succeeded(await c.execA.rpc("request_reimbursement_changes", { p_reimbursement_id: s.r1.reimbursementId, p_note: "The receipt is blurry, please replace it" }), "request changes"));
    equal(asked.status, "changes_requested", "status after the request");
    const seen = await reimbursementRow("member1", s.r1.reimbursementId);
    equal([seen.status, seen.review_note, seen.reviewed_by], ["changes_requested", "The receipt is blurry, please replace it", id.execA], "what the member sees");
    refused(await c.execA.rpc("request_reimbursement_changes", { p_reimbursement_id: s.r1.reimbursementId, p_note: "again please" }), "asking twice", /not found/i);
    refused(await c.execA.rpc("review_personal_reimbursement", { p_reimbursement_id: s.r1.reimbursementId, p_decision: "approved" }), "approving while changes are requested", /submitted reimbursement not found/i);
    await moved({}, "after changes requested");
  });

  await t.test("the member adds a new receipt, then removes the old one: the record goes, the file is deleted through the Storage API, and no signed URL (including one made before) can fetch it", async () => {
    const old = s.r1.doc;
    const control = await download(await freshUrl(c.member1, BUCKET, old.path));
    equal(control.status, 200, "control download of the old receipt before anything is removed");
    const fresh = await freshUrl(c.member1, BUCKET, old.path); // never fetched: a fetch after the delete shows the bytes are gone
    s.r1.doc2 = await uploadDoc(c.member1, id.member1, { type: "receipt", title: mark("Receipt 1 replacement"), last4: "1234", buffer: Buffer.concat([png(), text("second")]), name: "receipt2.png", links: { expenseId: s.r1.expenseId, reimbursementId: s.r1.reimbursementId } });

    const returned = succeeded(await c.member1.rpc("remove_finance_document", { p_document_id: old.id }), "remove_finance_document");
    equal(returned, old.path, "path returned for the file clean-up");
    equal(rowsOf(await c.member1.from("finance_documents").select("id").eq("id", old.id), "re-read").length, 0, "document record after removal");
    const links = rowsOf(await c.member1.from("finance_reimbursement_documents").select("document_id").eq("reimbursement_id", s.r1.reimbursementId), "links");
    equal(links.map((x) => Number(x.document_id)), [s.r1.doc2.id], "documents still linked to the request");

    // The record is gone, so the file is an unregistered file in the owner's folder: only the owner (or an executive) may delete it.
    const other = await c.member2.storage.from(BUCKET).remove([old.path]);
    equal((other.data || []).length, 0, "another member deleting the unregistered file");
    // An executive can delete it too, once the record is gone; so can the owner. Another member could not (above).
    const execView = await c.execA.storage.from(BUCKET).list(id.member1, { limit: 100, search: old.path.split("/").pop() });
    ok(!execView.error && (execView.data || []).some((entry) => entry.name === old.path.split("/").pop()), `an executive should see the unregistered file of a removed document: ${execView.error ? describeError(execView.error) : "not listed"}`);
    equal(await deleteFinanceFile(c.member1, old.path), 1, `the owner deleting the file of a removed finance document through the Storage API (DELETE /storage/v1/object/${BUCKET}); before 20261127050200 this returned [] because the read policy needed the record that had just been removed`);
    await proveGone({ member1: c.member1, execA: c.execA, execB: c.execB }, BUCKET, old.path, { fresh });
  });

  await t.test("the member resubmits after the changes: the request goes back to submitted for the reviewers", async () => {
    const back = firstRow(succeeded(await c.member1.rpc("update_member_reimbursement", {
      p_reimbursement_id: s.r1.reimbursementId, p_description: s.r1.description, p_vendor: "Music Shop", p_amount: 45.5, p_purchase_date: today(),
      p_category: "Supplies", p_payment_card_last4: "1234", p_member_note: "new receipt attached",
    }), "resubmit"));
    equal(back.status, "submitted", "status after resubmit");
    equal((await expenseRow("member1", s.r1.expenseId)).status, "submitted", "expense status after resubmit");
    await moved({}, "after resubmit");
  });

  await t.test("an executive approves for less than requested: the approved amount drives the pending total, the request is locked for the member, and the amount of the expense is locked", async () => {
    refused(await c.member1.rpc("review_personal_reimbursement", { p_reimbursement_id: s.r1.reimbursementId, p_decision: "approved" }), "member approving", /executive/i);
    const tooMuch = await c.execA.rpc("review_personal_reimbursement", { p_reimbursement_id: s.r1.reimbursementId, p_decision: "approved", p_approved_amount: 60 });
    refused(tooMuch, "approving more than was requested");
    equal((await reimbursementRow("member1", s.r1.reimbursementId)).status, "submitted", "status after the refused approval");
    const approved = firstRow(succeeded(await c.execA.rpc("review_personal_reimbursement", { p_reimbursement_id: s.r1.reimbursementId, p_decision: "approved", p_approved_amount: 30, p_review_note: "Approved at the usual rate" }), "approve 30"));
    equal([approved.status, money(approved.approved_amount), approved.reviewed_by], ["approved", 30, id.execA], "approved reimbursement");
    const expense = await expenseRow("member1", s.r1.expenseId);
    equal([expense.status, expense.approved_by], ["approved", id.execA], "expense after approval");
    s.afterApprove = await moved({ pending_reimbursement_total: -15.5, spending: 45.5 }, "after approval at 30");

    refused(await c.member1.rpc("withdraw_member_reimbursement", { p_reimbursement_id: s.r1.reimbursementId }), "withdraw after approval", /already been decided/i);
    refused(await c.member1.rpc("update_member_reimbursement", {
      p_reimbursement_id: s.r1.reimbursementId, p_description: s.r1.description, p_vendor: "x", p_amount: 10, p_purchase_date: today(), p_category: "Supplies", p_payment_card_last4: "1234",
    }), "edit after approval", /already been decided/i);
    refused(await c.member1.rpc("remove_finance_document", { p_document_id: s.r1.doc2.id }), "removing a receipt after approval", /already been decided/i);
    const edit = (amount) => c.execA.rpc("update_finance_expense", {
      p_expense_id: s.r1.expenseId, p_description: s.r1.description, p_vendor: "Music Shop", p_category: "Supplies", p_payment_card_last4: "1234", p_amount: amount,
    });
    refused(await edit(50), "executive changing the amount of an approved expense", /locked/i);
    const renamed = firstRow(succeeded(await c.execA.rpc("update_finance_expense", {
      p_expense_id: s.r1.expenseId, p_description: s.r1.description, p_vendor: "Music Shop Ltd", p_category: "Supplies", p_payment_card_last4: "1234",
    }), "executive edits the vendor"));
    equal(renamed.vendor, "Music Shop Ltd", "vendor after the edit");
  });

  await t.test("an executive pays the approved amount: one outflow payment of the approved amount, cash drops by it, the member sees it and other members do not, and it cannot be paid twice", async () => {
    refused(await c.member1.rpc("pay_personal_reimbursement", { p_reimbursement_id: s.r1.reimbursementId, p_payment_date: today() }), "member paying", /executive/i);
    s.cashBeforePay = await summary("execA");
    s.payment1 = Number(succeeded(await c.execA.rpc("pay_personal_reimbursement", { p_reimbursement_id: s.r1.reimbursementId, p_payment_date: today(), p_account_name: "Club bank account" }), "pay"));
    const payment = await paymentRow(s.payment1);
    equal([payment.direction, payment.purpose, money(payment.amount), payment.status, payment.reimbursement_id], ["outflow", "member_reimbursement", 30, "posted", s.r1.reimbursementId], "payment row");
    const reimbursement = await reimbursementRow("member1", s.r1.reimbursementId);
    equal(reimbursement.status, "paid", "reimbursement status");
    ok(reimbursement.paid_at, "paid_at is set");
    equal((await expenseRow("member1", s.r1.expenseId)).status, "settled", "expense status");
    await moved({ available_cash: -30, pending_reimbursement_total: -30, pending_reimbursement_count: -1 }, "after payment");
    refused(await c.execA.rpc("pay_personal_reimbursement", { p_reimbursement_id: s.r1.reimbursementId, p_payment_date: today() }), "paying twice", /approved reimbursement not found/i);
    equal(rowsOf(await c.member1.from("finance_payments").select("id").eq("id", s.payment1), "member1 reads payment").length, 1, "payments the member sees");
    equal(rowsOf(await c.member2.from("finance_payments").select("id").eq("id", s.payment1), "member2 reads payment").length, 0, "payments another member sees");
  });

  await t.test("voiding the payment returns the cash to the earlier figure and the request to approved; it can then be paid again", async () => {
    refused(await c.member1.rpc("void_finance_payment", { p_payment_id: s.payment1, p_reason: "I would like it back" }), "member voiding", /executive/i);
    refused(await c.execA.rpc("void_finance_payment", { p_payment_id: s.payment1, p_reason: "x" }), "void with a one-letter reason", /Say why/i);
    const voided = firstRow(succeeded(await c.execA.rpc("void_finance_payment", { p_payment_id: s.payment1, p_reason: "Paid from the wrong account" }), "void payment"));
    equal([voided.status, voided.void_reason, voided.voided_by], ["voided", "Paid from the wrong account", id.execA], "voided payment");
    const after = await summary("execA");
    for (const key of KEYS) near(after[key], s.cashBeforePay[key], `summary ${key} after the void vs before the payment`);
    last = after;
    const reimbursement = await reimbursementRow("member1", s.r1.reimbursementId);
    equal([reimbursement.status, reimbursement.paid_at], ["approved", null], "reimbursement after the void");
    equal((await expenseRow("member1", s.r1.expenseId)).status, "approved", "expense after the void");
    refused(await c.execA.rpc("void_finance_payment", { p_payment_id: s.payment1, p_reason: "Again" }), "voiding twice", /already voided/i);
    s.payment1b = Number(succeeded(await c.execA.rpc("pay_personal_reimbursement", { p_reimbursement_id: s.r1.reimbursementId, p_payment_date: today() }), "pay again"));
    ok(s.payment1b !== s.payment1, "the second payment is a new row");
    await moved({ available_cash: -30, pending_reimbursement_total: -30, pending_reimbursement_count: -1 }, "after paying again");
    const audit = rowsOf(await c.execA.from("finance_audit_log").select("action,actor_id,after_data").eq("entity_type", "finance_payments").eq("entity_id", s.payment1).eq("action", "update"), "audit rows for the voided payment");
    ok(audit.some((row) => row.after_data?.status === "voided" && row.actor_id === id.execA), "no audit row records the void by the executive");
    equal(rowsOf(await c.member1.from("finance_audit_log").select("id").limit(1), "member reads audit").length, 0, "audit rows a member can read");
  });

  await t.test("no one reviews their own reimbursement: an executive's request is refused to them and decided by the other executive; a rejection leaves the totals alone", async () => {
    s.r3 = await memberRequest("execB", "Reimbursement by an executive", 22);
    await moved({ pending_reimbursement_total: 22, pending_reimbursement_count: 1 }, "after executive submits");
    refused(await c.execB.rpc("review_personal_reimbursement", { p_reimbursement_id: s.r3.reimbursementId, p_decision: "approved" }), "executive approving own request", /cannot review your own/i);
    refused(await c.execB.rpc("review_personal_reimbursement", { p_reimbursement_id: s.r3.reimbursementId, p_decision: "rejected" }), "executive rejecting own request", /cannot review your own/i);
    refused(await c.execB.rpc("request_reimbursement_changes", { p_reimbursement_id: s.r3.reimbursementId, p_note: "I will fix it myself" }), "executive asking changes on own request", /not found/i);
    equal((await reimbursementRow("execA", s.r3.reimbursementId)).status, "submitted", "status after the refused self-reviews");
    succeeded(await c.execA.rpc("review_personal_reimbursement", { p_reimbursement_id: s.r3.reimbursementId, p_decision: "approved" }), "execA approves execB's request");
    await moved({ spending: 22 }, "after the other executive approves");
    refused(await c.execB.rpc("pay_personal_reimbursement", { p_reimbursement_id: s.r3.reimbursementId, p_payment_date: today() }), "an executive paying their own request", /cannot pay your own/i);
    equal((await reimbursementRow("execA", s.r3.reimbursementId)).status, "approved", "status after the refused self-payment");
    succeeded(await c.execA.rpc("pay_personal_reimbursement", { p_reimbursement_id: s.r3.reimbursementId, p_payment_date: today() }), "execA pays execB's request");
    await moved({ available_cash: -22, pending_reimbursement_total: -22, pending_reimbursement_count: -1 }, "after paying the executive's request");

    s.r4 = await memberRequest("member2", "Reimbursement to reject", 8);
    await moved({ pending_reimbursement_total: 8, pending_reimbursement_count: 1 }, "member2 submits");
    const rejected = firstRow(succeeded(await c.execA.rpc("review_personal_reimbursement", { p_reimbursement_id: s.r4.reimbursementId, p_decision: "rejected", p_review_note: "Not a club expense" }), "reject"));
    equal([rejected.status, rejected.approved_amount, rejected.review_note], ["rejected", null, "Not a club expense"], "rejected reimbursement");
    equal((await reimbursementRow("member2", s.r4.reimbursementId)).review_note, "Not a club expense", "what the member reads");
    const declined = await expenseRow("member2", s.r4.expenseId);
    equal([declined.status, declined.rejected_by, declined.approved_by, declined.approved_at], ["rejected", id.execA, null, null], "expense after the decline: the rejection is recorded as one, with no approval");
    equal(rowsOf(await c.execA.from("finance_audit_log").select("action").eq("entity_type", "personal_reimbursements").eq("entity_id", s.r4.reimbursementId).eq("action", "rejected"), "audit rows").length, 1, "one audit row says the request was rejected");
    await moved({ pending_reimbursement_total: -8, pending_reimbursement_count: -1 }, "after the rejection");
    refused(await c.execA.rpc("review_personal_reimbursement", { p_reimbursement_id: s.r4.reimbursementId, p_decision: "approved" }), "approving a rejected request", /submitted reimbursement not found/i);
  });

  await t.test("finance files are guarded: another member's folder, another file type, an oversized file, a path that is not yours, a file that is not there, someone else's expense, a statement that is not a PDF, the same file twice and every direct write are refused", async () => {
    const intoOther = await put(c.member2, BUCKET, `${id.member1}/${uid()}-x.png`, png(), "image/png");
    ok(intoOther.error, "member2 uploaded into member1's folder");
    const wrongType = await put(c.member2, BUCKET, `${id.member2}/${uid()}-x.txt`, text("not allowed"), "text/plain");
    ok(wrongType.error, "a text file was accepted by finance-private");
    const big = Buffer.alloc(10 * 1024 * 1024 + 1, 1);
    const tooBig = await put(c.member2, BUCKET, `${id.member2}/${uid()}-big.pdf`, big, "application/pdf");
    ok(tooBig.error, "a file over 10 MB was accepted by finance-private");

    // A file member2 really stored in their own folder, and what the registration (the only way to write a document record) says to it.
    const mine = `${id.member2}/${uid()}-own.png`;
    succeeded(await put(c.member2, BUCKET, mine, png(), "image/png"), "member2 stores a file in their own folder");
    const reg = (client, path, over = {}) => registerDoc(client, { p_storage_path: path, p_document_type: "receipt", p_title: mark("guarded"), p_mime_type: "image/png", p_file_size_bytes: 10, ...over });
    refused(await reg(c.member2, mine, { p_expense_id: s.r1.expenseId }), "registering own file against another member's expense", /Expense not found/i);
    refused(await reg(c.member2, mine, { p_reimbursement_id: s.r1.reimbursementId }), "registering own file against another member's request", /Reimbursement request not found/i);
    refused(await reg(c.member2, `${id.member1}/${uid()}-y.png`, { p_expense_id: s.r4.expenseId, p_reimbursement_id: s.r4.reimbursementId }), "a record for a path in another member's folder", /own folder/i);
    refused(await reg(c.member2, mine, { p_document_type: "bank_statement", p_expense_id: s.r4.expenseId, p_reimbursement_id: s.r4.reimbursementId }), "a statement that is not a PDF", /PDF documents/i);
    refused(await reg(c.member2, mine, { p_mime_type: "text/plain", p_expense_id: s.r4.expenseId, p_reimbursement_id: s.r4.reimbursementId }), "a type the bucket does not take", /PDF, JPEG or PNG/i);
    refused(await reg(c.member2, mine), "a document attached to nothing", /Attach the document/i);
    refused(await reg(c.member2, mine, { p_expense_id: s.r4.expenseId, p_reimbursement_id: s.r4.reimbursementId }), "a receipt for the member's own request that was already declined", /already been decided/i);
    refused(await reg(c.member2, mine, { p_claim_id: 1 }), "a member attaching a document to a claim", /executive/i);
    // Executives: somebody else's path (the rest of what executives are refused is in the club expense test below).
    refused(await reg(c.execA, mine, { p_expense_id: s.r1.expenseId }), "an executive registering a member's file", /own folder/i);
    refused(await reg(c.execA, s.r1.doc2.path, { p_expense_id: s.r1.expenseId, p_reimbursement_id: s.r1.reimbursementId }), "an executive registering a member's registered file", /own folder/i);
    // The direct writes the old frontend made are closed for everybody (20261128029000).
    const row = (by, path) => ({ document_type: "receipt", title: mark("direct"), storage_path: path, mime_type: "image/png", file_size_bytes: 10, uploaded_by: by });
    directRefused(await c.member2.from("finance_documents").insert(row(id.member2, `${id.member2}/${uid()}-direct.png`)), "member2 inserting a document record in their own folder");
    directRefused(await c.member2.from("finance_documents").insert(row(id.member1, `${id.member2}/${uid()}-y.png`)), "member2 inserting a record in another member's name");
    directRefused(await c.execA.from("finance_documents").insert(row(id.member1, `${id.execA}/${uid()}-direct.png`)), "an executive inserting a record in a member's name");
    directRefused(await c.member2.from("finance_expense_documents").insert({ expense_id: s.r1.expenseId, document_id: s.r1.doc2.id }), "member2 linking to another member's expense");
    directRefused(await c.member2.from("finance_reimbursement_documents").insert({ reimbursement_id: s.r4.reimbursementId, document_id: s.r1.doc2.id }), "member2 linking to a request");
    directRefused(await c.execA.from("finance_claim_documents").insert({ claim_id: 1, document_id: s.r1.doc2.id }), "an executive linking a document to a claim");
    directRefused(await c.execA.from("finance_documents").update({ title: mark("renamed") }).eq("id", s.r1.doc2.id), "an executive renaming a registered document");
    directRefused(await c.execA.from("finance_documents").delete().eq("id", s.r1.doc2.id), "an executive deleting a registered document");
    // The registered document is as it was, and member2's loose file is theirs to delete (it was never registered).
    equal(rowsOf(await c.member1.from("finance_documents").select("id,uploaded_by").eq("id", s.r1.doc2.id), "re-read the document"), [{ id: s.r1.doc2.id, uploaded_by: id.member1 }], "the registered document after the refused writes");
    equal(await deleteFinanceFile(c.member2, mine), 1, "member2 deleting the file that was never registered");
  });

  // ---- club expenses and income -------------------------------------------------------------------------
  await t.test("club expense: executives only; it posts an outflow, edits keep the ledger line readable, the amount is locked, and a void returns the cash", async () => {
    refused(await c.member1.rpc("record_club_expense", { p_description: mark("member expense"), p_vendor: "x", p_amount: 5, p_purchase_date: today(), p_category: "Supplies" }), "member recording a club expense", /executive/i);
    refused(await c.execA.rpc("record_club_expense", { p_description: mark("zero"), p_vendor: "x", p_amount: 0, p_purchase_date: today(), p_category: "Supplies" }), "zero amount", /greater than zero/i);
    refused(await c.execA.rpc("record_club_expense", { p_description: mark("bad card"), p_vendor: "x", p_amount: 5, p_purchase_date: today(), p_category: "Supplies", p_payment_card_last4: "12ab" }), "bad card", /four digits/i);
    s.e1 = await clubExpense("Venue deposit", 80);
    const expense = await expenseRow("execA", s.e1.id);
    equal([expense.status, expense.paid_by, money(expense.amount)], ["settled", "club", 80], "club expense row");
    const payment = await one(c.execA.from("finance_payments").select("*").eq("expense_id", s.e1.id).eq("purpose", "direct_expense").single(), "its payment");
    equal([payment.direction, money(payment.amount), payment.status], ["outflow", 80, "posted"], "payment row");
    await moved({ available_cash: -80, spending: 80 }, "after the club expense");
    equal(rowsOf(await c.member1.from("finance_expenses").select("id").eq("id", s.e1.id), "member reads club expense").length, 0, "club expenses a member sees");

    refused(await c.execA.rpc("update_finance_expense", { p_expense_id: s.e1.id, p_description: s.e1.description, p_vendor: "Hall B", p_category: "Venue", p_payment_card_last4: "4321", p_amount: 90 }), "changing the amount of a settled expense", /locked/i);
    const renamed = firstRow(succeeded(await c.execA.rpc("update_finance_expense", { p_expense_id: s.e1.id, p_description: mark("Venue deposit renamed"), p_vendor: "Hall B", p_category: "Venue", p_payment_card_last4: "4321" }), "rename"));
    equal([renamed.description, renamed.vendor, renamed.category], [mark("Venue deposit renamed"), "Hall B", "Venue"], "expense after rename");
    const line = await one(c.execA.from("finance_payments").select("description,counterparty,category").eq("expense_id", s.e1.id).eq("purpose", "direct_expense").single(), "ledger line");
    equal(line, { description: mark("Venue deposit renamed"), counterparty: "Hall B", category: "Venue" }, "ledger line follows the edit");
    await moved({}, "after the rename");

    // Registering a document on a club purchase: a path with no file behind it, a registered file again, a member, and two registrations of one new file at once.
    const doc = (path, over = {}) => ({ p_storage_path: path, p_document_type: "receipt", p_title: mark("club purchase paper"), p_mime_type: "image/png", p_file_size_bytes: 10, p_expense_id: s.e1.id, ...over });
    refused(await registerDoc(c.execA, doc(`${id.execA}/${uid()}-never-uploaded.png`)), "a path with no file behind it", /not found in storage/i);
    refused(await registerDoc(c.execA, doc(s.e1.doc.path)), "a registered file again", /already been registered/i);
    refused(await registerDoc(c.member1, doc(`${id.member1}/${uid()}-x.png`)), "a member adding a document to a club purchase", /Expense not found/i);
    const raced = `${id.execA}/${uid()}-race.png`;
    succeeded(await put(c.execA, BUCKET, raced, png(), "image/png"), "execA stores the file for the race");
    const race = await Promise.all([registerDoc(c.execA, doc(raced)), registerDoc(c.execA, doc(raced))]);
    equal(race.filter((x) => !x.error).length, 1, "registrations of one file that went through");
    equal(race.filter((x) => x.error).map((x) => /already been registered/i.test(x.error.message)), [true], "the other one is refused in words");
    equal(rowsOf(await c.execA.from("finance_documents").select("id").eq("storage_path", raced), "the raced file's records").length, 1, "records of the raced file");

    refused(await c.member1.rpc("void_finance_expense", { p_expense_id: s.e1.id, p_reason: "member void" }), "member voiding", /executive/i);
    refused(await c.execA.rpc("void_finance_expense", { p_expense_id: s.e1.id, p_reason: " " }), "void without a reason", /Say why/i);
    const voided = firstRow(succeeded(await c.execA.rpc("void_finance_expense", { p_expense_id: s.e1.id, p_reason: "Entered twice" }), "void expense"));
    equal([voided.status, voided.void_reason], ["voided", "Entered twice"], "voided expense");
    equal((await one(c.execA.from("finance_payments").select("status").eq("expense_id", s.e1.id).eq("purpose", "direct_expense").single(), "payment after void")).status, "voided", "payment status after the expense is voided");
    await moved({ available_cash: 80, spending: -80 }, "after voiding the club expense");
    refused(await registerDoc(c.execA, doc(`${id.execA}/${uid()}-after-void.png`)), "a document added to a voided purchase", /has been voided/i);
    refused(await c.execA.rpc("void_finance_expense", { p_expense_id: s.e1.id, p_reason: "again" }), "voiding twice", /already voided/i);
    refused(await c.execA.rpc("update_finance_expense", { p_expense_id: s.e1.id, p_description: "x y", p_vendor: "", p_category: "Venue" }), "editing a voided expense", /voided expense cannot be edited/i);

    // Voiding the payment of a club purchase voids the purchase with it.
    const other = await clubExpense("Printing", 15);
    await moved({ available_cash: -15, spending: 15 }, "after the second club expense");
    const pay = await one(c.execA.from("finance_payments").select("id").eq("expense_id", other.id).eq("purpose", "direct_expense").single(), "payment id");
    succeeded(await c.execA.rpc("void_finance_payment", { p_payment_id: pay.id, p_reason: "Wrong account" }), "void the club payment");
    equal((await expenseRow("execA", other.id)).status, "voided", "expense after its payment is voided");
    await moved({ available_cash: 15, spending: -15 }, "after voiding through the payment");
  });

  await t.test("income: executives only; it raises cash and income, a void takes it back, and one income stays on the ledger", async () => {
    refused(await c.member1.rpc("record_finance_income", { p_description: mark("member income"), p_amount: 5, p_payment_date: today(), p_category: "Dues" }), "member recording income", /executive/i);
    refused(await c.execA.rpc("record_finance_income", { p_description: mark("zero income"), p_amount: 0, p_payment_date: today(), p_category: "Dues" }), "zero income", /greater than zero/i);
    const id1 = Number(succeeded(await c.execA.rpc("record_finance_income", { p_description: mark("Dues to void"), p_amount: 100, p_payment_date: today(), p_category: "Dues", p_counterparty: "Members" }), "record income"));
    const row = await paymentRow(id1);
    equal([row.direction, row.purpose, money(row.amount), row.status], ["inflow", "income", 100, "posted"], "income row");
    await moved({ available_cash: 100, income: 100 }, "after income");
    succeeded(await c.execA.rpc("void_finance_payment", { p_payment_id: id1, p_reason: "Entered in error" }), "void income");
    await moved({ available_cash: -100, income: -100 }, "after voiding income");
    succeeded(await c.execA.rpc("record_finance_income", { p_description: mark("Dues kept"), p_amount: 150, p_payment_date: today(), p_category: "Dues", p_counterparty: "Members" }), "record the income that stays");
    await moved({ available_cash: 150, income: 150 }, "after the income that stays");
  });

  // ---- funding claims -----------------------------------------------------------------------------------
  await t.test("funding claim creation: executives only, at least one claimable expense, rejected and unknown expenses refused, and an expense cannot be claimed twice", async () => {
    s.e2 = await clubExpense("Claim expense one", 60);
    s.e3 = await clubExpense("Claim expense two (no receipt)", 40, { receipt: false });
    s.e4 = await clubExpense("Claim expense three (event)", 25, { eventRelated: true });
    await moved({ available_cash: -125, spending: 125 }, "after three club expenses");
    refused(await createClaim("member1", mark("member claim"), [s.e2.id]), "member creating a claim", /executive/i);
    refused(await createClaim("execA", mark("empty claim"), []), "claim without expenses", /Select at least one/i);
    refused(await createClaim("execA", mark("claim with a rejected expense"), [s.r4.expenseId]), "claim with a rejected expense", /cannot be claimed/i);
    refused(await createClaim("execA", mark("claim with an unknown expense"), [999999999]), "claim with an unknown expense", /cannot be claimed/i);
    s.claim1 = firstRow(succeeded(await createClaim("execA", mark("Claim one"), [s.e2.id, s.e3.id, s.e4.id]), "create claim"));
    equal([s.claim1.status, money(s.claim1.requested_amount)], ["incomplete", 125], "new claim");
    const links = rowsOf(await c.execA.from("funding_claim_expenses").select("expense_id,claimed_amount").eq("claim_id", s.claim1.id), "claim links");
    equal(links.map((x) => [Number(x.expense_id), money(x.claimed_amount)]).sort((a, b) => a[0] - b[0]), [[s.e2.id, 60], [s.e3.id, 40], [s.e4.id, 25]].sort((a, b) => a[0] - b[0]), "claim lines");
    refused(await createClaim("execB", mark("second claim on the same expense"), [s.e2.id]), "claiming a fully claimed expense", /already fully claimed/i);
    equal(rowsOf(await c.member1.from("funding_claims").select("id"), "member reads claims").length, 0, "claims a member can read");
    nothingHappened(await c.member1.from("funding_claims").insert({ title: mark("forged claim"), requested_amount: 5 }).select(), "member inserting a claim directly");
  });

  await t.test("mark ready is refused until the claim has everything: the message names what is missing and each piece of evidence clears one item", async () => {
    const text1 = message(refused(await claimStatus(s.claim1.id, "ready"), "mark ready with nothing attached", /still needs/i));
    for (const part of ["a receipt for every expense", "a bank or card statement", "the funding approval", "event flyer"]) ok(text1.includes(part), `the refusal should mention "${part}": ${text1}`);
    ok(!text1.includes("card last four"), `card digits are on every expense, the refusal should not ask for them: ${text1}`);
    refused(await claimStatus(s.claim1.id, "submitted"), "submitting an incomplete claim", /cannot be marked submitted/i);

    await uploadDoc(c.execA, id.execA, { type: "receipt", title: mark("Receipt for the second expense"), last4: "4321", links: { expenseId: s.e3.id } });
    const text2 = message(refused(await claimStatus(s.claim1.id, "ready"), "ready after the missing receipt", /still needs/i));
    ok(!text2.includes("a receipt for every expense"), `the receipt item should be cleared: ${text2}`);

    await uploadDoc(c.execA, id.execA, { type: "funding_approval", title: mark("Funding approval"), links: { claimId: s.claim1.id } });
    const text3 = message(refused(await claimStatus(s.claim1.id, "ready"), "ready after the approval", /still needs/i));
    ok(!text3.includes("the funding approval") && text3.includes("a bank or card statement"), `approval cleared, statement still missing: ${text3}`);

    // A statement must be a PDF: the database refuses an image, and the stray file is removed by the executive.
    const stray = `${id.execA}/${uid()}-statement.png`;
    succeeded(await put(c.execA, BUCKET, stray, png(), "image/png"), "upload of the stray image");
    refused(await registerDoc(c.execA, { p_storage_path: stray, p_document_type: "bank_statement", p_title: mark("statement as image"), p_mime_type: "image/png", p_file_size_bytes: 10, p_claim_id: s.claim1.id }), "a bank statement that is an image", /PDF documents/i);
    equal(await deleteFinanceFile(c.execA, stray), 1, "the executive deleting the stray, unregistered file"); // an unregistered file is visible to its uploader and to executives (20261127050200)
    await uploadDoc(c.execA, id.execA, { type: "card_statement", title: mark("Card statement"), buffer: pdf("card"), mime: "application/pdf", name: "card.pdf", links: { claimId: s.claim1.id } });
    const text4 = message(refused(await claimStatus(s.claim1.id, "ready"), "ready with the event expense still incomplete", /still needs/i));
    ok(text4.includes("event flyer") && !text4.includes("bank or card statement"), `only the event flyer or agenda remains: ${text4}`);

    refused(await c.execA.rpc("remove_funding_claim_expense", { p_claim_id: s.claim1.id, p_expense_id: 999999999 }), "removing an expense that is not on the claim", /not on this claim/i);
    const trimmed = firstRow(succeeded(await c.execA.rpc("remove_funding_claim_expense", { p_claim_id: s.claim1.id, p_expense_id: s.e4.id }), "remove the event expense"));
    equal(money(trimmed.requested_amount), 100, "requested amount after removing 25");
    const ready = firstRow(succeeded(await claimStatus(s.claim1.id, "ready"), "mark ready"));
    equal(ready.status, "ready", "claim status");
    const added = firstRow(succeeded(await c.execA.rpc("add_funding_claim_expense", { p_claim_id: s.claim1.id, p_expense_id: s.e4.id }), "add the event expense back"));
    equal([added.status, money(added.requested_amount)], ["incomplete", 125], "a ready claim goes back to incomplete when an expense is added");
    refused(await c.execA.rpc("add_funding_claim_expense", { p_claim_id: s.claim1.id, p_expense_id: s.e4.id }), "adding the same expense twice", /already on this claim/i);
    succeeded(await c.execA.rpc("remove_funding_claim_expense", { p_claim_id: s.claim1.id, p_expense_id: s.e4.id }), "remove it again");
    equal((await claimStatus(s.claim1.id, "ready")).data?.status, "ready", "ready again");
    await moved({}, "claims do not move the summary until approved");
  });

  await t.test("submitted claim: its expenses and documents are frozen, an expense on it cannot be voided, approval needs an amount that is not above the request", async () => {
    const submitted = firstRow(succeeded(await claimStatus(s.claim1.id, "submitted"), "submit"));
    equal(submitted.status, "submitted", "claim status");
    ok(submitted.submitted_at, "submitted_at is set");
    refused(await c.execA.rpc("add_funding_claim_expense", { p_claim_id: s.claim1.id, p_expense_id: s.e4.id }), "adding an expense after submitting", /only be changed before/i);
    refused(await c.execA.rpc("remove_funding_claim_expense", { p_claim_id: s.claim1.id, p_expense_id: s.e2.id }), "removing an expense after submitting", /only be changed before/i);
    refused(await c.execA.rpc("void_finance_expense", { p_expense_id: s.e2.id, p_reason: "Trying to void a claimed expense" }), "voiding a claimed expense", /part of a funding claim/i);
    const payment = await one(c.execA.from("finance_payments").select("id").eq("expense_id", s.e2.id).eq("purpose", "direct_expense").single(), "payment of the claimed expense");
    refused(await c.execA.rpc("void_finance_payment", { p_payment_id: payment.id, p_reason: "Trying to void a claimed payment" }), "voiding the payment of a claimed expense", /part of a funding claim/i);
    refused(await c.execA.rpc("remove_finance_document", { p_document_id: s.e2.doc.id }), "removing the only receipt of a claimed expense", /only receipt|submitted funding claim/i);
    const claimDocs = rowsOf(await c.execA.from("finance_claim_documents").select("document_id").eq("claim_id", s.claim1.id), "claim documents");
    refused(await c.execA.rpc("remove_finance_document", { p_document_id: Number(claimDocs[0].document_id) }), "removing a document of a submitted claim", /submitted funding claim/i);

    const afterSubmit = (type) => ({ p_storage_path: `${id.execA}/${uid()}-after-submit.pdf`, p_document_type: type, p_title: mark("after submitting"), p_mime_type: "application/pdf", p_file_size_bytes: 10, p_claim_id: s.claim1.id });
    refused(await registerDoc(c.execA, afterSubmit("bank_statement")), "a statement added to a submitted claim", /with the funder/i);
    refused(await registerDoc(c.execA, afterSubmit("funding_approval")), "the funding approval replaced on a submitted claim", /with the funder/i);
    refused(await registerDoc(c.execA, { ...afterSubmit("receipt"), p_claim_id: undefined, p_expense_id: s.e2.id }), "a receipt added to an expense of a submitted claim", /submitted/i);

    refused(await c.member1.rpc("set_funding_claim_status", { p_claim_id: s.claim1.id, p_status: "approved", p_approved_amount: 10 }), "member approving a claim", /executive/i);
    refused(await claimStatus(s.claim1.id, "approved"), "approval without an amount", /Enter the amount/i);
    refused(await claimStatus(s.claim1.id, "approved", { p_approved_amount: 100.01 }), "approval above the request", /cannot be more than/i);
    const approved = firstRow(succeeded(await claimStatus(s.claim1.id, "approved", { p_approved_amount: 80, p_note: "Funder approved 80" }), "approve"));
    equal([approved.status, money(approved.approved_amount)], ["approved", 80], "approved claim");
    ok(String(approved.notes).includes("Funder approved 80"), `the note is appended to the claim notes: ${approved.notes}`);
    await moved({ expected_funding: 80 }, "after approval of the claim at 80");
  });

  await t.test("claim payments: part payment, an over-payment is refused, the final payment closes the claim; voiding the payments in turn reopens it; money received blocks voiding the claim", async () => {
    const pay = (key, amount) => c[key].rpc("record_funding_claim_payment", { p_claim_id: s.claim1.id, p_amount: amount, p_payment_date: today(), p_account_name: "Club bank account" });
    refused(await pay("member1", 10), "member recording funding", /executive/i);
    refused(await pay("execA", 0), "zero payment", /greater than zero/i);
    s.cp1 = Number(succeeded(await pay("execA", 50), "first payment"));
    let claim = await claimRow(s.claim1.id);
    equal([claim.status, money(claim.received_amount)], ["partially_paid", 50], "claim after 50");
    await moved({ available_cash: 50, income: 50, expected_funding: -50 }, "after the first claim payment");
    refused(await pay("execA", 31), "paying more than approved", /exceeds approved/i);
    s.cp2 = Number(succeeded(await pay("execB", 30), "final payment by the other executive"));
    claim = await claimRow(s.claim1.id);
    equal([claim.status, money(claim.received_amount)], ["paid", 80], "claim after 80");
    await moved({ available_cash: 30, income: 30, expected_funding: -30 }, "after the final claim payment");
    const row = await paymentRow(s.cp1);
    equal([row.direction, row.purpose, row.funding_claim_id], ["inflow", "external_reimbursement", s.claim1.id], "claim payment row");
    refused(await pay("execA", 1), "paying a closed claim", /approved before recording payment/i);
    refused(await c.execA.rpc("void_funding_claim", { p_claim_id: s.claim1.id, p_reason: "Trying to void a paid claim" }), "voiding a claim with money received", /Money has been received/i);

    succeeded(await c.execA.rpc("void_finance_payment", { p_payment_id: s.cp2, p_reason: "Funder reversed the last payment" }), "void the final payment");
    claim = await claimRow(s.claim1.id);
    equal([claim.status, money(claim.received_amount)], ["partially_paid", 50], "claim after voiding the final payment");
    await moved({ available_cash: -30, income: -30, expected_funding: 30 }, "after voiding the final payment");
    succeeded(await c.execA.rpc("void_finance_payment", { p_payment_id: s.cp1, p_reason: "Funder reversed the first payment" }), "void the first payment");
    claim = await claimRow(s.claim1.id);
    equal([claim.status, money(claim.received_amount)], ["approved", 0], "claim after voiding both payments");
    await moved({ available_cash: -50, income: -50, expected_funding: 50 }, "after voiding the first payment");

    const voided = firstRow(succeeded(await c.execA.rpc("void_funding_claim", { p_claim_id: s.claim1.id, p_reason: "Replaced by a new claim" }), "void the claim"));
    equal(voided.status, "voided", "claim status");
    equal(rowsOf(await c.execA.from("funding_claim_expenses").select("expense_id").eq("claim_id", s.claim1.id), "released").length, 0, "expenses still linked to the voided claim");
    await moved({ expected_funding: -80 }, "after voiding the claim");
    refused(await c.execA.rpc("void_funding_claim", { p_claim_id: s.claim1.id, p_reason: "again" }), "voiding twice", /already voided/i);
    refused(await pay("execA", 5), "payment on a voided claim", /approved before recording payment/i);
  });

  await t.test("the released expenses go on a new claim that is taken through ready, submitted, approved and a part payment, and is left on the ledger", async () => {
    s.claim2 = firstRow(succeeded(await createClaim("execA", mark("Claim two"), [s.e2.id, s.e3.id]), "create the new claim"));
    equal(money(s.claim2.requested_amount), 100, "requested amount");
    await addClaimDocuments(s.claim2.id);
    equal(firstRow(succeeded(await claimStatus(s.claim2.id, "ready"), "ready")).status, "ready", "ready");
    equal(firstRow(succeeded(await claimStatus(s.claim2.id, "submitted"), "submit")).status, "submitted", "submitted");
    equal(firstRow(succeeded(await claimStatus(s.claim2.id, "approved", { p_approved_amount: 100 }), "approve")).status, "approved", "approved");
    succeeded(await c.execA.rpc("record_funding_claim_payment", { p_claim_id: s.claim2.id, p_amount: 40, p_payment_date: today() }), "part payment");
    const claim = await claimRow(s.claim2.id);
    equal([claim.status, money(claim.received_amount)], ["partially_paid", 40], "claim two");
    await moved({ available_cash: 40, income: 40, expected_funding: 60 }, "after the second claim's part payment");
  });

  await t.test("claim outcomes: changes requested reopens editing, a denial can be voided, and the expense goes free again", async () => {
    s.e5 = await clubExpense("Claim expense four", 15);
    await moved({ available_cash: -15, spending: 15 }, "after the fourth club expense");
    const claim = firstRow(succeeded(await createClaim("execA", mark("Claim three"), [s.e5.id]), "create claim three"));
    await addClaimDocuments(claim.id);
    succeeded(await claimStatus(claim.id, "ready"), "ready");
    succeeded(await claimStatus(claim.id, "submitted"), "submitted");
    refused(await claimStatus(claim.id, "paid"), "jumping to paid", /cannot be marked paid/i);
    const changes = firstRow(succeeded(await claimStatus(claim.id, "changes_requested", { p_note: "Funder wants the flyer" }), "changes requested"));
    equal(changes.status, "changes_requested", "status");
    ok(changes.reviewed_at, "reviewed_at is set");
    await moved({}, "changes requested do not move money");
    succeeded(await c.execA.rpc("add_funding_claim_expense", { p_claim_id: claim.id, p_expense_id: s.e4.id }), "an expense can be added again while changes are requested");
    succeeded(await c.execA.rpc("remove_funding_claim_expense", { p_claim_id: claim.id, p_expense_id: s.e4.id }), "and removed");
    succeeded(await claimStatus(claim.id, "ready"), "ready again");
    succeeded(await claimStatus(claim.id, "submitted"), "submitted again");
    equal(firstRow(succeeded(await claimStatus(claim.id, "denied", { p_note: "Denied by the funder" }), "deny")).status, "denied", "denied");
    refused(await claimStatus(claim.id, "approved", { p_approved_amount: 5 }), "approving a denied claim", /cannot be marked approved/i);
    equal(firstRow(succeeded(await c.execA.rpc("void_funding_claim", { p_claim_id: claim.id, p_reason: "Denied, expense goes free" }), "void the denied claim")).status, "voided", "voided");
    const reclaim = firstRow(succeeded(await createClaim("execA", mark("Claim four"), [s.e5.id]), "the freed expense can be claimed again"));
    succeeded(await c.execA.rpc("void_funding_claim", { p_claim_id: reclaim.id, p_reason: "Test claim, not needed" }), "void claim four");
    await moved({}, "after the claim outcomes");
  });

  await t.test("two executives call create_funding_claim on the same expenses at the same moment: exactly one wins every round, and the other is told the expenses are already claimed", async () => {
    // 20261127050000 locks the expenses (in one order) before the claim is built; before it, a race could give a raw check-constraint error.
    const SIZE = 30;
    const ids = [];
    for (let start = 0; start < SIZE; start += 6) {
      const batch = await Promise.all(Array.from({ length: Math.min(6, SIZE - start) }, (_, i) => clubExpense(`Race expense ${start + i}`, 10, { receipt: false })));
      ids.push(...batch.map((x) => x.id));
    }
    const rounds = [];
    for (let round = 0; round < 24; round++) {
      const subset = round % 3 === 0 ? [ids[0]] : ids;
      const [a, b] = await Promise.all([createClaim("execA", mark(`race A ${round}`), subset), createClaim("execB", mark(`race B ${round}`), subset)]);
      const made = [a, b].filter((x) => !x.error).map((x) => firstRow(x.data));
      let over = [];
      if (made.length) {
        const links = rowsOf(await c.execA.from("funding_claim_expenses").select("claim_id,expense_id,claimed_amount").in("claim_id", made.map((x) => x.id)), "race links");
        const per = new Map();
        for (const link of links) per.set(link.expense_id, (per.get(link.expense_id) || 0) + Number(link.claimed_amount));
        over = [...per.entries()].filter(([, total]) => total > 10 + 0.001).map(([expense, total]) => ({ expense, claimed: total, amount: 10 }));
      }
      rounds.push({ round, expenses: subset.length, execA: a.error ? describeError(a.error) : `claim ${firstRow(a.data).id}`, execB: b.error ? describeError(b.error) : `claim ${firstRow(b.data).id}`, winners: made.length, overClaimedExpenses: over.length });
      for (const claim of made) succeeded(await c.execA.rpc("void_funding_claim", { p_claim_id: claim.id, p_reason: "Race test, voided" }), "void a race claim");
    }
    for (let start = 0; start < ids.length; start += 6) {
      await Promise.all(ids.slice(start, start + 6).map(async (expenseId) => succeeded(await c.execA.rpc("void_finance_expense", { p_expense_id: expenseId, p_reason: "Race test, voided" }), "void a race expense")));
    }
    await moved({}, "after the race test is tidied up");
    const problems = [];
    for (const r of rounds) {
      if (r.winners !== 1) problems.push(`round ${r.round}: ${r.winners} executives created a claim (A: ${r.execA}; B: ${r.execB}); exactly one should`);
      if (r.overClaimedExpenses) problems.push(`round ${r.round}: ${r.overClaimedExpenses} expense(s) claimed above their amount`);
      const loser = r.winners === 1 ? (r.execA.startsWith("claim") ? r.execB : r.execA) : null;
      if (loser && !/already fully claimed \[22023\]/.test(loser)) problems.push(`round ${r.round}: the other executive got "${loser}" instead of the readable "already fully claimed" refusal`);
    }
    if (problems.length) throw new Error(`${problems.length} problem(s) in ${rounds.length} rounds:\n${problems.slice(0, 8).join("\n")}`);
  });

  // ---- ledger ---------------------------------------------------------------------------------------------
  await t.test("the five cards (get_finance_summary) equal a hand-computed total from the ledger rows, for both executives and for a member's own rows", async () => {
    const all = async (key, table) => {
      const rows = [];
      for (let from = 0; ; from += 1000) {
        const page = rowsOf(await c[key].from(table).select("*").order("id").range(from, from + 999), `${key} reads ${table}`);
        rows.push(...page);
        if (page.length < 1000) break;
      }
      return rows;
    };
    const compute = async (key) => {
      const payments = await all(key, "finance_payments");
      const expenses = await all(key, "finance_expenses");
      const reimbursements = await all(key, "personal_reimbursements");
      const claims = key.startsWith("exec") ? await all(key, "funding_claims") : [];
      const counted = payments.filter((p) => ["posted", "cleared"].includes(p.status));
      const pending = reimbursements.filter((r) => ["submitted", "changes_requested", "approved"].includes(r.status));
      return {
        available_cash: counted.reduce((sum, p) => sum + (p.direction === "inflow" ? 1 : -1) * Number(p.amount), 0),
        income: counted.filter((p) => p.direction === "inflow").reduce((sum, p) => sum + Number(p.amount), 0),
        spending: expenses.filter((e) => ["approved", "settled"].includes(e.status)).reduce((sum, e) => sum + Number(e.amount), 0),
        pending_reimbursement_total: pending.reduce((sum, r) => sum + Number(r.approved_amount ?? r.requested_amount), 0),
        pending_reimbursement_count: pending.length,
        expected_funding: claims.filter((x) => ["approved", "partially_paid"].includes(x.status)).reduce((sum, x) => sum + Math.max(0, Number(x.approved_amount || 0) - Number(x.received_amount)), 0),
        voidedPayments: payments.filter((p) => p.status === "voided").length,
        paymentRows: payments.length,
      };
    };
    for (const key of ["execA", "execB", "member1"]) {
      const expected = await compute(key);
      const got = await summary(key);
      for (const k of KEYS) near(got[k], expected[k], `${key}: ${k} from get_finance_summary vs the hand-computed ledger (${expected.paymentRows} payments, ${expected.voidedPayments} voided)`);
    }
    const exec = await compute("execA");
    ok(exec.voidedPayments >= 5, `the ledger should hold the voided payments made by this run, found ${exec.voidedPayments}`);
    s.final = exec;
  });

  await t.observe("spending counts the full purchase amount of a reimbursed expense, not the approved amount that was paid", async () => {
    const expense = await expenseRow("execA", s.r1.expenseId);
    const payment = await paymentRow(s.payment1b);
    const memberSummary = await summary("member1");
    return `Expense ${s.r1.expenseId}: purchase ${expense.amount}, approved and paid ${payment.amount}. get_finance_summary.spending adds ${expense.amount} (sum of finance_expenses.amount for approved and settled), while the cash outflow for it is ${payment.amount}, so Spending runs ${money(expense.amount - payment.amount)} above what left the account. `
      + `For a member, get_finance_summary covers only the rows they can see: member1 gets ${JSON.stringify(memberSummary)}. `
      + "Deliberate since 20261127050400: the meaning is written in the function's comment and pinned by supabase/tests/80_finance_summary.test.sql.";
  });
}
