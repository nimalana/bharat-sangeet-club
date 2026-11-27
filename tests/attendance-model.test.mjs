import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  EMPTY_OVERVIEW,
  applyPulse,
  createFailureGate,
  createSequencer,
  flaggedSummaries,
  normalizeOverview,
  openSessionIds,
  overallRate,
  parseMinutesLate,
  pulseNeedsReload,
  queueNote,
  rosterIsStale,
  shouldPoll,
  termChoices,
  termLabel,
} from "../components/attendance/attendance-model.ts";

const thresholds = { warning: 2, critical: 3 };
const profile = (id, name) => ({ id, full_name: name, email: `${id}@x.test` });

// ---- the totals the page lists, worked out exactly as when it held every mark

// The old page logic, kept verbatim as the reference.
function referenceSummaries({ sessions, participants, records, profiles, eligibility }, thresholds) {
  const closedSessions = sessions.filter((session) => session.status === "closed" && session.counts_toward_metrics);
  const closedIds = new Set(closedSessions.map((session) => session.id));
  const memberIds = new Set(participants.filter((participant) => closedIds.has(participant.session_id)).map((participant) => participant.member_id));
  const summaries = [...memberIds].map((memberId) => {
    const memberRecords = records.filter((record) => record.member_id === memberId && closedIds.has(record.session_id));
    const present = memberRecords.filter((record) => record.status === "present").length;
    const absent = memberRecords.filter((record) => record.status === "absent").length;
    const excused = memberRecords.filter((record) => record.status === "excused").length;
    const tardy = memberRecords.filter((record) => record.status === "tardy").length;
    const sessionById = new Map(closedSessions.map((session) => [session.id, session]));
    const unitValue = (record) => Number(record.unexcused_units) || (record.status === "absent" ? 1 : 0);
    const clubUnits = memberRecords.filter((record) => sessionById.get(record.session_id)?.scope === "club").reduce((total, record) => total + unitValue(record), 0);
    const subgroupUnits = memberRecords.filter((record) => sessionById.get(record.session_id)?.scope === "subgroup").reduce((total, record) => total + unitValue(record), 0);
    const counted = present + absent + tardy;
    const found = profiles.find((item) => item.id === memberId);
    return {
      memberId, name: found?.full_name || found?.email || "Member", email: found?.email || "", present, absent, excused, tardy, clubUnits, subgroupUnits,
      unexcusedUnits: clubUnits + subgroupUnits,
      rate: counted ? Math.round(((present + tardy) / counted) * 100) : 100,
      flag: Math.max(clubUnits, subgroupUnits) >= thresholds.critical ? "critical" : Math.max(clubUnits, subgroupUnits) >= thresholds.warning ? "warning" : "none",
      eligibility: eligibility.find((item) => item.member_id === memberId)?.status || "eligible",
    };
  }).sort((left, right) => right.unexcusedUnits - left.unexcusedUnits || left.name.localeCompare(right.name));
  const attended = records.filter((record) => closedIds.has(record.session_id) && (record.status === "present" || record.status === "tardy")).length;
  const absentTotal = records.filter((record) => closedIds.has(record.session_id) && record.status === "absent").length;
  return { flagged: summaries.filter((summary) => summary.flag !== "none"), attended, absentTotal };
}

// What the database sends instead: totals per member, only at or above the warning level.
function serverRows({ sessions, records, eligibility }, thresholds) {
  const closed = new Map(sessions.filter((session) => session.status === "closed" && session.counts_toward_metrics).map((session) => [session.id, session]));
  const byMember = new Map();
  for (const record of records) {
    const session = closed.get(record.session_id);
    if (!session) continue;
    const row = byMember.get(record.member_id) || { member_id: record.member_id, present: 0, absent: 0, excused: 0, tardy: 0, club_units: 0, subgroup_units: 0, eligibility: null };
    row[record.status] += 1;
    const units = Number(record.unexcused_units) !== 0 ? Number(record.unexcused_units) : record.status === "absent" ? 1 : 0;
    row[session.scope === "club" ? "club_units" : "subgroup_units"] += units;
    byMember.set(record.member_id, row);
  }
  for (const row of byMember.values()) row.eligibility = eligibility.find((item) => item.member_id === row.member_id)?.status || null;
  const rows = [...byMember.values()];
  return {
    flagged: rows.filter((row) => Math.max(row.club_units, row.subgroup_units) >= thresholds.warning),
    attended: rows.reduce((total, row) => total + row.present + row.tardy, 0),
    absent: rows.reduce((total, row) => total + row.absent, 0),
  };
}

