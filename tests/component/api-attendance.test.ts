// lib/api/attendance.ts against the fake client: each function sends exactly the call the attendance screens used to make
// (function name, argument keys and values, bucket, path, options), answers with the data, and throws an ApiError that keeps
// the database's message and code. The screen tests (attendance.test.tsx) check what the person sees; these check the request.
import { describe, expect, it, vi } from "vitest";
import {
  cancelAttendanceSession, checkInAttendance, clearAttendanceStatus, closeAttendanceSession, createAttendanceSession, createExcuseProofUrl, deleteAttendanceSession, getAttendanceOverview,
  getAttendancePulse, getAttendanceRoster, openAttendanceSession, removeExcuseProof, reviewAttendanceExcuse, rotateAttendanceCode, setAttendanceEligibility, setAttendanceRemediation,
  setAttendanceStatus, setAttendanceThresholds, submitAttendanceExcuse, updateAttendanceSession, uploadExcuseProof, voidAttendanceSession, withdrawAttendanceExcuse,
} from "../../lib/api/attendance";
import { ApiError } from "../../lib/errors";
import { fail, fake, ok, rejects } from "../support/fake-supabase";

const rpcCall = (name: string) => {
  const calls = fake.rpc(name).calls;
  expect(calls).toHaveLength(1);
  return calls[0];
};
const caught = async (promise: Promise<unknown>) => promise.then(() => null, (error: unknown) => error);

describe("the reads", () => {
  it("the overview asks for the audience, the term and the queue cap, and returns the answer as it is", async () => {
    fake.rpc("get_attendance_overview").reply(ok({ sessions: [], list_limit: 250 }));
    const view = { p_scope: "subgroup", p_subgroup_id: 7, p_term_key: "2026-fall" };
    expect(await getAttendanceOverview(view, 250)).toEqual({ sessions: [], list_limit: 250 });
    expect(rpcCall("get_attendance_overview").payload).toEqual({ p_scope: "subgroup", p_subgroup_id: 7, p_term_key: "2026-fall", p_list_limit: 250 });
  });

  it("the overview for every audience and term sends null for the ones it does not narrow by", async () => {
    fake.rpc("get_attendance_overview").reply(ok({}));
    await getAttendanceOverview({ p_scope: "all", p_subgroup_id: null, p_term_key: null }, 100);
    expect(rpcCall("get_attendance_overview").payload).toEqual({ p_scope: "all", p_subgroup_id: null, p_term_key: null, p_list_limit: 100 });
  });

  it("the roster asks for one meeting", async () => {
    fake.rpc("get_attendance_roster").reply(ok({ session_id: 5, version: "r1", rows: [] }));
    expect(await getAttendanceRoster(5)).toEqual({ session_id: 5, version: "r1", rows: [] });
    expect(rpcCall("get_attendance_roster").payload).toEqual({ p_session_id: 5 });
  });

  it("the poll sends the audience and the term and never a queue cap", async () => {
    fake.rpc("get_attendance_pulse").reply(ok({ sessions: [], pending_excuses: 0 }));
    await getAttendancePulse({ p_scope: "club", p_subgroup_id: null, p_term_key: null });
    expect(rpcCall("get_attendance_pulse").payload).toEqual({ p_scope: "club", p_subgroup_id: null, p_term_key: null });
  });

  it("a read the database refuses throws an ApiError with its message and code", async () => {
    fake.rpc("get_attendance_overview").reply(fail("permission denied for function get_attendance_overview", "42501"));
    const error = await caught(getAttendanceOverview({ p_scope: "all", p_subgroup_id: null, p_term_key: null }, 100));
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ message: "permission denied for function get_attendance_overview", code: "42501" });
  });

  it("a dropped connection that rejects is not turned into an ApiError", async () => {
    fake.rpc("get_attendance_roster").reply(rejects());
    const error = await caught(getAttendanceRoster(5));
    expect(error).toBeInstanceOf(TypeError);
  });
});

