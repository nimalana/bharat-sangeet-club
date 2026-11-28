// ApiError and toApiError: the one error the data layer (lib/api) throws. (must() in lib/api/_core.ts is tested in
// tests/component/api-core.test.ts: it imports ../errors without an extension, which node's type stripping cannot resolve.)
// What matters to a person is unchanged: friendlyError reads the ApiError exactly as it read the raw Supabase error.
import assert from "node:assert/strict";
import test from "node:test";
import { ApiError, friendlyError, toApiError } from "../lib/errors.ts";

const postgrest = (fields) => Object.assign(new Error(fields.message), { name: "PostgrestError", details: "", hint: "", code: "", ...fields });

test("ApiError is an Error that carries message, code, details, hint, status and the original as cause", () => {
  const original = new Error("boom");
  const error = new ApiError("Could not save", { code: "23505", details: "Key (x)=(1) exists", hint: "use another", status: 409, cause: original });
  assert.ok(error instanceof Error);
  assert.ok(error instanceof ApiError);
  assert.equal(error.name, "ApiError");
  assert.equal(error.message, "Could not save");
  assert.equal(error.code, "23505");
  assert.equal(error.details, "Key (x)=(1) exists");
  assert.equal(error.hint, "use another");
  assert.equal(error.status, 409);
  assert.equal(error.cause, original);
  assert.ok(String(error.stack).includes("Could not save"));
});

test("toApiError reads a PostgREST error: message, code, details and hint are kept, the original is the cause", () => {
  const raw = postgrest({ message: "Only administrators can change member roles", code: "P0001", details: "d", hint: "h" });
  const error = toApiError(raw, 400);
  assert.equal(error.message, "Only administrators can change member roles");
  assert.equal(error.code, "P0001");
  assert.equal(error.details, "d");
  assert.equal(error.hint, "h");
  assert.equal(error.status, 400);
  assert.equal(error.cause, raw);
});

test("toApiError reads a storage error (statusCode as a string, as the storage API sends it), a plain Error, a string and nothing", () => {
  assert.equal(toApiError({ message: "Object not found", statusCode: "404", error: "not_found" }).status, 404);
  assert.equal(toApiError({ message: "Payload too large", status: 413 }).status, 413);
  assert.equal(toApiError({ message: "x", status: "nonsense" }).status, undefined);
  for (const odd of [0, 99, 600, 1000, 404.5, -404, "", "  ", "4e2x"]) assert.equal(toApiError({ message: "x", status: odd }).status, undefined, `status ${JSON.stringify(odd)}`);
  assert.equal(toApiError({ message: "x", status: 100 }).status, 100);
  assert.equal(toApiError({ message: "x", status: 599 }).status, 599);
  assert.equal(toApiError({ message: "x" }, 503).status, 503);
  assert.equal(toApiError({ message: "x", status: 400 }, 503).status, 400);
  const plain = toApiError(new Error("Failed to fetch"));
  assert.equal(plain.message, "Failed to fetch");
  assert.equal(plain.code, undefined);
  assert.equal(toApiError("just text").message, "just text");
  for (const nothing of [null, undefined, 42, {}, { code: "42501" }]) {
    const error = toApiError(nothing);
    assert.ok(error instanceof ApiError);
    assert.equal(typeof error.message, "string");
  }
  assert.equal(toApiError(null).message, "");
});

test("toApiError returns an ApiError as it is (it is not wrapped twice)", () => {
  const error = new ApiError("x", { code: "1" });
  assert.equal(toApiError(error), error);
});

test("an empty code or detail is not kept as an empty string", () => {
  const error = toApiError(postgrest({ message: "m", code: "", details: "", hint: "" }));
  assert.equal(error.code, undefined);
  assert.equal(error.details, undefined);
  assert.equal(error.hint, undefined);
});

