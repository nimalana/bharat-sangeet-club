// Every call the attendance screens make to Supabase: the overview, roster and poll reads, check-in, meetings and their
// corrections, marks, absence forms (with the proof image in the attendance-excuses bucket), follow-up items, eligibility and
// the policy thresholds. Plain async functions: no React, no toast, no sentences. A database or storage error is thrown as an
// ApiError (message, code, status as the database sent them); the screen turns it into the sentence the person sees.
//
// The table, function and bucket names stay literal here because the contract check (scripts/contract-check) reads them.
import { ApiError, toApiError } from "../errors";
import type { AttendanceStatus, EligibilityStatus, RemediationStatus, RpcArgs, RpcReturns, Tables } from "../db";
import { supabase } from "../supabase";
import { must, safeFileName, uploadWithProgress, type UploadProgress } from "./_core";

// What the screen is showing: the audience (all, club-wide, or one subgroup) and the term (null: every term).
export type AttendanceViewArgs = Pick<RpcArgs<"get_attendance_overview">, "p_scope" | "p_subgroup_id" | "p_term_key">;

function db() {
  if (!supabase) throw new ApiError("The portal is not connected.");
  return supabase;
}

// ---------------------------------------------------------------- reads

/** The whole screen in one request: totals and the open review queues, never every mark. `listLimit` caps the queues. */
export async function getAttendanceOverview(view: AttendanceViewArgs, listLimit: number): Promise<RpcReturns<"get_attendance_overview">> {
  const client = db();
  return must(await client.rpc("get_attendance_overview", { ...view, p_list_limit: listLimit }));
}

/** The members of one meeting with their marks. */
export async function getAttendanceRoster(sessionId: number): Promise<RpcReturns<"get_attendance_roster">> {
  const client = db();
  return must(await client.rpc("get_attendance_roster", { p_session_id: sessionId }));
}

/** The small answer the poll asks every 10 seconds while a meeting is open (no queue cap: the poll never lists items). */
export async function getAttendancePulse(view: AttendanceViewArgs): Promise<RpcReturns<"get_attendance_pulse">> {
  const client = db();
  return must(await client.rpc("get_attendance_pulse", view));
}

/** One member's marks on some meetings and their eligibility for a term, for an executive's summary of that member. */
export type MemberAttendance = {
  records: Array<Pick<Tables<"attendance_records">, "session_id" | "status" | "minutes_late" | "unexcused_units" | "marked_at">>;
  /** null: no row, which means eligible. */
  eligibility: Pick<Tables<"attendance_eligibility">, "term_key" | "status" | "reason"> | null;
};

/**
 * The marks of ONE member on the meetings given (the overview sends an executive no marks, only totals for the flagged), and their
 * eligibility row for `termKey` (null: no term to ask about). Two plain reads of tables an executive may select under row-level
 * security (attendance_records, attendance_eligibility); the answer is the whole value or it throws, never half of it.
 */
export async function getMemberAttendance(memberId: string, sessionIds: number[], termKey: string | null): Promise<MemberAttendance> {
  const client = db();
  const readRecords = async (): Promise<MemberAttendance["records"]> => sessionIds.length
    ? must(await client.from("attendance_records").select("session_id,status,minutes_late,unexcused_units,marked_at").eq("member_id", memberId).in("session_id", sessionIds)) ?? []
    : [];
  const readEligibility = async (): Promise<MemberAttendance["eligibility"]> => termKey
    ? must(await client.from("attendance_eligibility").select("term_key,status,reason").eq("member_id", memberId).eq("term_key", termKey).maybeSingle())
    : null;
  const [records, eligibility] = await Promise.all([readRecords(), readEligibility()]);
  return { records, eligibility };
}

// ---------------------------------------------------------------- check-in and meetings

/** A member checks in with the code an executive shows. */
export async function checkInAttendance(code: string): Promise<void> {
  const client = db();
  must(await client.rpc("check_in_attendance", { p_code: code }));
}

/** Opens check-in on a meeting. The answer carries the code (once: it is not stored in readable form). */
export async function openAttendanceSession(sessionId: number, durationMinutes: number): Promise<RpcReturns<"open_attendance_session">> {
  const client = db();
  return must(await client.rpc("open_attendance_session", { p_session_id: sessionId, p_duration_minutes: durationMinutes }));
}

/** `subgroupId` is null for a club-wide meeting. */
export async function createAttendanceSession(input: { scope: "club" | "subgroup"; subgroupId: number | null; title: string; startsAt: string }): Promise<RpcReturns<"create_attendance_session">> {
  const client = db();
  return must(await client.rpc("create_attendance_session", {
    p_scope: input.scope,
    p_subgroup_id: input.subgroupId as number, // NULL for a club-wide meeting: the function takes it, the generated type cannot say so for a required argument
    p_title: input.title,
    p_starts_at: input.startsAt,
  }));
}

export async function rotateAttendanceCode(sessionId: number): Promise<RpcReturns<"rotate_attendance_code">> {
  const client = db();
  return must(await client.rpc("rotate_attendance_code", { p_session_id: sessionId }));
}

export async function closeAttendanceSession(sessionId: number): Promise<void> {
  const client = db();
  must(await client.rpc("close_attendance_session", { p_session_id: sessionId }));
}