// One row per function that only writes: [name, the call, the rpc, the arguments it must send].
const writes: Array<[string, () => Promise<unknown>, string, Record<string, unknown>]> = [
  ["checkInAttendance", () => checkInAttendance("123456"), "check_in_attendance", { p_code: "123456" }],
  ["openAttendanceSession", () => openAttendanceSession(3, 30), "open_attendance_session", { p_session_id: 3, p_duration_minutes: 30 }],
  ["createAttendanceSession (club-wide)", () => createAttendanceSession({ scope: "club", subgroupId: null, title: "General Body Meeting", startsAt: "2026-10-01T23:00:00.000Z" }), "create_attendance_session",
    { p_scope: "club", p_subgroup_id: null, p_title: "General Body Meeting", p_starts_at: "2026-10-01T23:00:00.000Z" }],
  ["createAttendanceSession (subgroup)", () => createAttendanceSession({ scope: "subgroup", subgroupId: 7, title: "Vocal rehearsal", startsAt: "2026-10-01T23:00:00.000Z" }), "create_attendance_session",
    { p_scope: "subgroup", p_subgroup_id: 7, p_title: "Vocal rehearsal", p_starts_at: "2026-10-01T23:00:00.000Z" }],
  ["rotateAttendanceCode", () => rotateAttendanceCode(3), "rotate_attendance_code", { p_session_id: 3 }],
  ["closeAttendanceSession", () => closeAttendanceSession(3), "close_attendance_session", { p_session_id: 3 }],
  ["cancelAttendanceSession", () => cancelAttendanceSession(3), "cancel_attendance_session", { p_session_id: 3 }],
  ["updateAttendanceSession", () => updateAttendanceSession({ sessionId: 3, title: "New title", startsAt: "2026-10-02T23:00:00.000Z" }), "update_attendance_session",
    { p_session_id: 3, p_title: "New title", p_starts_at: "2026-10-02T23:00:00.000Z" }],
  ["deleteAttendanceSession", () => deleteAttendanceSession(3), "delete_attendance_session", { p_session_id: 3 }],
  ["voidAttendanceSession", () => voidAttendanceSession(3, "Created twice"), "void_attendance_session", { p_session_id: 3, p_reason: "Created twice" }],
  ["setAttendanceStatus", () => setAttendanceStatus({ sessionId: 3, memberId: "u-dev", status: "tardy", note: "Bus", minutesLate: 12 }), "set_attendance_status",
    { p_session_id: 3, p_member_id: "u-dev", p_status: "tardy", p_note: "Bus", p_minutes_late: 12 }],
  ["clearAttendanceStatus", () => clearAttendanceStatus(3, "u-dev"), "clear_attendance_status", { p_session_id: 3, p_member_id: "u-dev" }],
  ["submitAttendanceExcuse", () => submitAttendanceExcuse({ sessionId: 3, reason: "Exam", proofPath: "u-me/3/x-proof.png", reasonCategory: "class_exam", notifiedAt: "2026-10-01T10:00:00.000Z" }), "submit_attendance_excuse",
    { p_session_id: 3, p_reason: "Exam", p_proof_path: "u-me/3/x-proof.png", p_reason_category: "class_exam", p_notified_at: "2026-10-01T10:00:00.000Z" }],
  ["submitAttendanceExcuse (no proof, nobody told)", () => submitAttendanceExcuse({ sessionId: 3, reason: "Exam", proofPath: null, reasonCategory: "other", notifiedAt: null }), "submit_attendance_excuse",
    { p_session_id: 3, p_reason: "Exam", p_proof_path: null, p_reason_category: "other", p_notified_at: null }],
  ["reviewAttendanceExcuse", () => reviewAttendanceExcuse({ excuseId: 9, decision: "denied", note: "No proof" }), "review_attendance_excuse", { p_excuse_id: 9, p_decision: "denied", p_note: "No proof" }],
  ["withdrawAttendanceExcuse", () => withdrawAttendanceExcuse(9), "withdraw_attendance_excuse", { p_excuse_id: 9 }],
  ["setAttendanceRemediation", () => setAttendanceRemediation({ remediationId: 4, status: "complete", assignment: "Write a summary", dueAt: "2026-10-09T00:00:00Z", note: null }), "set_attendance_remediation",
    { p_remediation_id: 4, p_status: "complete", p_assignment: "Write a summary", p_due_at: "2026-10-09T00:00:00Z", p_note: null }],
  ["setAttendanceEligibility", () => setAttendanceEligibility({ termKey: "2026-fall", memberId: "u-dev", status: "restricted", reason: "Three absences" }), "set_attendance_eligibility",
    { p_term_key: "2026-fall", p_member_id: "u-dev", p_status: "restricted", p_reason: "Three absences" }],
  ["setAttendanceThresholds", () => setAttendanceThresholds(3, 5), "set_attendance_thresholds", { p_warning: 3, p_critical: 5 }],
];

describe.each(writes)("%s", (_name, call, rpc, args) => {
  it(`calls ${rpc} with exactly these arguments`, async () => {
    fake.rpc(rpc).reply(ok(null));
    await call();
    expect(rpcCall(rpc).payload).toEqual(args);
    expect(Object.keys(rpcCall(rpc).payload as object).sort()).toEqual(Object.keys(args).sort());
  });

  it("throws an ApiError that keeps the database's sentence and code when it is refused", async () => {
    fake.rpc(rpc).reply(fail("Only executives can do this", "P0001"));
    const error = await caught(call());
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ message: "Only executives can do this", code: "P0001" });
  });
});

