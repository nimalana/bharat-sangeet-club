import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

// The portal shell (app/portal.tsx), round 2. The shell is a React component
// and cannot run under node --test, so these check the wiring; the rules are
// tested as pure code in toast.test.mjs and load-state.test.mjs.

test("the portal shows the tick by tone and announces failures as alerts", async () => {
  const shell = await read("app/portal.tsx");
  assert.match(shell, /toastMark\[toast\.tone\]/);
  assert.match(shell, /role=\{toast\.tone === "error" \? "alert" : "status"\}/);
  assert.doesNotMatch(shell, /role="status">✓ \{toast\}/, "no unconditional tick");
});

test("the admin and group lists drop answers that are no longer the newest (frontend-7)", async () => {
  const shell = await read("app/portal.tsx");
  const loaders = [
    ["AdminPage", /function AdminPage[\s\S]*?const load = useCallback\(async \(\) => \{\s*if \(!supabase\) return;\s*const isCurrent = loadGate\.begin\(\);[\s\S]*?if \(!isCurrent\(\)\) return;/],
    ["SubgroupSpaces", /function SubgroupSpaces[\s\S]*?const load = useCallback\(async \(\) => \{\s*if \(!supabase\) return;\s*const isCurrent = loadGate\.begin\(\);[\s\S]*?if \(!isCurrent\(\)\) return;/],
  ];
  for (const [name, pattern] of loaders) assert.match(shell, pattern, name);
});

test("the dashboard, workspace, directory and recordings loaders keep their guards (round 1)", async () => {
  const shell = await read("app/portal.tsx");
  assert.match(shell, /const isCurrent = dataGate\.begin\(\);/);
  assert.match(shell, /const isCurrent = workspaceGate\.begin\(\);/);
  assert.match(shell, /const isCurrent = loadGate\.begin\(\);/);
  assert.match(await read("components/recordings/recording-workspace.tsx"), /const isCurrent = loadGate\.begin\(\);/);
});

test("a club recording whose row could not be saved reports a file that could not be cleaned up", async () => {
  const shell = await read("app/portal.tsx");
  assert.match(shell, /removeStoredFile\("club-archive", storagePath/);
  assert.doesNotMatch(shell, /storage\.from\("club-archive"\)\.remove/);
});
