import assert from "node:assert/strict";
import test from "node:test";
import { REFRESH_WAIT_MS, waitAtMost } from "../lib/bounded-wait.ts";

// frontend (round 3): the Mark paid confirmation and the finance dialogs stayed
// busy until the list read finished, with no limit. waitAtMost is that limit.

const never = () => new Promise(() => {});

test("the limit is 15 seconds", () => {
  assert.equal(REFRESH_WAIT_MS, 15_000);
});

test("work that finishes in time is 'settled', at once, without waiting for the limit", async () => {
  const started = Date.now();
  assert.equal(await waitAtMost(Promise.resolve("rows"), 60_000), "settled");
  assert.ok(Date.now() - started < 1000);
});

test("a wait that settles in time leaves no timer behind", async () => {
  const started = new Set();
  const realSet = globalThis.setTimeout;
  const realClear = globalThis.clearTimeout;
  globalThis.setTimeout = (...args) => { const id = realSet(...args); started.add(id); return id; };
  globalThis.clearTimeout = (id) => { started.delete(id); realClear(id); };
  try {
    assert.equal(await waitAtMost(Promise.resolve(), 60_000), "settled");
    await assert.rejects(waitAtMost(Promise.reject(new Error("x")), 60_000), /x/);
    assert.equal(started.size, 0, "the limit's timer is cleared once the work has settled");
  } finally { globalThis.setTimeout = realSet; globalThis.clearTimeout = realClear; for (const id of started) realClear(id); }
});

test("work that never finishes ends the wait at the limit, and not a moment before", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let result = null;
  const waiting = waitAtMost(never(), REFRESH_WAIT_MS).then((value) => { result = value; });
  t.mock.timers.tick(REFRESH_WAIT_MS - 1);
  await Promise.resolve();
  assert.equal(result, null, "still waiting one millisecond before the limit");
  t.mock.timers.tick(1);
  await waiting;
  assert.equal(result, "timeout");
});

test("work that finishes after the limit changes nothing and raises nothing", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const unhandled = [];
  const listener = (reason) => unhandled.push(reason);
  process.on("unhandledRejection", listener);
  try {
    let finish; let fail;
    const slowOk = new Promise((resolve) => { finish = resolve; });
    const slowBad = new Promise((_, reject) => { fail = reject; });
    const first = waitAtMost(slowOk, 100);
    const second = waitAtMost(slowBad, 100);
    t.mock.timers.tick(100);
    assert.equal(await first, "timeout");
    assert.equal(await second, "timeout");
    finish("late rows");
    fail(new Error("late failure"));
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(unhandled, [], "a late failure has nobody to tell and must not become an unhandled rejection");
  } finally { process.off("unhandledRejection", listener); }
});

test("a failure that arrives in time is passed on, as it was before the limit existed", async () => {
  await assert.rejects(waitAtMost(Promise.reject(new Error("boom")), 60_000), /boom/);
});
