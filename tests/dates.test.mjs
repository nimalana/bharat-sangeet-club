import assert from "node:assert/strict";
import test from "node:test";
import { clubToday, formatDateTime, formatDay } from "../lib/dates.ts";

test("a calendar day is shown as written, whatever the viewer's time zone", () => {
  assert.equal(formatDay("2026-09-05"), "Sep 5, 2026");
  assert.equal(formatDay("2026-01-01"), "Jan 1, 2026");
});

test("an instant is shown as the club's day, not the UTC day", () => {
  // 9:30 PM Eastern on Sep 5 is already Sep 6 in UTC.
  assert.equal(formatDay("2026-09-06T01:30:00+00:00"), "Sep 5, 2026");
  assert.equal(formatDateTime("2026-09-06T01:30:00+00:00"), "Sep 5, 2026, 9:30 PM");
});

test("today is the club's calendar day in the evening", () => {
  // 8:30 PM Eastern (EDT) on Sep 5.
  assert.equal(clubToday(new Date("2026-09-06T00:30:00Z")), "2026-09-05");
  // 11:30 PM Eastern (EST) on Dec 31.
  assert.equal(clubToday(new Date("2027-01-01T04:30:00Z")), "2026-12-31");
  // Morning is unaffected.
  assert.equal(clubToday(new Date("2026-09-05T14:00:00Z")), "2026-09-05");
});

test("daylight-saving boundaries keep the right day", () => {
  // Nov 1 2026, 1:30 AM EST, just after clocks fall back.
  assert.equal(clubToday(new Date("2026-11-01T06:30:00Z")), "2026-11-01");
  // Mar 8 2026, 3:30 AM EDT, just after clocks spring forward.
  assert.equal(clubToday(new Date("2026-03-08T07:30:00Z")), "2026-03-08");
});

test("empty and invalid values format as an empty string", () => {
  assert.equal(formatDay(null), "");
  assert.equal(formatDay("not a date"), "");
  assert.equal(formatDateTime(undefined), "");
});
