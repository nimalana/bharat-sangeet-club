import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { FINANCE_ANSWERS } from "../lib/finance-load.ts";
import { bracketed, functionSource, topLevelParts } from "./source-slice.mjs";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

// frontend-6 and frontend-10 (round 2) for the Finance screen. The screen is a
// React component and cannot run under node --test, so these check the wiring.
// The rules it uses are tested as pure code in finance-summary.test.mjs,
// single-flight.test.mjs and storage-remove.test.mjs.

// Each answer the screen reads, and the call that fetches it. The failure check must list each one under
// its own name: "summary" must be the totals RPC, not some other result that happens to be in scope.
const FETCHED_BY = {
  expenseResult: 'from("finance_expenses")', reimbursementResult: 'from("personal_reimbursements")', paymentResult: 'from("finance_payments")',
  documentResult: 'from("finance_documents")', expenseDocumentResult: 'from("finance_expense_documents")', reimbursementDocumentResult: 'from("finance_reimbursement_documents")',
  summaryResult: 'rpc("get_finance_summary")', claimResult: 'from("funding_claims")', claimExpenseResult: 'from("funding_claim_expenses")',
  claimDocumentResult: 'from("finance_claim_documents")', profileResult: 'from("profiles")',
};
const ANSWER_OF = {
  expenses: "expenseResult", reimbursements: "reimbursementResult", payments: "paymentResult", documents: "documentResult",
  expenseDocuments: "expenseDocumentResult", reimbursementDocuments: "reimbursementDocumentResult", summary: "summaryResult",
  claims: "claimResult", claimExpenses: "claimExpenseResult", claimDocuments: "claimDocumentResult", profiles: "profileResult",
};

