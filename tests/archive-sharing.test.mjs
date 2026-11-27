import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  SHARED_ACCESS_NOTICE,
  SHARED_DELETE_NOTICE,
  accessChangeBreaksPlayback,
  accessColumns,
  archiveAccess,
  loweringToExecutivesOnly,
} from "../lib/archive-sharing.ts";

// frontend-2: the delete guard told executives to hide a shared archive file by
// setting access to Executives only. That stops the group's members from signing
// the file, so the group's recording-room copy stops playing.

test("the delete notice does not recommend Executives only", () => {
  assert.doesNotMatch(SHARED_DELETE_NOTICE.body, /executives only/i);
  assert.doesNotMatch(SHARED_DELETE_NOTICE.title, /executives only/i);
  assert.doesNotMatch(SHARED_DELETE_NOTICE.body, /hide it/i);
  // What it does recommend keeps the group's copy playing.
  assert.match(SHARED_DELETE_NOTICE.body, /All club members/);
});

test("lowering a shared file to Executives only is refused", () => {
  for (const current of ["public", "members"]) {
    assert.equal(accessChangeBreaksPlayback(current, "executives", true), true, current);
  }
  assert.match(SHARED_ACCESS_NOTICE, /would stop that group from playing it/);
  assert.match(SHARED_ACCESS_NOTICE, /nothing was saved/i);
});

test("every other change to a shared file, and any change to an unshared file, is allowed", () => {
  assert.equal(accessChangeBreaksPlayback("executives", "executives", true), false, "already executives-only");
  assert.equal(accessChangeBreaksPlayback("executives", "members", true), false, "raising access");
  assert.equal(accessChangeBreaksPlayback("executives", "public", true), false);
  assert.equal(accessChangeBreaksPlayback("public", "members", true), false, "taking it off the concert page keeps the group's copy playing");
  assert.equal(accessChangeBreaksPlayback("members", "public", true), false);
  assert.equal(accessChangeBreaksPlayback("public", "executives", false), false, "not shared with a recording room");
  assert.equal(accessChangeBreaksPlayback("members", "executives", false), false);
});

test("only lowering to Executives only needs the sharing check", () => {
  assert.equal(loweringToExecutivesOnly("members", "executives"), true);
  assert.equal(loweringToExecutivesOnly("public", "executives"), true);
  assert.equal(loweringToExecutivesOnly("executives", "executives"), false);
  assert.equal(loweringToExecutivesOnly("members", "public"), false);
  assert.equal(loweringToExecutivesOnly("public", "members"), false);
});

test("the access choice maps to the stored columns and back", () => {
  assert.deepEqual(accessColumns("members"), { visibility: "members", is_public: false });
  assert.deepEqual(accessColumns("executives"), { visibility: "executives", is_public: false });
  assert.deepEqual(accessColumns("public"), { visibility: "members", is_public: true });
  for (const access of ["members", "executives", "public"]) assert.equal(archiveAccess(accessColumns(access)), access);
  assert.equal(archiveAccess({ visibility: "members" }), "members");
  assert.equal(archiveAccess({ visibility: "executives", is_public: true }), "public");
});

test("the manager uses the guard, and the old advice is gone from the source", async () => {
  const source = await readFile(new URL("../components/recordings/club-archive-manager.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /Hide it by setting access to Executives only/);
  assert.match(source, /accessChangeBreaksPlayback\(/);
  assert.match(source, /SHARED_ACCESS_NOTICE/);
  assert.match(source, /SHARED_DELETE_NOTICE/);
});