test("friendlyError says the same about the ApiError as about the raw error, for every kind of message it has a rule for", () => {
  const fallback = "That change could not be saved.";
  const raws = [
    { message: "Only administrators can change member roles", code: "P0001" },
    { message: 'duplicate key value violates unique constraint "subgroups_name_key"', code: "23505" },
    { message: "A group with that name already exists", code: "23505" },
    { message: 'update or delete on table "profiles" violates foreign key constraint', code: "23503" },
    { message: 'new row violates row-level security policy for table "events"', code: "42501" },
    { message: "permission denied for table finance_payments", code: "42501" },
    { message: "TypeError: Failed to fetch" },
    { message: "NetworkError when attempting to fetch resource." },
    { message: "JWT expired", code: "PGRST301" },
    { message: 'column "x" does not exist', code: "42703" },
    { message: "could not find the function in the schema cache" },
    { message: "" },
    { message: "   " },
    { message: "session is not open" },
    { code: "23505" },
  ];
  for (const raw of raws) {
    assert.equal(friendlyError(toApiError(raw), fallback), friendlyError(raw, fallback), JSON.stringify(raw));
    assert.equal(friendlyError(toApiError(postgrest({ message: raw.message ?? "", code: raw.code ?? "" })), fallback), friendlyError(raw, fallback), `postgrest-shaped ${JSON.stringify(raw)}`);
  }
  assert.equal(friendlyError(toApiError(null), fallback), fallback);
  assert.equal(friendlyError(toApiError(new Error("Failed to fetch"))), "The connection dropped. Check your internet and try again.");
});

// Phase 4.2: the sentences the finance functions added raise. friendlyError replaces anything that looks like a raw database
// message, so each of these is checked to reach the person as written (the first letter in capitals, as it always did). The
// same list is checked from the database side in supabase/tests/81_finance_register.test.sql (test.raw_looking).
test("every sentence register_finance_document and the Phase 4.2 finance rules raise reaches the person as it was written", () => {
  const raised = [
    ["authentication required", "42501"],
    ["Your access to the portal has been deactivated", "42501"],
    ["Choose what kind of document this is", "22023"],
    ["Give the document a title of 180 characters or fewer", "22023"],
    ["Choose a document to upload", "22023"],
    ["Finance documents must be 10 MB or smaller", "22023"],
    ["Upload a PDF, JPEG or PNG file", "22023"],
    ["Statements must be uploaded as PDF documents, not screenshots", "22023"],
    ["card last four must contain four digits", "22023"],
    ["Attach the document to a purchase, a reimbursement request or a funding claim", "22023"],
    ["The file must be stored in your own folder", "42501"],
    ["Reimbursement request not found", "P0002"],
    ["That request belongs to a different purchase", "22023"],
    ["This request has already been decided, so documents can no longer be added", "22023"],
    ["Expense not found", "P0002"],
    ["This purchase has been voided, so documents can no longer be added", "22023"],
    ["This purchase has already been decided, so documents can no longer be added", "22023"],
    ["This expense is on a funding claim that has been submitted, so its documents are locked", "22023"],
    ["This request is part of a funding claim, so documents cannot be added. Ask an executive.", "22023"],
    ["executive permission required", "42501"],
    ["funding claim not found", "P0002"],
    ["This funding claim has been voided, so documents can no longer be added", "22023"],
    ["This funding claim is with the funder, so its documents are locked. Only the HeelLife submission and proof of payment can be added now.", "22023"],
    ["The file was not found in storage. Upload it again.", "22023"],
    ["That file was uploaded by someone else", "42501"],
    ["This file has already been registered as a finance document", "23505"],
    ["An event purchase needs the event name, date and time, number of attendees and schedule", "22023"],
    ["You cannot pay your own reimbursement. Ask another executive.", "42501"],
  ];
  for (const [message, code] of raised) {
    assert.equal(friendlyError({ message, code }), message[0].toUpperCase() + message.slice(1), `${code}: ${message}`);
  }
});
