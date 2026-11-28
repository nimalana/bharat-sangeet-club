// How the attendance screens write things (features/attendance/display.ts) and what each action dialog asks
// (features/attendance/action-dialog.ts). Both were part of the 610-line page; the screen tests reach them only through a dialog.
import assert from "node:assert/strict";
import test from "node:test";
import { formConfig } from "../features/attendance/action-dialog.ts";
import { categoryLabels, formatDateTime, formatUnits, localDateTime, sessionAudience } from "../features/attendance/display.ts";

test("every absence reason has the sentence the form and the review list show", () => {
  assert.deepEqual(categoryLabels, {
    class_exam: "Class or exam conflict",
    family_emergency: "Family emergency",
    illness: "Illness",
    other_club_event: "Other club meeting or event",
    other: "Other",
  });
});

test("units are whole numbers as they are, and halves with one decimal", () => {
  assert.equal(formatUnits(0), "0");
  assert.equal(formatUnits(3), "3");
  assert.equal(formatUnits(1.5), "1.5");
  assert.equal(formatUnits(0.25), "0.3");
  assert.equal(formatUnits(2.04), "2.0");
});

test("a club-wide meeting is Club-wide; a subgroup meeting names its group, from the meeting first, then the list, then 'Subgroup'", () => {
  const groups = [{ id: 7, name: "Hindustani Vocal" }];
  assert.equal(sessionAudience({ scope: "club", subgroup_id: null }, groups), "Club-wide");
  assert.equal(sessionAudience({ scope: "subgroup", subgroup_id: 7, subgroup_name: "Vocal (renamed)" }, groups), "Vocal (renamed) rehearsal");
  assert.equal(sessionAudience({ scope: "subgroup", subgroup_id: 7, subgroup_name: null }, groups), "Hindustani Vocal rehearsal");
  assert.equal(sessionAudience({ scope: "subgroup", subgroup_id: 9 }, groups), "Subgroup rehearsal");
});

function inZone(zone, body) {
  const previous = process.env.TZ;
  process.env.TZ = zone;
  try { body(); } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
}

test("a date and time is written in the viewer's time zone, with the year and minutes", () => {
  inZone("UTC", () => assert.equal(formatDateTime("2026-10-05T14:30:00Z"), "Oct 5, 2026, 2:30 PM"));
  inZone("America/New_York", () => assert.equal(formatDateTime("2026-10-05T14:30:00Z"), "Oct 5, 2026, 10:30 AM"));
  inZone("Asia/Kolkata", () => assert.equal(formatDateTime("2026-10-05T14:30:00Z"), "Oct 5, 2026, 8:00 PM"));
});

test("a value that is not a date reads 'Date unavailable', also a missing one", () => {
  for (const value of ["", null, undefined, "not a date", "2026-13-45"]) assert.equal(formatDateTime(value), "Date unavailable");
});

test("the datetime-local value for now is the viewer's wall clock, to the minute", () => {
  const realNow = Date.now;
  try {
    Date.now = () => Date.parse("2026-10-05T14:30:45Z");
    inZone("UTC", () => assert.equal(localDateTime(), "2026-10-05T14:30"));
    // Zones without daylight saving: the offset is read for the real "now", while Date.now is the faked one.
    inZone("Asia/Tokyo", () => assert.equal(localDateTime(), "2026-10-05T23:30"));
    inZone("Asia/Kolkata", () => assert.equal(localDateTime(), "2026-10-05T20:00"));
  } finally { Date.now = realNow; }
});

const names = (config) => config.fields.map((field) => field.name);

test("a mark asks for an optional note; a tardy mark asks for whole minutes first", () => {
  const absent = formConfig({ kind: "status", sessionId: 1, memberId: "m", memberName: "Dev Nair", status: "absent" });
  assert.equal(absent.title, "Mark Dev Nair absent");
  assert.equal(absent.submitLabel, "Save mark");
  assert.deepEqual(names(absent), ["note"]);
  assert.equal(absent.fields[0].label, "Correction note (optional)");
  assert.equal(absent.fields[0].maxLength, 500);
  const tardy = formConfig({ kind: "status", sessionId: 1, memberId: "m", memberName: "Dev Nair", status: "tardy" });
  assert.equal(tardy.title, "Mark Dev Nair tardy");
  assert.deepEqual(names(tardy), ["minutes", "note"]);
  assert.deepEqual(tardy.fields[0], { name: "minutes", label: "Minutes late", type: "number", defaultValue: "10", required: true, min: 0, max: 1440, step: 1 });
});

test("approving a form needs no reason; denying one needs at least three characters and is styled as dangerous", () => {
  const excuse = { id: 4 };
  const approve = formConfig({ kind: "review", excuse, memberName: "Dev Nair", decision: "approved" });
  assert.equal(approve.title, "Approve this absence form?");
  assert.equal(approve.description, "Dev Nair will be marked excused for this meeting.");
  assert.equal(approve.submitLabel, "Approve");
  assert.equal(approve.danger, undefined);
  assert.equal(approve.fields[0].required, undefined);
  const deny = formConfig({ kind: "review", excuse, memberName: "Dev Nair", decision: "denied" });
  assert.equal(deny.title, "Deny this absence form?");
  assert.equal(deny.description, "Dev Nair will be marked absent for this meeting.");
  assert.equal(deny.submitLabel, "Deny form");
  assert.equal(deny.danger, true);
  assert.equal(deny.fields[0].required, true);
  assert.equal(deny.fields[0].minLength, 3);
  assert.equal(deny.fields[0].label, "Why is this being denied?");
});

test("completing a follow-up item shows its instruction, required, to be edited", () => {
  const config = formConfig({ kind: "remediation", item: { id: 2, assignment: "Write a short reflection" }, memberName: "Dev Nair" });
  assert.equal(config.title, "Complete this follow-up?");
  assert.equal(config.description, "Dev Nair");
  assert.equal(config.submitLabel, "Mark complete");
  assert.deepEqual(config.fields, [{ name: "assignment", label: "Remediation instruction", type: "textarea", defaultValue: "Write a short reflection", required: true, maxLength: 500 }]);
});

test("restricting performance eligibility needs a reason; reinstating or putting under review does not", () => {
  const restrict = formConfig({ kind: "eligibility", memberId: "m", memberName: "Dev Nair", status: "restricted" });
  assert.equal(restrict.title, "Restrict Dev Nair?");
  assert.equal(restrict.description, "They will not be eligible to perform this term.");
  assert.equal(restrict.submitLabel, "Restrict");
  assert.equal(restrict.danger, true);
  assert.deepEqual([restrict.fields[0].name, restrict.fields[0].required, restrict.fields[0].minLength], ["reason", true, 3]);
  const reinstate = formConfig({ kind: "eligibility", memberId: "m", memberName: "Dev Nair", status: "reinstated" });
  assert.equal(reinstate.title, "Reinstate Dev Nair?");
  assert.equal(reinstate.submitLabel, "Reinstate");
  assert.equal(reinstate.danger, undefined);
  assert.equal(reinstate.fields[0].required, undefined);
  const review = formConfig({ kind: "eligibility", memberId: "m", memberName: "Dev Nair", status: "under_review" });
  assert.equal(review.title, "Put Dev Nair under review?");
  assert.equal(review.submitLabel, "Mark under review");
  assert.equal(review.fields[0].label, "Eligibility note (optional)");
});
