// What the recordings screens share (features/recordings/model.ts): how a length is written, the tonics of the sruthi companion,
// and which of the loaded recordings a list shows. formatDuration was a private function of the 408-line workspace.
import assert from "node:assert/strict";
import test from "node:test";
import { TONICS, formatDuration, visibleRecordings } from "../features/recordings/model.ts";

test("a length is minutes and two-digit seconds; nothing, zero or a number that is not one is a dash", () => {
  assert.equal(formatDuration(95), "1:35");
  assert.equal(formatDuration(60), "1:00");
  assert.equal(formatDuration(5), "0:05");
  assert.equal(formatDuration(3599), "59:59");
  assert.equal(formatDuration(3600), "60:00");
  for (const value of [0, null, undefined, NaN, Infinity, -Infinity]) assert.equal(formatDuration(value), "—");
});

test("fractions round to the nearest second, half up", () => {
  assert.equal(formatDuration(59.4), "0:59");
  assert.equal(formatDuration(59.5), "1:00");
  assert.equal(formatDuration(0.4), "0:00");
  assert.equal(formatDuration(0.6), "0:01");
});

test("twelve tonics from C, each with a frequency above the one before", () => {
  assert.deepEqual(TONICS.map((tonic) => tonic.label), ["C", "C♯ / D♭", "D", "D♯ / E♭", "E", "F", "F♯ / G♭", "G", "G♯ / A♭", "A", "A♯ / B♭", "B"]);
  assert.equal(TONICS[0].frequency, 130.81);
  for (let index = 1; index < TONICS.length; index += 1) assert.ok(TONICS[index].frequency > TONICS[index - 1].frequency);
  assert.ok(TONICS.at(-1).frequency < TONICS[0].frequency * 2);
});

const row = (id, over = {}) => ({
  id, title: `Take ${id}`, description: "", subgroup_id: 7, uploaded_by: "me", status: "published", recording_kind: "practice", raga: null, tala: null, ...over,
});
const ids = (rows) => rows.map((item) => item.id);
const base = { view: "published", scope: "all", query: "", userId: "me", canManage: false };

test("the published list shows published recordings only", () => {
  const rows = [row(1), row(2, { status: "draft" }), row(3, { status: "archived" })];
  assert.deepEqual(ids(visibleRecordings(rows, base)), [1]);
});

test("My drafts shows the person's own drafts, never someone else's, whatever the role", () => {
  const rows = [row(1, { status: "draft" }), row(2, { status: "draft", uploaded_by: "other" }), row(3)];
  assert.deepEqual(ids(visibleRecordings(rows, { ...base, view: "drafts" })), [1]);
  assert.deepEqual(ids(visibleRecordings(rows, { ...base, view: "drafts", canManage: true })), [1]);
});

test("Archived shows the person's own, or every one for someone who manages recordings", () => {
  const rows = [row(1, { status: "archived" }), row(2, { status: "archived", uploaded_by: "other" }), row(3, { status: "draft" })];
  assert.deepEqual(ids(visibleRecordings(rows, { ...base, view: "archived" })), [1]);
  assert.deepEqual(ids(visibleRecordings(rows, { ...base, view: "archived", canManage: true })), [1, 2]);
});

test("a group narrows the list to its recordings", () => {
  const rows = [row(1), row(2, { subgroup_id: 8 })];
  assert.deepEqual(ids(visibleRecordings(rows, { ...base, scope: 8 })), [2]);
  assert.deepEqual(ids(visibleRecordings(rows, { ...base, scope: "all" })), [1, 2]);
});

test("the search reads the title, description, raga, tala and type, ignoring case, and keeps the server's order", () => {
  const rows = [
    row(1, { title: "Varnam" }), row(2, { description: "Slow ALAP" }), row(3, { raga: "Bhairavi" }), row(4, { tala: "Adi" }),
    row(5, { recording_kind: "lesson" }), row(6, { title: "Other" }),
  ];
  assert.deepEqual(ids(visibleRecordings(rows, { ...base, query: "var" })), [1]);
  assert.deepEqual(ids(visibleRecordings(rows, { ...base, query: "alap" })), [2]);
  assert.deepEqual(ids(visibleRecordings(rows, { ...base, query: "BHAIRAVI" })), [3]);
  assert.deepEqual(ids(visibleRecordings(rows, { ...base, query: "adi" })), [4]);
  assert.deepEqual(ids(visibleRecordings(rows, { ...base, query: "lesson" })), [5]);
  assert.deepEqual(ids(visibleRecordings(rows, { ...base, query: "" })), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(ids(visibleRecordings(rows, { ...base, query: "nothing like it" })), []);
});