test("the failure check lists every answer under its own result, summaryResult included (frontend-6)", async () => {
  const finance = await read("app/finance.tsx");
  const load = functionSource(finance, "FinancePage");

  // 1. Which result is which: the names in the destructuring line up with the calls in Promise.all.
  const namesAt = load.indexOf("const [expenseResult");
  assert.ok(namesAt > 0, "the results are destructured from one Promise.all");
  const names = topLevelParts(bracketed(load, namesAt + "const ".length));
  const callsAt = load.indexOf("Promise.all([", namesAt);
  const calls = topLevelParts(bracketed(load, load.indexOf("[", callsAt)));
  assert.equal(names.length, 11);
  assert.equal(calls.length, names.length, "one call per result");
  names.forEach((name, i) => assert.ok(FETCHED_BY[name] && calls[i].includes(FETCHED_BY[name]), `${name} is the answer of ${FETCHED_BY[name]}`));

  // 2. The list handed to the check: exactly the answers the rule knows, each wired to its own result.
  const checkAt = load.indexOf("financeRefreshFailed({");
  assert.ok(checkAt > namesAt, "the check comes after the reads");
  const listed = Object.fromEntries(topLevelParts(bracketed(load, load.indexOf("{", checkAt))).map((entry) => entry.split(/:\s*/).map((part) => part.trim())));
  assert.deepEqual(listed, ANSWER_OF, "every answer, each under its own result (summary: summaryResult)");
  assert.deepEqual(Object.keys(listed).sort(), [...FINANCE_ANSWERS].sort(), "the same answers the rule in lib/finance-load.ts checks");

  // 3. A failure returns before anything on screen is replaced, and the totals only change after the check.
  const firstSet = load.indexOf("setExpenses(snapshot.expenses)");
  assert.ok(checkAt > 0 && firstSet > checkAt, "the failure check comes before any list or total is replaced");
  assert.match(load.slice(checkAt, firstSet), /setLoadFailed\(true\)[\s\S]*return;/);
  assert.ok(load.indexOf("setSummary(snapshot.summary)") > checkAt, "the totals are only replaced after the check");
  // The old list of results, which left the summary out.
  assert.doesNotMatch(finance, /anyFailed\(\[expenseResult/);
});

test("finance: Mark paid asks first, runs once, and shows it is working", async () => {
  const finance = await read("app/finance.tsx");
  // The button opens a confirmation; it does not pay.
  assert.match(finance, /disabled=\{changing\} onClick=\{\(\) => setConfirming\(\{ kind: "pay", request \}\)\}>\{pendingKey === `pay-\$\{request\.id\}` \? "Paying…" : "Mark paid"\}/);
  assert.doesNotMatch(finance, /onClick=\{\(\) => markReimbursementPaid\(/);
  // The payment itself goes through the single-flight guard, and the list reloads before the button is free again.
  assert.match(finance, /async function runOnce\(key: string, work: \(\) => Promise<void>\) \{\s*await flight\.run\(/);
  assert.match(finance, /await runOnce\(`pay-\$\{id\}`, async \(\) => \{[\s\S]*?pay_personal_reimbursement[\s\S]*?await loadFinance\(\);/);
  assert.match(finance, /<ConfirmDialog open=\{confirming\?\.kind === "pay"\}/);
});

test("finance: claim status buttons are off while a change runs, and Mark submitted asks first", async () => {
  const finance = await read("app/finance.tsx");
  for (const status of ["ready", "incomplete"]) {
    assert.match(finance, new RegExp(`disabled=\\{[^}]*changing\\} onClick=\\{\\(\\) => updateClaimStatus\\(claim, "${status}"\\)\\}`), `${status} button`);
  }
  assert.match(finance, /disabled=\{changing\} onClick=\{\(\) => setConfirming\(\{ kind: "submit", claim \}\)\}/);
  assert.doesNotMatch(finance, /updateClaimStatus\(claim, "submitted"\)\}>/, "submitting is only reachable through the confirmation");
  assert.match(finance, /await runOnce\(`claim-\$\{claim\.id\}-\$\{status\}`/);
  assert.match(finance, /<ConfirmDialog open=\{confirming\?\.kind === "submit"\}/);
  // Both confirmations stay open until the change is done.
  assert.match(finance, /busy=\{Boolean\(pendingKey\)\}/);
});

test("finance: the void buttons and the dialog submit cannot start a second change", async () => {
  const finance = await read("app/finance.tsx");
  assert.match(finance, /const changing = Boolean\(pendingKey\) \|\| actionBusy;/);
  assert.match(finance, /<PaymentLedger payments=\{filteredPayments\} onVoid=\{askVoidPayment\} disabled=\{changing\} \/>/);
  // ... and the ledger really puts that flag on its own Void button (passing it down is not enough).
  assert.match(functionSource(finance, "PaymentLedger"), /<button type="button" className="finance-row-action" disabled=\{disabled\} onClick=\{\(\) => onVoid\(payment\)\}[^>]*>Void<\/button>/);
  for (const label of ["Void payment", "Void claim"]) assert.match(finance, new RegExp(`disabled=\\{changing\\} onClick=\\{\\(\\) => askVoid(?:Payment|Claim)\\([a-z]+\\)\\}>${label}<`), label);
  assert.match(finance, /disabled=\{changing\} onClick=\{\(\) => askVoidExpense\(expense\)\}>Void</);
  // The dialog's own submit is guarded before the next render too.
  assert.match(finance, /async function runAction\(values: Record<string, string>\) \{[\s\S]*?await flight\.run\(/);
});

test("finance: removing a document reports a refused file delete instead of saying it was removed", async () => {
  const finance = await read("app/finance.tsx");
  // The record is already gone when the file is cleaned up, so the dialog closes and the leftover is the message.
  assert.match(finance, /warning: leftover \?\? undefined/);
  assert.match(finance, /if \(outcome\.warning\) notify\(outcome\.warning, "error"\)/);
  assert.doesNotMatch(finance, /storage\.from\("finance-private"\)\.remove/);
});

test("finance: a file that cannot be deleted after its record is gone says so, never 'try again' (round 3)", async () => {
  const finance = await read("app/finance.tsx");
  const ask = functionSource(finance, "FinancePage").match(/function askRemoveDocument[\s\S]*?\n {2}\}\n/)[0];
  // Refused (empty answer), a storage error and a network failure all get the same sentence.
  assert.match(ask, /removeStoredFile\("finance-private", removed\.data, \{ refusedMessage: FILE_LEFT_IN_STORAGE, failedMessage: FILE_LEFT_IN_STORAGE \}\)/);
  const sentence = finance.match(/const FILE_LEFT_IN_STORAGE = "([^"]+)"/)[1];
  assert.match(sentence, /removed from the request/);
  assert.match(sentence, /still in storage/);
  assert.doesNotMatch(sentence, /try again|retry/i);
  // The record is deleted first; only a delete that really happened leaves no warning.
  assert.ok(ask.indexOf('rpc("remove_finance_document"') < ask.indexOf("removeStoredFile("), "record first, file after");
  assert.match(ask, /if \(removed\.error \|\| typeof removed\.data !== "string"\) return \{ error: removed\.error \};/);
});