describe("what the writes answer", () => {
  it("opening check-in and rotating the code hand back the answer, which carries the code", async () => {
    fake.rpc("open_attendance_session").reply(ok([{ check_in_code: "ABC123", code_expires_at: "x", eligible_count: 4, session_id: 3 }]));
    fake.rpc("rotate_attendance_code").reply(ok([{ check_in_code: "ZZZ999", code_expires_at: "x", session_id: 3 }]));
    expect(await openAttendanceSession(3, 60)).toEqual([{ check_in_code: "ABC123", code_expires_at: "x", eligible_count: 4, session_id: 3 }]);
    expect(await rotateAttendanceCode(3)).toEqual([{ check_in_code: "ZZZ999", code_expires_at: "x", session_id: 3 }]);
  });

  it("creating a meeting hands back the new row", async () => {
    fake.rpc("create_attendance_session").reply(ok({ id: 12, title: "General Body Meeting" }));
    expect(await createAttendanceSession({ scope: "club", subgroupId: null, title: "General Body Meeting", startsAt: "2026-10-01T23:00:00.000Z" })).toEqual({ id: 12, title: "General Body Meeting" });
  });
});

describe("the proof image of an absence form", () => {
  const png = () => new File(["x"], "my proof (1).png", { type: "image/png" });

  it("is stored under the member's folder and the meeting's, in the attendance-excuses bucket, never replacing a file", async () => {
    const path = await uploadExcuseProof("u-me", 3, png());
    expect(path).toMatch(/^u-me\/3\/[0-9a-f-]{36}-my-proof--1-\.png$/);
    const uploads = fake.storage("attendance-excuses", "upload").calls;
    expect(uploads).toHaveLength(1);
    expect(uploads[0].args[0]).toBe(path);
    expect(uploads[0].args[1]).toBeInstanceOf(File);
    expect(uploads[0].args[2]).toEqual({ upsert: false });
  });

  it("every upload gets a path of its own", async () => {
    const first = await uploadExcuseProof("u-me", 3, png());
    const second = await uploadExcuseProof("u-me", 3, png());
    expect(first).not.toBe(second);
  });

  it("a refused upload throws an ApiError with storage's message", async () => {
    fake.storage("attendance-excuses", "upload").reply(fail("The object exceeded the maximum allowed size"));
    const error = await caught(uploadExcuseProof("u-me", 3, png()));
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ message: "The object exceeded the maximum allowed size" });
  });

  it("is removed again by path, and the answer is not read (a refused delete stays quiet, as before)", async () => {
    fake.storage("attendance-excuses", "remove").reply(fail("denied"));
    await expect(removeExcuseProof("u-me/3/x-proof.png")).resolves.toBeUndefined();
    const removes = fake.storage("attendance-excuses", "remove").calls;
    expect(removes).toHaveLength(1);
    expect(removes[0].args).toEqual([["u-me/3/x-proof.png"]]);
  });

  it("is opened through a link that works for five minutes", async () => {
    expect(await createExcuseProofUrl("u-me/3/x-proof.png")).toBe("https://files.test/attendance-excuses/u-me/3/x-proof.png?signed");
    expect(fake.storage("attendance-excuses", "createSignedUrl").calls[0].args).toEqual(["u-me/3/x-proof.png", 300]);
  });

  it("gives null when storage answers with no link, and throws when storage refuses", async () => {
    fake.storage("attendance-excuses", "createSignedUrl").replyOnce(ok(null));
    expect(await createExcuseProofUrl("a")).toBeNull();
    fake.storage("attendance-excuses", "createSignedUrl").replyOnce(fail("Object not found"));
    expect(await caught(createExcuseProofUrl("a"))).toBeInstanceOf(ApiError);
  });
});

describe("a portal with no connection", () => {
  it("says so instead of calling anything", async () => {
    vi.resetModules();
    vi.doMock("../../lib/supabase", () => ({ supabase: null }));
    const offline = await import("../../lib/api/attendance");
    const { ApiError: OfflineApiError } = await import("../../lib/errors");
    const error = await caught(offline.getAttendanceRoster(1));
    expect(error).toBeInstanceOf(OfflineApiError);
    expect(error).toMatchObject({ message: "The portal is not connected." });
    expect(fake.calls).toHaveLength(0);
    vi.doUnmock("../../lib/supabase");
    vi.resetModules();
  });
});
