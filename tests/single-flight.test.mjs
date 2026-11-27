import assert from "node:assert/strict";
import test from "node:test";
import { createSingleFlight } from "../lib/single-flight.ts";

// frontend-10: Mark paid and the claim status buttons could be clicked twice
// before the first request finished. The server refuses the second call, but
// the person saw an error toast over the success one.

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("a second run while one is in progress does nothing", async () => {
  const flight = createSingleFlight();
  let calls = 0;
  const first = flight.run(async () => { calls += 1; await pause(20); return "paid"; });
  assert.equal(flight.busy, true);
  const second = await flight.run(async () => { calls += 1; return "paid again"; });
  assert.deepEqual(second, { ran: false });
  assert.deepEqual(await first, { ran: true, value: "paid" });
  assert.equal(calls, 1);
});

test("a double click in the same tick starts the action once", async () => {
  const flight = createSingleFlight();
  let calls = 0;
  const click = () => flight.run(async () => { calls += 1; await pause(5); });
  const results = await Promise.all([click(), click()]);
  assert.equal(calls, 1);
  assert.deepEqual(results.map((result) => result.ran), [true, false]);
});

test("the next run is allowed once the first one finished", async () => {
  const flight = createSingleFlight();
  await flight.run(async () => 1);
  assert.equal(flight.busy, false);
  assert.deepEqual(await flight.run(async () => 2), { ran: true, value: 2 });
});

test("a run that throws still frees the guard", async () => {
  const flight = createSingleFlight();
  await assert.rejects(flight.run(async () => { throw new Error("network"); }), /network/);
  assert.equal(flight.busy, false);
  assert.deepEqual(await flight.run(async () => "ok"), { ran: true, value: "ok" });
});
