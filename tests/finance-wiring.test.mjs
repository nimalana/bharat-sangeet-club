import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

// frontend-6 and frontend-10 (round 2) for the Finance screen. The screen is a
// React component and cannot run under node --test, so these check the wiring.
// The rules it uses are tested as pure code in finance-summary.test.mjs,
// single-flight.test.mjs and storage-remove.test.mjs.

test("the Finance screen decides with that rule and keeps the last good totals when it fails", async () => {
  const finance = await read("app/finance.tsx");
  const decide = finance.indexOf("financeRefreshFailed({");
  const firstSet = finance.indexOf("setExpenses(snapshot.expenses)");
  assert.ok(decide > 0 && firstSet > decide, "the failure check comes before any list or total is replaced");
  const between = finance.slice(decide, firstSet);
  assert.match(between, /summary: summaryResult/);
  assert.match(between, /setLoadFailed\(true\)[\s\S]*return;/);
  assert.match(finance, /setSummary\(snapshot\.summary\)/);
  assert.ok(finance.indexOf("setSummary(snapshot.summary)") > decide, "the totals are only replaced after the check");
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
  for (const label of ["Void payment", "Void claim"]) assert.match(finance, new RegExp(`disabled=\\{changing\\} onClick=\\{\\(\\) => askVoid(?:Payment|Claim)\\([a-z]+\\)\\}>${label}<`), label);
  assert.match(finance, /disabled=\{changing\} onClick=\{\(\) => askVoidExpense\(expense\)\}>Void</);
  // The dialog's own submit is guarded before the next render too.
  assert.match(finance, /async function runAction\(values: Record<string, string>\) \{[\s\S]*?await flight\.run\(/);
});

test("finance: removing a document reports a refused file delete instead of saying it was removed", async () => {
  const finance = await read("app/finance.tsx");
  assert.match(finance, /removeStoredFile\("finance-private", removed\.data/);
  // The record is already gone when the file is cleaned up, so the dialog closes and the leftover is the message.
  assert.match(finance, /warning: leftover \?\? undefined/);
  assert.match(finance, /if \(outcome\.warning\) notify\(outcome\.warning, "error"\)/);
  assert.doesNotMatch(finance, /storage\.from\("finance-private"\)\.remove/);
});