export async function cancelAttendanceSession(sessionId: number): Promise<void> {
  const client = db();
  must(await client.rpc("cancel_attendance_session", { p_session_id: sessionId }));
}

/** Edits a meeting that has not opened. */
export async function updateAttendanceSession(input: { sessionId: number; title: string; startsAt: string }): Promise<void> {
  const client = db();
  must(await client.rpc("update_attendance_session", { p_session_id: input.sessionId, p_title: input.title, p_starts_at: input.startsAt }));
}

/** Deletes a meeting that has not opened. */
export async function deleteAttendanceSession(sessionId: number): Promise<void> {
  const client = db();
  must(await client.rpc("delete_attendance_session", { p_session_id: sessionId }));
}

/** Voids a closed meeting that should never have counted; the marks stay on file. */
export async function voidAttendanceSession(sessionId: number, reason: string): Promise<void> {
  const client = db();
  must(await client.rpc("void_attendance_session", { p_session_id: sessionId, p_reason: reason }));
}

// ---------------------------------------------------------------- marks

export async function setAttendanceStatus(input: { sessionId: number; memberId: string; status: AttendanceStatus; note: string; minutesLate: number }): Promise<void> {
  const client = db();
  must(await client.rpc("set_attendance_status", { p_session_id: input.sessionId, p_member_id: input.memberId, p_status: input.status, p_note: input.note, p_minutes_late: input.minutesLate }));
}

/** Returns a member to "pending" for a meeting. */
export async function clearAttendanceStatus(sessionId: number, memberId: string): Promise<void> {
  const client = db();
  must(await client.rpc("clear_attendance_status", { p_session_id: sessionId, p_member_id: memberId }));
}

// ---------------------------------------------------------------- absence forms

/**
 * Uploads the proof image under the member's own folder and the meeting's; resolves to the stored path. `onProgress` hears how many
 * bytes have gone (the same request storage-js sends, through XMLHttpRequest: see uploadWithProgress in _core.ts).
 */
export async function uploadExcuseProof(userId: string, sessionId: number, file: File, onProgress?: (progress: UploadProgress) => void): Promise<string> {
  const client = db();
  const path = `${userId}/${sessionId}/${crypto.randomUUID()}-${safeFileName(file)}`;
  const upload = await uploadWithProgress(client, "attendance-excuses", path, file, { upsert: false }, onProgress);
  if (upload.error) throw upload.error;
  return path;
}

/**
 * Removes a proof that no form points at (the form was refused). Storage answers a refused delete with an empty list, not an
 * error, and this does not read the answer: the old code did not either (kept; the form was refused and the person is told that).
 */
export async function removeExcuseProof(path: string): Promise<void> {
  const client = db();
  await client.storage.from("attendance-excuses").remove([path]);
}

/** A link to the proof that works for 5 minutes, or null when storage gave none. */
export async function createExcuseProofUrl(path: string): Promise<string | null> {
  const client = db();
  const { data, error } = await client.storage.from("attendance-excuses").createSignedUrl(path, 300);
  if (error) throw toApiError(error);
  return data?.signedUrl ?? null;
}

export async function submitAttendanceExcuse(input: { sessionId: number; reason: string; proofPath: string | null; reasonCategory: string; notifiedAt: string | null }): Promise<void> {
  const client = db();
  must(await client.rpc("submit_attendance_excuse", {
    p_session_id: input.sessionId,
    p_reason: input.reason,
    p_proof_path: input.proofPath,
    p_reason_category: input.reasonCategory,
    p_notified_at: input.notifiedAt,
  }));
}

export async function reviewAttendanceExcuse(input: { excuseId: number; decision: "approved" | "denied"; note: string }): Promise<void> {
  const client = db();
  must(await client.rpc("review_attendance_excuse", { p_excuse_id: input.excuseId, p_decision: input.decision, p_note: input.note }));
}

export async function withdrawAttendanceExcuse(excuseId: number): Promise<void> {
  const client = db();
  must(await client.rpc("withdraw_attendance_excuse", { p_excuse_id: excuseId }));
}

// ---------------------------------------------------------------- follow-up, eligibility, policy

export async function setAttendanceRemediation(input: { remediationId: number; status: RemediationStatus; assignment: string; dueAt: string | null; note: string | null }): Promise<void> {
  const client = db();
  must(await client.rpc("set_attendance_remediation", { p_remediation_id: input.remediationId, p_status: input.status, p_assignment: input.assignment, p_due_at: input.dueAt, p_note: input.note }));
}

export async function setAttendanceEligibility(input: { termKey: string; memberId: string; status: EligibilityStatus; reason: string }): Promise<void> {
  const client = db();
  must(await client.rpc("set_attendance_eligibility", { p_term_key: input.termKey, p_member_id: input.memberId, p_status: input.status, p_reason: input.reason }));
}

/** Unexcused units in a term before a member is flagged (warning) and before they are reviewed (critical). */
export async function setAttendanceThresholds(warning: number, critical: number): Promise<void> {
  const client = db();
  must(await client.rpc("set_attendance_thresholds", { p_warning: warning, p_critical: critical }));
}
