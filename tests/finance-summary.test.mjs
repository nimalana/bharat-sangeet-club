import assert from "node:assert/strict";
import test from "node:test";
import { FINANCE_ANSWERS, financeRefreshFailed } from "../lib/finance-load.ts";

const ok = () => Object.fromEntries(FINANCE_ANSWERS.map((name) => [name, { data: [], error: null }]));

// frontend-6, round 2: when only the get_finance_summary RPC failed, the lists
// still loaded, so the refresh was applied and the cards switched from the
// database totals to sums of the loaded lists (the latest 500 payments).
// First view $1,300.00, then a refresh with a failed RPC and one $100 payment
// showed $100.00 with no banner.

test("a refresh where every answer arrived is applied", () => {
  assert.equal(financeRefreshFailed(ok()), false);
});

test("a failed summary RPC alone makes the refresh a failed one", () => {
  const answers = { ...ok(), summary: { data: null, error: { message: "timeout" } } };
  assert.equal(financeRefreshFailed(answers), true);
});

test("each of the eleven answers failing on its own makes the refresh a failed one", () => {
  assert.equal(FINANCE_ANSWERS.length, 11);
  for (const name of FINANCE_ANSWERS) {
    assert.equal(financeRefreshFailed({ ...ok(), [name]: { data: null, error: { message: "x" } } }), true, `${name} failing must count`);
  }
});

test("a missing answer is not mistaken for a failure", () => {
  assert.equal(financeRefreshFailed({ ...ok(), summary: null }), false);
  assert.equal(financeRefreshFailed({ ...ok(), claims: undefined }), false);
});
