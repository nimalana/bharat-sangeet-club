import assert from "node:assert/strict";
import test from "node:test";
import { interpretBootstrap, runBootstrap } from "../lib/bootstrap.ts";

// frontend-4: when get_portal_bootstrap failed, the shell stayed on its default
// "member" role and showed the full member navigation, even to a deactivated
// account. The answer now decides, and a missing answer is an error with Retry.

const profile = (overrides = {}) => ({ full_name: "Asha", role: "executive", status: "active", ...overrides });
const answer = (data, error = null) => ({ data, error });

test("an active profile opens the shell with the role the database returned", () => {
  const outcome = interpretBootstrap(answer({ profile: profile(), groups: [], resource_count: 3 }));
  assert.equal(outcome.kind, "ready");
  assert.equal(outcome.boot.profile.role, "executive");
  assert.equal(outcome.boot.resource_count, 3);
});

test("a deactivated profile gets the deactivated screen, whatever else came back", () => {
  assert.deepEqual(interpretBootstrap(answer({ profile: profile({ status: "deactivated" }), groups: [] })), { kind: "deactivated" });
  assert.deepEqual(interpretBootstrap(answer({ profile: { status: "deactivated" } })), { kind: "deactivated" });
});

test("a sign-up waiting for approval gets the pending screen, a declined one the rejected screen, whatever else came back", () => {
  assert.deepEqual(interpretBootstrap(answer({ profile: profile({ status: "pending", role: "member" }), groups: [] })), { kind: "pending" });
  assert.deepEqual(interpretBootstrap(answer({ profile: { status: "pending" } })), { kind: "pending" });
  assert.deepEqual(interpretBootstrap(answer({ profile: profile({ status: "rejected", role: "member" }) })), { kind: "rejected" });
  assert.deepEqual(interpretBootstrap(answer({ profile: { status: "rejected" } })), { kind: "rejected" });
  // Never the member shell: not even when the answer claims a role the database does not allow for a sign-up, and the data that came with it is dropped.
  const odd = interpretBootstrap(answer({ profile: profile({ status: "pending", role: "admin" }), groups: [{ id: 1 }], resource_count: 9 }));
  assert.deepEqual(odd, { kind: "pending" });
});

test("an error is a failure, never the member shell", () => {
  assert.deepEqual(interpretBootstrap(answer(null, { message: "Failed to fetch" })), { kind: "failed" });
  // Even if some data came back with the error.
  assert.deepEqual(interpretBootstrap(answer({ profile: profile() }, { message: "500" })), { kind: "failed" });
});

test("no profile, no data or an unknown role or status is a failure", () => {
  assert.deepEqual(interpretBootstrap(answer({ profile: null })), { kind: "failed" });
  assert.deepEqual(interpretBootstrap(answer(null)), { kind: "failed" });
  assert.deepEqual(interpretBootstrap(answer(undefined)), { kind: "failed" });
  assert.deepEqual(interpretBootstrap(answer("oops")), { kind: "failed" });
  assert.deepEqual(interpretBootstrap(answer([])), { kind: "failed" });
  assert.deepEqual(interpretBootstrap(answer({ profile: profile({ role: "superuser" }) })), { kind: "failed" });
  assert.deepEqual(interpretBootstrap(answer({ profile: profile({ role: undefined }) })), { kind: "failed" });
  assert.deepEqual(interpretBootstrap(answer({ profile: profile({ status: "suspended" }) })), { kind: "failed" });
});

test("a request that throws is a failure and the call returns", async () => {
  assert.deepEqual(await runBootstrap(() => Promise.reject(new TypeError("Failed to fetch"))), { kind: "failed" });
  assert.deepEqual(await runBootstrap(() => { throw new Error("sync"); }), { kind: "failed" });
  assert.equal((await runBootstrap(() => Promise.resolve(answer({ profile: profile({ role: "admin" }) })))).kind, "ready");
});
