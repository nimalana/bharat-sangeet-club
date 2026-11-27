import assert from "node:assert/strict";
import test from "node:test";
import { FILE_NOT_DELETED, judgeRemove, removeAndVerify } from "../lib/storage-remove.ts";

// A real-Supabase run showed that storage.remove() answers 200 and [] when a
// delete policy refuses the object. Only `error` was checked, so a refused
// delete was reported to the person as a deleted file.

const describeError = (error) => `ERR:${error?.message ?? "unknown"}`;

// A fake bucket. `removeAnswer` is what remove() returns; `signable` says whether the file can still be signed.
function fakeClient({ removeAnswer, signable = false, signThrows = false, removeThrows = false }) {
  const calls = { remove: [], sign: [] };
  const client = {
    storage: {
      from: (bucket) => ({
        remove: async (paths) => { calls.remove.push([bucket, ...paths]); if (removeThrows) throw new Error("Failed to fetch"); return removeAnswer; },
        createSignedUrl: async (path) => { calls.sign.push([bucket, path]); if (signThrows) throw new Error("offline"); return { data: signable ? { signedUrl: "https://x/y" } : null, error: signable ? null : { message: "Object not found" } }; },
      }),
    },
  };
  return { client, calls };
}

test("a row returned for the path means the file was removed", () => {
  assert.equal(judgeRemove({ data: [{ name: "a/b.pdf" }], error: null }), "removed");
});

test("an empty list with no error is not a removal", () => {
  assert.equal(judgeRemove({ data: [], error: null }), "nothing_removed");
  assert.equal(judgeRemove({ data: null, error: null }), "nothing_removed");
});

test("an error is an error, even when rows came back", () => {
  assert.equal(judgeRemove({ data: [{}], error: { message: "x" } }), "error");
  assert.equal(judgeRemove(null), "error");
  assert.equal(judgeRemove(undefined), "error");
});

test("several paths need a row each", () => {
  assert.equal(judgeRemove({ data: [{}], error: null }, 2), "nothing_removed");
  assert.equal(judgeRemove({ data: [{}, {}], error: null }, 2), "removed");
});

test("removed file: nothing to tell the person", async () => {
  const { client, calls } = fakeClient({ removeAnswer: { data: [{ name: "p" }], error: null } });
  assert.equal(await removeAndVerify(client, "finance-private", "u/p.pdf", { describeError }), null);
  assert.deepEqual(calls.remove, [["finance-private", "u/p.pdf"]]);
  assert.deepEqual(calls.sign, [], "no extra request when the delete worked");
});

test("empty answer without confirmGone is reported as a failure (finance document, upload clean-up)", async () => {
  const { client, calls } = fakeClient({ removeAnswer: { data: [], error: null } });
  assert.equal(await removeAndVerify(client, "finance-private", "u/p.pdf", { describeError }), FILE_NOT_DELETED);
  assert.deepEqual(calls.sign, [], "it must not guess from a signed URL when the person cannot read the file");
});

test("the caller's own wording is used for a refused delete", async () => {
  const { client } = fakeClient({ removeAnswer: { data: [], error: null } });
  assert.equal(await removeAndVerify(client, "b", "p", { describeError, refusedMessage: "Ask an administrator." }), "Ask an administrator.");
});

test("empty answer with confirmGone: a file that can still be signed was not deleted", async () => {
  const { client, calls } = fakeClient({ removeAnswer: { data: [], error: null }, signable: true });
  assert.equal(await removeAndVerify(client, "recordings", "u/take.webm", { describeError, confirmGone: true }), FILE_NOT_DELETED);
  assert.deepEqual(calls.sign, [["recordings", "u/take.webm"]]);
});

test("empty answer with confirmGone: a file that is already gone is fine (retry after a partial delete)", async () => {
  const { client } = fakeClient({ removeAnswer: { data: [], error: null }, signable: false });
  assert.equal(await removeAndVerify(client, "recordings", "u/take.webm", { describeError, confirmGone: true }), null);
});

test("empty answer with confirmGone and a failed check is not treated as gone", async () => {
  const { client } = fakeClient({ removeAnswer: { data: [], error: null }, signThrows: true });
  assert.equal(await removeAndVerify(client, "recordings", "p", { describeError, confirmGone: true }), FILE_NOT_DELETED);
});

test("a storage error is described, and a thrown network error does not escape", async () => {
  const failing = fakeClient({ removeAnswer: { data: null, error: { message: "Bucket not found" } } });
  assert.equal(await removeAndVerify(failing.client, "b", "p", { describeError }), "ERR:Bucket not found");
  const thrown = fakeClient({ removeThrows: true });
  assert.equal(await removeAndVerify(thrown.client, "b", "p", { describeError }), "ERR:Failed to fetch");
});
