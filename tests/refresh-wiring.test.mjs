import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

// frontend-6 and frontend-7: the pure rules (what a failed refresh keeps, which
// response is the newest) are tested in tests/load-state.test.mjs. These check
// that each screen uses them, because the screens are React components that
// cannot run under node --test.

test("finance keeps its lists when any query fails, and only the newest load may write", async () => {
  const finance = await read("app/finance.tsx");
  const guard = finance.indexOf("anyFailed([expenseResult");
  const firstSet = finance.indexOf("setExpenses(snapshot.expenses)");
  assert.ok(guard > 0 && firstSet > guard, "the failure check comes before any list is replaced");
  assert.match(finance.slice(guard, firstSet), /setLoadFailed\(true\)[\s\S]*return;/);
  assert.match(finance, /if \(!isCurrent\(\)\) return;/);
  assert.match(finance, /<LoadErrorBanner /);
  // The old behaviour wrote empty lists and only skipped the cache.
  assert.doesNotMatch(finance, /if \(failed\) notify\(/);
});

test("members, groups, admin and the dashboard keep a list that failed to load", async () => {
  const shell = await read("app/portal.tsx");
  assert.match(shell, /anyFailed\(\[memberResult, groupResult, membershipResult\]\)/);
  assert.doesNotMatch(shell, /setMembers\(next\.members\); setGroups\(next\.groups\); setMemberships\(next\.memberships\);\s*if \(!memberResult\.error/);
  assert.match(shell, /setArchive\(\(current\) => listOrKeep\(current, archiveResult/);
  assert.match(shell, /setResourceCount\(\(current\) => countOrKeep\(current, resourceCountResult\)\)/);
  assert.match(shell, /setMembers\(\(current\) => listOrKeep\(current, membersResult/);
  assert.match(shell, /setItems\(\(current\) => listOrKeep\(current, archiveResult/);
  // The old forms, which turned a failed query into an empty list.
  assert.doesNotMatch(shell, /setArchive\(items\)/);
  assert.doesNotMatch(shell, /setResourceCount\(resourceCountResult\.count \|\| 0\)/);
});

test("dashboard, workspace and directory loads drop answers that are no longer the newest", async () => {
  const shell = await read("app/portal.tsx");
  assert.match(shell, /const isCurrent = dataGate\.begin\(\);/);
  assert.match(shell, /if \(!isCurrent\(\) \|\| activeUserId\.current !== owner\) return;/);
  assert.match(shell, /const isCurrent = workspaceGate\.begin\(\);/);
  assert.match(shell, /const isCurrent = loadGate\.begin\(\);/);
  // A change of account makes everything still in flight stale.
  assert.match(shell, /dataGate\.cancel\(\); workspaceGate\.cancel\(\);/);
});

test("the recordings list drops stale search responses and keeps rows when a load fails", async () => {
  const workspace = await read("components/recordings/recording-workspace.tsx");
  assert.match(workspace, /const isCurrent = loadGate\.begin\(\);/);
  const answer = workspace.indexOf("const { data, error, count } = await request");
  assert.ok(answer > 0);
  const after = workspace.slice(answer, answer + 600);
  assert.ok(after.indexOf("if (!isCurrent()) return;") < after.indexOf("setRecordings(rows)"), "stale answers return before any state is set");
  assert.ok(after.indexOf("setLoadFailed(true)") < after.indexOf("setRecordings(rows)"), "a failure returns before the rows are replaced");
  assert.match(workspace, /<LoadErrorBanner /);
});

test("the resource library keeps the rows of the same list when a refresh fails and shows a banner over them", async () => {
  const resources = await read("app/resources.tsx");
  assert.match(resources, /keepRowsOnFailure\(shownKeyRef\.current, cacheKey\)/);
  assert.match(resources, /loadError && visibleItems\.length === 0/);
  assert.match(resources, /<LoadErrorBanner /);
  // The dashboard count is only reported from a successful head count (frontend-8).
  assert.match(resources, /if \(!live\.error && live\.count !== null\) onResourceCountChange\?\.\(live\.count\)/);
  assert.doesNotMatch(resources, /onResourceCountChange\?\.\(items\./);
  // The library is read one folder at a time, never as one unbounded tree (frontend-8).
  assert.doesNotMatch(resources, /select\(RESOURCE_FIELDS\)\.order\("is_pinned"/);
  assert.match(resources, /limit: RESOURCE_PAGE_SIZE/);
});
