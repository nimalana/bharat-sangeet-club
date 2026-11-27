import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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

// The shell must use the outcome: no default-role member shell before it, a
// retry screen on failure, the deactivated screen when the profile says so.
test("the shell waits for the answer, retries on failure and shows the deactivated screen", async () => {
  const shell = await readFile(new URL("../app/portal.tsx", import.meta.url), "utf8");
  assert.match(shell, /runBootstrap<PortalBootstrap>\(\(\) => client\.rpc\("get_portal_bootstrap"\)\)/);
  assert.match(shell, /if \(shellState === "deactivated"\) return <DeactivatedScreen/);
  assert.match(shell, /if \(shellState === "failed"\) return <BootstrapFailedScreen/);
  assert.match(shell, /if \(shellState === "loading"\) return <LoadingScreen \/>/);
  // The failure branch no longer falls through to the member shell with a toast.
  assert.doesNotMatch(shell, /We could not load your club profile"\); return; \}/);
  // The signed-in shell is only reached once the state is ready.
  assert.ok(shell.indexOf('shellState === "loading") return <LoadingScreen') < shell.indexOf('<main className="portal-shell">'));
});