function fixture(seed) {
  let state = seed;
  const random = () => { state = (state * 1103515245 + 12345) % 2147483648; return state / 2147483648; };
  const statuses = ["present", "present", "present", "absent", "excused", "tardy"];
  const sessions = Array.from({ length: 14 }, (_, index) => ({
    id: index + 1, scope: index % 3 === 0 ? "subgroup" : "club", status: index === 12 ? "open" : index === 13 ? "draft" : "closed", counts_toward_metrics: index !== 5,
  }));
  const members = Array.from({ length: 40 }, (_, index) => `m${index}`);
  const profiles = members.map((id, index) => profile(id, index % 7 === 0 ? "Same Name" : `Member ${String.fromCharCode(65 + (index % 26))}${index}`));
  const participants = [];
  const records = [];
  for (const session of sessions) for (const member of members) {
    if (random() < 0.2) continue;
    participants.push({ session_id: session.id, member_id: member });
    if (random() < 0.9) {
      const status = statuses[Math.floor(random() * statuses.length)];
      const late = status === "tardy" ? 1 + Math.floor(random() * 20) : 0;
      records.push({ session_id: session.id, member_id: member, status, minutes_late: late, unexcused_units: status === "absent" ? 1 : status === "tardy" && late > 10 ? 0.5 : 0 });
    }
  }
  const eligibility = members.filter((_, index) => index % 5 === 0).map((id) => ({ member_id: id, status: "under_review" }));
  return { sessions, participants, records, profiles, eligibility };
}

test("the listed members and the attendance rate match the old page logic", () => {
  for (const seed of [1, 7, 42, 2026, 99991]) {
    const data = fixture(seed);
    for (const levels of [thresholds, { warning: 1, critical: 4 }, { warning: 3, critical: 5 }]) {
      const reference = referenceSummaries(data, levels);
      const server = serverRows(data, levels);
      const listed = flaggedSummaries(server.flagged, data.profiles, levels);
      // Ties on units and name have no fixed order in either version: compare as sets, and check the order rule.
      const byId = (rows) => JSON.stringify([...rows].sort((a, b) => a.memberId.localeCompare(b.memberId)));
      assert.equal(byId(listed), byId(reference.flagged), `seed ${seed}`);
      assert.ok(listed.every((row, index) => index === 0 || listed[index - 1].unexcusedUnits > row.unexcusedUnits || (listed[index - 1].unexcusedUnits === row.unexcusedUnits && listed[index - 1].name.localeCompare(row.name) <= 0)), "units high to low, then name");
      assert.equal(overallRate(server.attended, server.absent), overallRate(reference.attended, reference.absentTotal));
    }
  }
});

test("rates round like the old page (half up on the floating point value)", () => {
  assert.equal(overallRate(0, 0), 100, "nothing counted yet");
  assert.equal(overallRate(1, 7), 13, "12.5 rounds up");
  assert.equal(overallRate(29, 171), 14, "14.499999999999998 rounds down, as Math.round did");
  const [row] = flaggedSummaries([{ member_id: "a", present: 29, absent: 171, excused: 0, tardy: 0, club_units: 3, subgroup_units: 0, eligibility: null }], [profile("a", "A")], thresholds);
  assert.equal(row.rate, 14);
  assert.equal(row.flag, "critical");
  assert.equal(row.eligibility, "eligible");
});

test("a member is listed by name, then email, then a generic label", () => {
  const rows = [
    { member_id: "a", present: 0, absent: 2, excused: 0, tardy: 0, club_units: 2, subgroup_units: 0, eligibility: "restricted" },
    { member_id: "b", present: 0, absent: 2, excused: 0, tardy: 0, club_units: 2, subgroup_units: 0, eligibility: null },
    { member_id: "c", present: 0, absent: 2, excused: 0, tardy: 0, club_units: 2, subgroup_units: 0, eligibility: null },
  ];
  const listed = flaggedSummaries(rows, [{ id: "a", full_name: "Asha", email: "a@x" }, { id: "b", full_name: "", email: "b@x" }], thresholds);
  assert.deepEqual(listed.map((row) => row.name), ["Asha", "b@x", "Member"]);
  assert.equal(listed[0].eligibility, "restricted");
  assert.equal(listed.every((row) => row.flag === "warning"), true);
});

