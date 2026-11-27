import assert from "node:assert/strict";
import test from "node:test";
import { createRequestGate } from "../lib/request-gate.ts";
import { anyFailed, countOrKeep, keepRowsOnFailure, listOrKeep } from "../lib/refresh.ts";
import { isChunkLoadError } from "../lib/chunk-errors.ts";

// frontend-7: an older response that arrives last must not replace a newer one.

test("only the newest request is current", () => {
  const gate = createRequestGate();
  const first = gate.begin();
  assert.equal(first(), true);
  const second = gate.begin();
  assert.equal(first(), false, "starting another request makes the first stale");
  assert.equal(second(), true);
});

test("cancel makes every request in flight stale", () => {
  const gate = createRequestGate();
  const a = gate.begin();
  gate.cancel();
  assert.equal(a(), false);
  const b = gate.begin();
  assert.equal(b(), true);
});

test("responses that arrive out of order leave the newest answer on screen", async () => {
  const gate = createRequestGate();
  let shown = null;
  const search = (term, delay) => {
    const current = gate.begin();
    return new Promise((resolve) => setTimeout(resolve, delay)).then(() => { if (current()) shown = term; });
  };
  // "bhairavi" is slow, "bhairav" (typed after it) is fast: the slow one lands last.
  await Promise.all([search("bhairavi", 30), search("bhairav", 5)]);
  assert.equal(shown, "bhairav");
});

test("gates are independent", () => {
  const one = createRequestGate();
  const two = createRequestGate();
  const a = one.begin();
  two.begin();
  assert.equal(a(), true);
});

// frontend-6: a failed refresh replaced good data with empty data.

test("a failed list refresh keeps the rows already shown", () => {
  const shown = [{ id: 1 }, { id: 2 }];
  assert.equal(listOrKeep(shown, { data: null, error: { message: "Failed to fetch" } }), shown);
  assert.equal(listOrKeep(shown, { data: [], error: { message: "timeout" } }), shown);
  assert.equal(listOrKeep(shown, { data: null, error: null }), shown);
});

test("a successful refresh replaces the rows, even with an empty list", () => {
  const shown = [{ id: 1 }];
  const next = [{ id: 7 }];
  assert.equal(listOrKeep(shown, { data: next, error: null }), next);
  assert.deepEqual(listOrKeep(shown, { data: [], error: null }), []);
});

test("a failed count keeps the previous count; a real zero is accepted", () => {
  assert.equal(countOrKeep(42, { count: null, error: { message: "x" } }), 42);
  assert.equal(countOrKeep(42, { count: 0, error: { message: "x" } }), 42);
  assert.equal(countOrKeep(42, { count: undefined, error: null }), 42);
  assert.equal(countOrKeep(42, { count: 0, error: null }), 0);
  assert.equal(countOrKeep(42, { count: 7, error: null }), 7);
});

test("anyFailed notices one failure among many results", () => {
  assert.equal(anyFailed([{ error: null }, { error: undefined }, null, undefined]), false);
  assert.equal(anyFailed([{ error: null }, { error: { message: "x" } }]), true);
  assert.equal(anyFailed([]), false);
});

test("rows are kept on failure only for the view they were loaded for", () => {
  assert.equal(keepRowsOnFailure("resources:list:3:all", "resources:list:3:all"), true);
  assert.equal(keepRowsOnFailure("resources:list:3:all", "resources:list:4:all"), false);
  assert.equal(keepRowsOnFailure(null, "resources:list:3:all"), false);
});

// frontend-5: a chunk that cannot be fetched is told apart from other errors.

test("chunk and dynamic-import failures are recognised", () => {
  assert.equal(isChunkLoadError(Object.assign(new Error("x"), { name: "ChunkLoadError" })), true);
  assert.equal(isChunkLoadError(new Error("Loading chunk 123 failed.\n(error: https://x/_next/static/chunks/123.js)")), true);
  assert.equal(isChunkLoadError(new TypeError("Failed to fetch dynamically imported module: https://x/a.js")), true);
  assert.equal(isChunkLoadError(new Error("error loading dynamically imported module")), true);
  assert.equal(isChunkLoadError(new TypeError("Importing a module script failed.")), true);
});

test("ordinary render errors are not chunk errors", () => {
  assert.equal(isChunkLoadError(new Error("Cannot read properties of undefined")), false);
  assert.equal(isChunkLoadError(new TypeError("x is not a function")), false);
  assert.equal(isChunkLoadError(null), false);
  assert.equal(isChunkLoadError(undefined), false);
  assert.equal(isChunkLoadError("Loading chunk 1 failed"), false);
});
