// lib/format.ts replaces five private copies: formatDate in app/portal.tsx, app/resources.tsx and
// components/recordings/recording-workspace.tsx, money in app/finance.tsx, initials in app/portal.tsx.
// The OLD functions are kept below, word for word, as the reference: the shared ones must give exactly their output for
// every input a call site can pass (timestamps as Postgres writes them, a date-only value, a missing one), in several
// viewer time zones. Where the old copies differed (an unreadable value, an empty one), the difference is pinned too.
import assert from "node:assert/strict";
import test from "node:test";
import { formatDate, formatDateOrNone, formatMoney, initials, toLocalInputValue } from "../lib/format.ts";

// ---- the old copies, unchanged -------------------------------------------------------------------------------------
const oldPortalFormatDate = (value) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
const oldResourcesFormatDate = (value) => {
  if (!value) return "No date";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
};
const oldRecordingsFormatDate = (value) => new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
const oldMoney = (value) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
// The two copies of toLocalInputValue (attendance-corrections.tsx: toLocalInput, event-modal.tsx: toLocalInputValue), written out the same way.
const oldToLocalInput = (value) => {
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
const oldInitials = (value) => value.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "BS";

// What the call sites pass: published_at / created_at / updated_at columns (timestamptz as PostgREST writes them).
const TIMESTAMPS = [
  "2026-09-05T23:30:00+00:00",
  "2026-09-06T01:30:00+00:00",
  "2026-11-01T05:59:59.999999+00:00",
  "2026-03-08T07:30:00Z",
  "2027-01-01T04:30:00.123Z",
  "2026-12-31T23:59:59+00:00",
  "2026-09-05T08:00:00-04:00",
  "2026-02-28T12:00:00.5+05:30",
  "2026-09-05", // a date-only string is read as UTC midnight
];
const ZONES = ["UTC", "America/New_York", "America/Los_Angeles", "Asia/Kolkata", "Pacific/Auckland"];

function inZone(zone, body) {
  const previous = process.env.TZ;
  process.env.TZ = zone;
  try { body(); } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
}

test("formatDate gives exactly the old output of the portal, library and recordings copies for every timestamp, in every zone", () => {
  for (const zone of ZONES) inZone(zone, () => {
    for (const value of TIMESTAMPS) {
      const shared = formatDate(value);
      assert.equal(shared, oldPortalFormatDate(value), `portal copy, ${value} in ${zone}`);
      assert.equal(shared, oldRecordingsFormatDate(value), `recordings copy, ${value} in ${zone}`);
      assert.equal(formatDateOrNone(value), oldResourcesFormatDate(value), `library copy, ${value} in ${zone}`);
    }
  });
});

test("formatDate shows the viewer's day, not the club's: 9:30 PM in New York on Sep 5 is Sep 6 in India", () => {
  inZone("America/New_York", () => assert.equal(formatDate("2026-09-06T01:30:00+00:00"), "Sep 5, 2026"));
  inZone("Asia/Kolkata", () => assert.equal(formatDate("2026-09-06T01:30:00+00:00"), "Sep 6, 2026"));
});

test("formatDateOrNone: nothing to show reads 'No date' (the library's wording); a value is formatted", () => {
  assert.equal(formatDateOrNone(null), "No date");
  assert.equal(formatDateOrNone(undefined), "No date");
  assert.equal(formatDateOrNone(""), "No date");
  assert.equal(formatDateOrNone(null), oldResourcesFormatDate(null));
  assert.equal(formatDateOrNone(""), oldResourcesFormatDate(""));
  inZone("UTC", () => assert.equal(formatDateOrNone("2026-09-05T12:00:00Z"), "Sep 5, 2026"));
});

test("a value that is not a date: the recordings copy's answer, where the portal and library copies threw (no call site can pass one)", () => {
  assert.equal(formatDate("not a date"), "Invalid Date");
  assert.equal(formatDate("not a date"), oldRecordingsFormatDate("not a date"));
  assert.throws(() => oldPortalFormatDate("not a date"), RangeError);
  assert.throws(() => oldResourcesFormatDate("not a date"), RangeError);
});

test("formatMoney gives exactly the old money() output", () => {
  const values = [0, 5, 12.5, 1234.567, 1e9, 0.005, 0.004, 99.995, -3, -0.01, 1234567.891, Number("12.50"), Number(null), Number(undefined), Number("abc"), Infinity, -Infinity];
  for (const value of values) assert.equal(formatMoney(value), oldMoney(value), String(value));
  assert.equal(formatMoney(1234.5), "$1,234.50");
  assert.equal(formatMoney(0), "$0.00");
  assert.equal(formatMoney(-3), "-$3.00");
});

test("initials gives exactly the old output: two capitals, 'BS' when there is no name", () => {
  const names = ["Asha Rao", "asha rao", "  Asha   Rao  ", "Asha", "a", "Asha Devi Rao", "", "   ", "Hindustani Vocal", "ñandi ørn", "Émile", "student@unc.edu", "Carnatic Violin Ensemble", "😀 smile", "1 2 3"];
  for (const name of names) assert.equal(initials(name), oldInitials(name), JSON.stringify(name));
  assert.equal(initials("Asha Rao"), "AR");
  assert.equal(initials("  asha   rao devi "), "AR");
  assert.equal(initials(""), "BS");
  assert.equal(initials("   "), "BS");
});

test("toLocalInputValue gives exactly the old output of both copies (the meeting editor's and the calendar's), in every zone", () => {
  for (const zone of ZONES) inZone(zone, () => {
    for (const value of TIMESTAMPS) assert.equal(toLocalInputValue(value), oldToLocalInput(value), `${zone} ${value}`);
  });
});

test("toLocalInputValue is the wall-clock time of the viewer's zone, to the minute, in the shape a datetime-local input takes", () => {
  inZone("UTC", () => assert.equal(toLocalInputValue("2026-09-05T23:30:45.678Z"), "2026-09-05T23:30"));
  inZone("America/New_York", () => {
    assert.equal(toLocalInputValue("2026-09-05T23:30:00Z"), "2026-09-05T19:30"); // summer time: UTC-4
    assert.equal(toLocalInputValue("2026-12-05T23:30:00Z"), "2026-12-05T18:30"); // winter time: UTC-5
  });
  inZone("Asia/Kolkata", () => assert.equal(toLocalInputValue("2026-09-05T23:30:00Z"), "2026-09-06T05:00"));
  assert.throws(() => toLocalInputValue("not a date"), RangeError);
});