test("members below the warning level are not listed even if the server sent them", () => {
  const rows = [{ member_id: "a", present: 1, absent: 1, excused: 0, tardy: 0, club_units: 1, subgroup_units: 1, eligibility: null }];
  assert.equal(flaggedSummaries(rows, [profile("a", "A")], thresholds).length, 0);
  assert.equal(flaggedSummaries(rows, [profile("a", "A")], { warning: 1, critical: 3 }).length, 1);
});

// ---- the poll

const open = (id, extra = {}) => ({ id, status: "open", ...extra });
const pulseSession = (id, extra = {}) => ({ id, status: "open", closes_at: "2026-11-27T20:00:00Z", code_expires_at: "2026-11-27T20:00:00Z", live: null, my_record: null, ...extra });

test("the poll asks for a full reload only when something it cannot patch changed", () => {
  const known = [open(5), { id: 4, status: "closed" }];
  assert.deepEqual(openSessionIds(known), [5]);
  assert.equal(pulseNeedsReload(known, { sessions: [pulseSession(5)], pending_excuses: 2 }, 2, true), false, "same open meeting, same waiting forms");
  assert.equal(pulseNeedsReload(known, { sessions: [], pending_excuses: 2 }, 2, true), true, "the meeting closed or was canceled");
  assert.equal(pulseNeedsReload(known, { sessions: [pulseSession(5), pulseSession(9)], pending_excuses: 2 }, 2, true), true, "another meeting opened");
  assert.equal(pulseNeedsReload(known, { sessions: [pulseSession(5)], pending_excuses: 3 }, 2, true), true, "a new absence form for an executive");
  assert.equal(pulseNeedsReload(known, { sessions: [pulseSession(5)], pending_excuses: null }, 2, false), false, "members are not told about forms");
  assert.equal(pulseNeedsReload([], { sessions: [], pending_excuses: 0 }, 0, true), false);
});

test("the poll patches the open meeting and the caller's own mark in place", () => {
  const sessions = [{ id: 5, status: "open", title: "Meeting", closes_at: "a", code_expires_at: "a", live: { roster_count: 10, checked_in_count: 1, version: "1:1" } }, { id: 4, status: "closed", title: "Old", closes_at: null, code_expires_at: null }];
  const records = [{ session_id: 4, member_id: "me", status: "present" }, { session_id: 5, member_id: "me", status: "absent" }];
  const next = applyPulse({ sessions, records }, {
    sessions: [pulseSession(5, { closes_at: "b", code_expires_at: "c", live: { roster_count: 10, checked_in_count: 6, version: "6:2" }, my_record: { session_id: 5, member_id: "me", status: "present" } })],
    pending_excuses: null,
  });
  assert.equal(next.sessions[0].title, "Meeting", "other fields are kept");
  assert.equal(next.sessions[0].closes_at, "b");
  assert.equal(next.sessions[0].code_expires_at, "c");
  assert.equal(next.sessions[0].live.checked_in_count, 6);
  assert.deepEqual(next.sessions[1], sessions[1], "closed meetings are untouched");
  assert.deepEqual(next.records.map((record) => `${record.session_id}:${record.status}`).sort(), ["4:present", "5:present"]);
  const cleared = applyPulse({ sessions, records }, { sessions: [pulseSession(5, { my_record: null })], pending_excuses: null });
  assert.deepEqual(cleared.records.map((record) => record.session_id), [4], "a cleared mark disappears");
  assert.equal(sessions[0].live.checked_in_count, 1, "the old state is not mutated");
});

