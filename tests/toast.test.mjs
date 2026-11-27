import assert from "node:assert/strict";
import test from "node:test";
import { toastDuration, toastMark, toastTone } from "../lib/toast.ts";

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
