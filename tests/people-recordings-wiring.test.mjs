import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

// Group people, recordings and resources, round 2. These screens are React
// components and cannot run under node --test, so these check the wiring. The
// rules are tested as pure code in single-flight.test.mjs, storage-remove.test.mjs
// and load-state.test.mjs.

test("group people: Decline asks first, and one change runs at a time", async () => {
  const people = await read("components/subgroups/group-people.tsx");
  assert.match(people, /onClick=\{\(\) => setPending\(\{ kind: "decline", row \}\)\}/);
  assert.doesNotMatch(people, /onClick=\{\(\) => review\(row, "decline"\)\}/);
  assert.match(people, /<ConfirmDialog open=\{pending\?\.kind === "decline"\}/);
  assert.match(people, /const outcome = await flight\.run\(async \(\) => \{\s*setBusyKey\(key\);/);
  // Saving the settings shares the guard with the other changes.
  assert.match(people, /const outcome = await flight\.run\(async \(\) => \{\s*setBusyKey\("settings"\);/);
  assert.doesNotMatch(people, /if \(busyKey\) return false;/, "the state check is replaced by the guard that changes at once");
});

test("the notation list drops stale reloads and keeps what is shown when a reload fails (frontend-7)", async () => {
  const workspace = await read("components/recordings/recording-workspace.tsx");
  assert.match(workspace, /const isCurrent = notesGate\.begin\(\);[\s\S]*?if \(!isCurrent\(\)\) return;[\s\S]*?setNotes\(/);
  assert.match(workspace, /if \(error\) \{ notify\("The notation could not be refreshed[^"]*", "error"\); return; \}/);
  assert.doesNotMatch(workspace, /if \(!error\) setNotes\(/);
  const people = await read("components/subgroups/group-people.tsx");
  assert.match(people, /const isCurrent = loadGate\.begin\(\);[\s\S]*?if \(!isCurrent\(\)\) return;/);
});

// Every caller goes through the helper. A new `.remove([` on a storage bucket
// that skips it brings the old bug back.

async function sourceFiles(directory) {
  const out = [];
  for (const entry of await readdir(new URL(`../${directory}`, import.meta.url), { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) out.push(...(await sourceFiles(path)));
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(path);
  }
  return out;
}

// app/attendance.tsx rolls back an upload with a bare remove(); that screen belongs to the attendance fix.
const KNOWN_OUTSIDE_THE_HELPER = new Set(["app/attendance.tsx"]);

test("no storage remove([...]) call outside the helper (the attendance screen is tracked separately)", async () => {
  const offenders = [];
  for (const path of [...(await sourceFiles("app")), ...(await sourceFiles("components")), ...(await sourceFiles("lib"))]) {
    if (path === "lib/storage-remove.ts") continue;
    const source = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
    if (/\.remove\(\s*\[/.test(source) && !KNOWN_OUTSIDE_THE_HELPER.has(path)) offenders.push(path);
  }
  assert.deepEqual(offenders, []);
});

test("the recording and resource screens delete files through the helper and show its sentence", async () => {
  assert.match(await read("components/recordings/club-archive-manager.tsx"), /removeStoredFile\("club-archive", deleting\.storage_path, \{ confirmGone: true \}\)/);
  assert.match(await read("components/resources/resource-actions.tsx"), /removeStoredFile\(bucket, item\.storage_path, \{ confirmGone: true \}\)/);
  const manage = await read("components/recordings/recording-manage.tsx");
  assert.match(manage, /removeStoredFile\(bucket, path, \{ confirmGone: true \}\)/);
  assert.doesNotMatch(manage, /async function removeStoredFile/, "one implementation, not a copy per screen");
});

test("the recording studio never removes the take of a recording that was saved", async () => {
  const workspace = await readFile(new URL("../components/recordings/recording-workspace.tsx", import.meta.url), "utf8");
  // Before: any failure after the row was saved (for example while adding notation) removed the file the row points to.
  assert.doesNotMatch(workspace, /if \(storagePath && file\) await supabase\.storage/);
  assert.match(workspace, /if \(uploadedTake && !recordSaved\)/);
  assert.match(workspace, /if \(notationUploaded && !noteSaved && notationPath\)/);
});