test("a roster is stale when the open meeting's marks moved after it was read", () => {
  assert.equal(rosterIsStale({ session_id: 5, version: "1:1" }, { id: 5, live: { roster_count: 1, checked_in_count: 1, version: "2:2" } }), true);
  assert.equal(rosterIsStale({ session_id: 5, version: "2:2" }, { id: 5, live: { roster_count: 1, checked_in_count: 1, version: "2:2" } }), false);
  assert.equal(rosterIsStale({ session_id: 4, version: "1:1" }, { id: 5, live: { roster_count: 1, checked_in_count: 1, version: "2:2" } }), false, "another meeting's roster");
  assert.equal(rosterIsStale(null, { id: 5, live: { roster_count: 1, checked_in_count: 1, version: "2:2" } }), false);
  assert.equal(rosterIsStale({ session_id: 5, version: "1:1" }, { id: 5, live: null }), false, "members have no live counts");
});

test("the poll is paused for a hidden page and for no open meeting", () => {
  assert.equal(shouldPoll("visible", true), true);
  assert.equal(shouldPoll("hidden", true), false);
  assert.equal(shouldPoll("visible", false), false);
  assert.equal(shouldPoll(undefined, true), true, "no Page Visibility support: keep polling");
});

// ---- late answers and repeated errors

test("only the answer to the newest request is used", () => {
  const requests = createSequencer();
  const first = requests.next();
  const second = requests.next();
  assert.equal(requests.isLatest(first), false, "an earlier audience's answer arriving late is dropped");
  assert.equal(requests.isLatest(second), true);
  const inFlight = requests.current();
  requests.next();
  assert.equal(requests.isLatest(inFlight), false, "a poll that started before a reload is dropped");
  const third = requests.next();
  requests.invalidate();
  assert.equal(requests.isLatest(third), false, "leaving the screen drops every answer on its way");
});

test("a failing background refresh is reported once until one succeeds", () => {
  const gate = createFailureGate();
  assert.equal(gate.shouldNotify(true), true, "first failure");
  assert.equal(gate.shouldNotify(true), false, "same outage 10 seconds later");
  assert.equal(gate.shouldNotify(true), false);
  assert.equal(gate.shouldNotify(false), true, "something the person asked for is always reported");
  gate.succeeded();
  assert.equal(gate.shouldNotify(true), true, "a new outage after recovery is reported again");
});

// ---- small helpers

test("minutes late are whole minutes from 0 to 1440", () => {
  assert.equal(parseMinutesLate("10"), 10);
  assert.equal(parseMinutesLate(" 0 "), 0);
  assert.equal(parseMinutesLate("1440"), 1440);
  for (const bad of ["", "  ", "-1", "1.5", "abc", "1441", "99999", "1e2", "０"]) assert.equal(parseMinutesLate(bad), null, JSON.stringify(bad));
});

test("term choices keep the term in use even when the audience has no meeting in it", () => {
  assert.deepEqual(termChoices(["2026-fall", "2026-spring"], "all"), ["2026-fall", "2026-spring"]);
  assert.deepEqual(termChoices(["2026-fall"], "2025-fall"), ["2025-fall", "2026-fall"]);
  assert.deepEqual(termChoices(["2026-fall"], "2026-fall"), ["2026-fall"]);
  assert.equal(termLabel("2026-spring"), "Spring 2026");
  assert.equal(termLabel("2025-fall"), "Fall 2025");
});

test("a partial answer never crashes the page and a capped list says so", () => {
  const partial = normalizeOverview({ sessions: [{ id: 1 }] });
  assert.deepEqual(partial.records, []);
  assert.deepEqual(partial.flagged, []);
  assert.equal(partial.excuses_pending, 0);
  assert.deepEqual(normalizeOverview(null), EMPTY_OVERVIEW);
  assert.equal(queueNote(100, 100, "open items"), "");
  assert.equal(queueNote(100, 533, "open items"), "Showing the latest 100 of 533 open items.");
});

// ---- the screen no longer uses the browser's own dialogs

test("attendance.tsx has no window.prompt or window.confirm and polls through the small function", () => {
  const source = readFileSync(new URL("../app/attendance.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /window\.(prompt|confirm|alert)\s*\(|[^.\w](prompt|confirm|alert)\s*\(/, "use FormDialog and ConfirmDialog");
  assert.match(source, /get_attendance_pulse/, "the 10 second poll uses the pulse");
  assert.match(source, /get_attendance_overview/);
  assert.doesNotMatch(source, /get_attendance_workspace/, "the 5 MB read is gone from the page");
  assert.match(source, /visibilitychange/, "polling follows page visibility");
  assert.match(source, /FormDialog/);
  assert.match(source, /ConfirmDialog/);
});
