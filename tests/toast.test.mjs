import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { friendlyError } from "../lib/errors.ts";
import { pushToast, TOAST_LIMIT, toastDuration, toastMark, toastTone } from "../lib/toast.ts";

// The shell put a tick in front of every toast, so "Some finance records could
// not be loaded" looked like a success.

test("an explicit tone always wins", () => {
  assert.equal(toastTone("Payment voided", "error"), "error");
  assert.equal(toastTone("The file could not be deleted", "success"), "success");
});

test("messages that say something failed are errors", () => {
  for (const message of [
    "Some finance records could not be loaded",
    "The club data could not be loaded. Check your connection and try again.",
    "This file could not be opened",
    "The file could not be deleted, so nothing was removed.",
    "That folder could not be found",
    "Request saved; Finance documents must be 10 MB or smaller",
    "3 files uploaded; 1 failed",
    "You do not have permission to edit this recording.",
    "Failed to fetch",
    "A claim that is submitted cannot be marked submitted",
    "approved reimbursement not found",
    "Finance storage is unavailable",
    "new row violates row-level security policy",
  ]) assert.equal(toastTone(message), "error", message);
});

test("requests to the person are not successes", () => {
  for (const message of [
    "Choose a file to upload",
    "Select at least one expense for this claim",
    "Enter a complete web address.",
    "Give this recording a title first",
    "Upload a file or record something before saving",
    "Complete every required claim document first",
    "No unclaimed expenses are available",
  ]) assert.equal(toastTone(message), "error", message);
});

test("ordinary confirmations keep their tick", () => {
  for (const message of [
    "Reimbursement marked paid", "Funding claim updated", "Payment voided", "Document removed", "Saved to the club archive",
    "Welcome to Carnatic Vocal", "Asha Rao was updated", "Absence form denied", "A new code is active", "Mark cleared",
    "Link added to Resources", "2 files uploaded", "Check-in is open",
  ]) assert.equal(toastTone(message), "success", message);
});

test("only a success wears the tick; failures stay on screen longer", () => {
  assert.equal(toastMark.success, "✓");
  assert.notEqual(toastMark.error, "✓");
  assert.ok(toastDuration("error") > toastDuration("success"));
});

test("a failure has no time limit (it stays until dismissed or replaced); a confirmation fades after 2.8 s", () => {
  assert.equal(toastDuration("error"), Infinity);
  assert.equal(toastDuration("success"), 2800);
});

// The stack of toasts on screen (components/ui/toast.tsx draws it): oldest first, at most TOAST_LIMIT.
const item = (id, message, tone = "success") => ({ id, message, tone });
const ids = (list) => list.map((shown) => shown.id);

test("a toast goes on the end of the stack; nothing leaves while there is room", () => {
  assert.equal(TOAST_LIMIT, 3);
  const { list, removed } = pushToast([item(1, "A"), item(2, "B")], item(3, "C"));
  assert.deepEqual(ids(list), [1, 2, 3]);
  assert.deepEqual(removed, []);
});

test("a failure replaces the failure before it, wherever it stands in the stack, and leaves the confirmations", () => {
  const { list, removed } = pushToast([item(1, "A"), item(2, "old failure", "error"), item(3, "C")], item(4, "new failure", "error"));
  assert.deepEqual(ids(list), [1, 3, 4]);
  assert.deepEqual(removed, [2]);
});

test("the same confirmation again replaces its earlier copy; the same words as a failure are another toast", () => {
  assert.deepEqual(ids(pushToast([item(1, "Saved"), item(2, "B")], item(3, "Saved")).list), [2, 3]);
  assert.deepEqual(ids(pushToast([item(1, "Saved", "error")], item(2, "Saved")).list), [1, 2]);
});

test("past the limit the oldest confirmation goes first, and a failure stays while any confirmation can go", () => {
  const full = [item(1, "A"), item(2, "failure", "error"), item(3, "C")];
  const { list, removed } = pushToast(full, item(4, "D"));
  assert.deepEqual(ids(list), [2, 3, 4]);
  assert.deepEqual(removed, [1]);
  const next = pushToast(list, item(5, "E"));
  assert.deepEqual(ids(next.list), [2, 4, 5]);
  assert.deepEqual(next.removed, [3]);
});

test("the limit can be given; with nothing but failures to drop the oldest goes", () => {
  assert.deepEqual(ids(pushToast([item(1, "A"), item(2, "B")], item(3, "C"), 2).list), [2, 3]);
  assert.deepEqual(ids(pushToast([item(1, "x", "error")], item(2, "y", "error"), 1).list), [2]);
  assert.deepEqual(ids(pushToast([item(1, "A")], item(2, "f", "error"), 1).list), [2]);
});

test("pushToast does not change the list it is given", () => {
  const before = [item(1, "A"), item(2, "B", "error")];
  const copy = JSON.stringify(before);
  pushToast(before, item(3, "C", "error"));
  assert.equal(JSON.stringify(before), copy);
});

// Text that comes from the database cannot be classified by its words. These are the
// messages the migrations actually raise, as a member sees them through friendlyError.
async function migrationMessages() {
  const dir = new URL("../supabase/migrations/", import.meta.url);
  const messages = new Set();
  for (const name of (await readdir(dir)).filter((file) => file.endsWith(".sql"))) {
    const sql = await readFile(new URL(name, dir), "utf8");
    // raise exception '...' (doubled quotes stand for one quote; % marks a value filled in at run time)
    for (const match of sql.matchAll(/raise\s+exception\s+'((?:[^']|'')*)'/gi)) messages.add(match[1].replaceAll("''", "'").replaceAll("%", "x"));
  }
  return [...messages];
}

test("the migrations' own messages are found (the check below must not pass on an empty list)", async () => {
  const messages = await migrationMessages();
  assert.ok(messages.length > 100, `${messages.length} messages`);
  assert.ok(messages.includes("Only administrators can change member roles"));
});

test("a database message shown through the error path is an error, whatever it says", async (t) => {
  const messages = await migrationMessages();
  // What every call site does with a database error: friendlyError(error, fallback), tagged "error".
  for (const message of messages) {
    const shown = friendlyError({ message }, "That change could not be saved.");
    assert.ok(shown.trim().length > 0, `friendlyError left nothing to show for: ${message}`);
    assert.equal(toastTone(shown, "error"), "error", message);
  }
  // Why the tag is needed: read by its words alone, many of these would wear the success tick.
  const guessedWrong = messages.filter((message) => toastTone(friendlyError({ message }, "x")) === "success");
  t.diagnostic(`${guessedWrong.length} of ${messages.length} database messages would be guessed as success without the tag`);
});

test("the guess stays a fallback: it never overrides a tone and still reads fixed screen messages", () => {
  assert.equal(toastTone("Only administrators can change member roles", "error"), "error");
  assert.equal(toastTone("Document removed"), "success");
  assert.equal(toastTone("The change could not be saved"), "error");
});
