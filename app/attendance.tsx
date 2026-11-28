"use client";

import type { User } from "@supabase/supabase-js";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { friendlyError } from "../lib/errors";
import type { AttendanceStatus } from "../lib/db";
import { canManageClub } from "../lib/permissions";
import { readCache, writeCache } from "../lib/cache";
import { usePolling } from "../lib/hooks/use-polling";
import { supabase } from "../lib/supabase";
import type { Notify } from "../lib/toast";
import { Button } from "../components/ui/button";
import { ConfirmDialog } from "../components/ui/confirm-dialog";
import { FormDialog, type FormField } from "../components/ui/form-dialog";
import { ClearMarkButton, SessionCorrections, ThresholdSettings, WithdrawExcuseButton } from "../components/attendance/attendance-corrections";
import {
  DEFAULT_LIST_LIMIT, EMPTY_OVERVIEW, applyPulse, createFailureGate, createSequencer, flaggedSummaries, nextListLimit, normalizeOverview, overallRate, parseMinutesLate,
  pulseNeedsReload, queueNote, rosterIsStale, termChoices, termLabel,
  type AbsenceCategory, type AttendanceOverview, type AttendanceSession, type ClubRole, type EligibilityStatus, type Excuse, type Pulse,
  type Remediation, type Roster,
} from "../components/attendance/attendance-model";

type Workspace = { id: number; name: string };
type ScopeFilter = "all" | "club" | number;
type AttendanceTab = "overview" | "meetings" | "excuses";

// What an open dialog is asking about. Nothing is sent until its form is submitted.
type ActionDialog =
  | { kind: "status"; sessionId: number; memberId: string; memberName: string; status: AttendanceStatus }
  | { kind: "review"; excuse: Excuse; memberName: string; decision: "approved" | "denied" }
  | { kind: "remediation"; item: Remediation; memberName: string }
  | { kind: "eligibility"; memberId: string; memberName: string; status: EligibilityStatus }
  | { kind: "session"; sessionId: number; title: string; action: "close" | "cancel" };
type FormAction = Exclude<ActionDialog, { kind: "session" }>;

const categoryLabels: Record<AbsenceCategory, string> = {
  class_exam: "Class or exam conflict",
  family_emergency: "Family emergency",
  illness: "Illness",
  other_club_event: "Other club meeting or event",
  other: "Other",
};

const POLL_MS = 10000;
const viewKey = (scope: ScopeFilter, term: string) => `attendance2:${scope}:${term}`;

function formConfig(dialog: FormAction): { title: string; description?: string; fields: FormField[]; submitLabel: string; danger?: boolean } {
  if (dialog.kind === "status") {
    const note: FormField = { name: "note", label: "Correction note (optional)", type: "textarea", maxLength: 500 };
    return {
      title: `Mark ${dialog.memberName} ${dialog.status}`,
      fields: dialog.status === "tardy"
        ? [{ name: "minutes", label: "Minutes late", type: "number", defaultValue: "10", required: true, min: 0, max: 1440, step: 1 }, note]
        : [note],
      submitLabel: "Save mark",
    };
  }
  if (dialog.kind === "review") {
    return dialog.decision === "approved"
      ? { title: "Approve this absence form?", description: `${dialog.memberName} will be marked excused for this meeting.`, fields: [{ name: "note", label: "Approval note (optional)", type: "textarea", maxLength: 500 }], submitLabel: "Approve" }
      : { title: "Deny this absence form?", description: `${dialog.memberName} will be marked absent for this meeting.`, fields: [{ name: "note", label: "Why is this being denied?", type: "textarea", required: true, minLength: 3, maxLength: 500 }], submitLabel: "Deny form", danger: true };
  }
  if (dialog.kind === "remediation") {
    return { title: "Complete this follow-up?", description: dialog.memberName, fields: [{ name: "assignment", label: "Remediation instruction", type: "textarea", defaultValue: dialog.item.assignment, required: true, maxLength: 500 }], submitLabel: "Mark complete" };
  }
  return dialog.status === "restricted"
    ? { title: `Restrict ${dialog.memberName}?`, description: "They will not be eligible to perform this term.", fields: [{ name: "reason", label: "Reason for restricting performance eligibility", type: "textarea", required: true, minLength: 3, maxLength: 500 }], submitLabel: "Restrict", danger: true }
    : { title: dialog.status === "reinstated" ? `Reinstate ${dialog.memberName}?` : `Put ${dialog.memberName} under review?`, fields: [{ name: "reason", label: "Eligibility note (optional)", type: "textarea", maxLength: 500 }], submitLabel: dialog.status === "reinstated" ? "Reinstate" : "Mark under review" };
}

export function AttendancePage({ user, role, groups, initialScope = "all", initialTab = "overview", notify }: {
  user: User;
  role: ClubRole;
  groups: Workspace[];
  initialScope?: ScopeFilter;
  initialTab?: AttendanceTab;
  notify: Notify;
}) {
  const canManage = canManageClub(role);
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>(initialScope);
  const [termFilter, setTermFilter] = useState("all");
  // How many items each review queue lists for an executive (see queueNote in
  // attendance-model.ts). 'Show more' raises it once the server has answered
  // with the larger lists; changing the audience or term puts it back, so a long
  // list is only loaded on request. A ref, because every load reads the value
  // in force when it starts and none should start because it changed.
  const listLimit = useRef<number>(DEFAULT_LIST_LIMIT);
  const [loadingMore, setLoadingMore] = useState(false);
  // Reopening the screen shows the last data at once and refreshes behind it.
  const cacheKey = viewKey(scopeFilter, termFilter);
  const [cached] = useState(() => readCache<AttendanceOverview>(user.id, viewKey(initialScope, "all")));
  // What has been read for each audience and term this visit, so the data on
  // screen always belongs to the audience and term chosen now.
  const [views, setViews] = useState<Record<string, AttendanceOverview>>(() => cached ? { [viewKey(initialScope, "all")]: normalizeOverview(cached) } : {});
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const data = views[cacheKey] ?? null;
  const view = data ?? EMPTY_OVERVIEW;
  const sessions = view.sessions;
  const [roster, setRoster] = useState<Roster | null>(null);
  const [rosterFailed, setRosterFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<AttendanceTab>(initialTab || "overview");
  const [selectedSessionId, setSelectedSessionId] = useState<number | null>(cached?.sessions?.[0]?.id ?? null);
  const [showNewSession, setShowNewSession] = useState(false);
  const [showExcuse, setShowExcuse] = useState(false);
  const [dialog, setDialog] = useState<ActionDialog | null>(null);
  const [checkInCode, setCheckInCode] = useState("");
  const [liveCode, setLiveCode] = useState("");
  const [feedback, setFeedback] = useState("");

  // Only the answer to the newest request of each kind is used, so a slow
  // answer for an earlier audience, term or poll can never overwrite newer data.
  const [loadSeq] = useState(createSequencer);
  const [pulseSeq] = useState(createSequencer);
  const [rosterSeq] = useState(createSequencer);
  // A refresh in the background reports a failure once, not every 10 seconds.
  const [failures] = useState(createFailureGate);
  const inFlight = useRef(false);
  const latest = useRef({ key: cacheKey, data, roster, selectedSessionId, tab });
  useEffect(() => { latest.current = { key: cacheKey, data, roster, selectedSessionId, tab }; });
  useEffect(() => () => { loadSeq.invalidate(); pulseSeq.invalidate(); rosterSeq.invalidate(); }, [loadSeq, pulseSeq, rosterSeq]);

  const scopeArgs = useMemo(() => ({
    p_scope: scopeFilter === "all" ? "all" : scopeFilter === "club" ? "club" : "subgroup",
    p_subgroup_id: typeof scopeFilter === "number" ? scopeFilter : null,
    p_term_key: termFilter === "all" ? null : termFilter,
  }), [scopeFilter, termFilter]);

  const reportFailure = useCallback((background: boolean, message: string) => {
    if (failures.shouldNotify(background)) notify(message, "error");
  }, [failures, notify]);

  const load = useCallback(async (silent = false, limit: number = listLimit.current) => {
    const client = supabase;
    if (!client) return;
    const id = loadSeq.next();
    const key = cacheKey;
    if (!silent) {
      setFailedKey(null);
      // Show what this audience and term looked like last time while it refreshes.
      const earlier = readCache<AttendanceOverview>(user.id, key);
      if (earlier) setViews((current) => current[key] ? current : { ...current, [key]: normalizeOverview(earlier) });
    }
    try {
      // One request for the whole screen. It carries totals and the open
      // review queues, never every mark.
      // The overview alone takes the queue cap; the poll takes the audience only.
      const { data: result, error } = await client.rpc("get_attendance_overview", { ...scopeArgs, p_list_limit: limit });
      if (!loadSeq.isLatest(id)) return;
      if (error || !result) { reportFailure(silent, "Attendance could not be loaded. Try again in a moment."); setFailedKey(key); return; }
      failures.succeeded();
      listLimit.current = limit;
      const next = normalizeOverview(result as Partial<AttendanceOverview>);
      const ids = next.sessions.map((session) => session.id);
      setViews((current) => ({ ...current, [key]: next }));
      setFailedKey(null);
      setSelectedSessionId((current) => current && ids.includes(current) ? current : next.sessions[0]?.id || null);
      writeCache(user.id, key, next);
    } catch {
      if (!loadSeq.isLatest(id)) return;
      reportFailure(silent, "Attendance could not be loaded. Check your connection and try again.");
      setFailedKey(key);
    }
  }, [cacheKey, failures, loadSeq, reportFailure, scopeArgs, user.id]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const loadRoster = useCallback(async (sessionId: number, background = false) => {
    const client = supabase;
    if (!client) return;
    const id = rosterSeq.next();
    try {
      const { data: result, error } = await client.rpc("get_attendance_roster", { p_session_id: sessionId });
      if (!rosterSeq.isLatest(id)) return;
      if (error || !result) { setRosterFailed(true); reportFailure(background, "The roster could not be loaded. Try again in a moment."); return; }
      failures.succeeded();
      setRosterFailed(false);
      setRoster(result as Roster);
    } catch {
      if (!rosterSeq.isLatest(id)) return;
      setRosterFailed(true);
      reportFailure(background, "The roster could not be loaded. Check your connection and try again.");
    }
  }, [failures, reportFailure, rosterSeq]);

  // The meeting roster is read when a meeting is selected, not with the overview.
  // `rosterTick` reads it again although neither the tab nor the selection
  // changed: opening check-in on the meeting that is on screen adds its whole
  // roster (the roster of a draft is empty), and nothing else would refresh it.
  const [rosterTick, setRosterTick] = useState(0);
  const rereadRoster = useCallback(() => setRosterTick((count) => count + 1), []);
  useEffect(() => {
    if (!canManage || tab !== "meetings" || selectedSessionId === null) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRosterFailed(false);
    loadRoster(selectedSessionId);
  }, [canManage, tab, selectedSessionId, loadRoster, rosterTick]);

  // While check-in is open: a tiny poll every 10 seconds, only for a visible
  // page, plus one at once when the page becomes visible again. It patches the
  // open meeting in place and reads the overview again only if something it
  // cannot patch changed.
  const hasOpenSession = sessions.some((session) => session.status === "open");
  const pulse = useCallback(async () => {
    const client = supabase;
    if (!client) return;
    const key = cacheKey;
    const generation = loadSeq.current();
    const id = pulseSeq.next();
    try {
      const { data: result, error } = await client.rpc("get_attendance_pulse", scopeArgs);
      const state = latest.current;
      if (!pulseSeq.isLatest(id) || !loadSeq.isLatest(generation) || state.key !== key || !state.data) return;
      if (error || !result) { reportFailure(true, "Attendance could not be refreshed. Try again in a moment."); return; }
      failures.succeeded();
      const reply = result as Pulse;
      const watchingRoster = canManage && state.tab === "meetings" && state.selectedSessionId !== null;
      if (pulseNeedsReload(state.data.sessions, reply, state.data.excuses_pending, canManage, state.data.items_version)) {
        load(true);
        if (watchingRoster && state.selectedSessionId !== null) loadRoster(state.selectedSessionId, true);
        return;
      }
      setViews((current) => current[key] ? { ...current, [key]: { ...current[key], ...applyPulse(current[key], reply) } } : current);
      // The open meeting's marks changed since its roster was read: read it again.
      const watched = reply.sessions.find((session) => session.id === state.selectedSessionId);
      if (watchingRoster && watched && rosterIsStale(state.roster, watched)) loadRoster(watched.id, true);
    } catch {
      if (!pulseSeq.isLatest(id)) return;
      reportFailure(true, "Attendance could not be refreshed. Check your connection and try again.");
    }
  }, [cacheKey, canManage, failures, load, loadRoster, loadSeq, pulseSeq, reportFailure, scopeArgs]);

  usePolling(pulse, POLL_MS, hasOpenSession);

  const selectedSession = sessions.find((session) => session.id === selectedSessionId) || null;
  const termOptions = useMemo(() => termChoices(view.terms, termFilter), [view.terms, termFilter]);
  const openSession = sessions.find((session) => session.status === "open");
  const closedSessions = useMemo(() => sessions.filter((session) => session.status === "closed" && session.counts_toward_metrics), [sessions]);
  const warningLevel = view.settings?.warning_absences ?? 2;
  const criticalLevel = view.settings?.critical_absences ?? 3;
  const summaries = useMemo(
    () => flaggedSummaries(view.flagged, view.profiles, { warning: warningLevel, critical: criticalLevel }),
    [view.flagged, view.profiles, warningLevel, criticalLevel],
  );
  const knownGroupName = (id: number) => groups.find((group) => group.id === id)?.name || sessions.find((session) => session.subgroup_id === id)?.subgroup_name || "Subgroup";
  const scopeLabel = scopeFilter === "all" ? "All activity" : scopeFilter === "club" ? "Club-wide" : knownGroupName(scopeFilter);
  // The absence forms, their count and the open follow-up items all follow the
  // View and Term filters (the screen once showed every one whatever the term),
  // so the panels say which view they are listing.
  const viewLabel = `${scopeLabel} · ${termFilter === "all" ? "All terms" : termLabel(termFilter)}`;
  const scopeInGroups = typeof scopeFilter !== "number" || groups.some((group) => group.id === scopeFilter);
  const profileName = (memberId: string) => { const profile = view.profiles.find((item) => item.id === memberId); return profile?.full_name || profile?.email || "Member"; };

  const overall = overallRate(view.attended_total, view.absent_total);
  const flagged = summaries;
  const pendingExcuseCount = view.excuses_pending;
  const ownRecords = view.records;
  const ownEligibility = view.eligibility[0];
  const ownRemediations = view.remediations;
  const pendingRemediations = view.remediations.filter((item) => item.status === "pending");

  // One request at a time for anything that writes, so a double click sends one.
  async function exclusive(work: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setSaving(true);
    try { await work(); } finally { inFlight.current = false; setSaving(false); }
  }

  // After anything changed on the server: read the overview again and, when the
  // Meetings tab shows a roster, that roster too. Closing or canceling check-in
  // and every mark go through here.
  function refresh() {
    load(true);
    rereadRoster();
  }

  async function checkIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const client = supabase;
    if (!client) return;
    await exclusive(async () => {
      setFeedback("");
      const { error } = await client.rpc("check_in_attendance", { p_code: checkInCode.replace(/\s/g, "").toUpperCase() });
      if (error) setFeedback(error.message);
      else { setFeedback("You are checked in. Your attendance is confirmed."); setCheckInCode(""); notify("Attendance confirmed"); load(); }
    });
  }

  // Opens check-in for a meeting; returns whether it opened.
  async function openCheckIn(client: NonNullable<typeof supabase>, sessionId: number, duration: number) {
    setFeedback("");
    const { data: opened, error } = await client.rpc("open_attendance_session", { p_session_id: sessionId, p_duration_minutes: duration });
    if (error) {
      const message = `Could not open check-in: ${error.message}`;
      setFeedback(message);
      notify(message, "error");
      return;
    }
    const result = Array.isArray(opened) ? opened[0] : opened;
    // `code` is not a column the function returns (none of the migrations ever returned it): an old fallback that never fires. The cast keeps it.
    const code = result?.check_in_code || (result as { code?: string } | undefined)?.code || "";
    if (!code) {
      const message = "Check-in opened, but no sign-in code was returned. Refresh and try again.";
      setFeedback(message);
      notify(message, "error");
      rereadRoster();
      await load();
      return;
    }
    setLiveCode(code);
    setTab("meetings");
    // Opening adds every participant to the meeting. If it is on screen as a
    // draft its roster is empty and nothing else would refresh it.
    rereadRoster();
    notify("Check-in is open");
    await load();
  }

  async function createSession(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const client = supabase;
    if (!client) return;
    const form = new FormData(event.currentTarget);
    await exclusive(async () => {
      const audience = String(form.get("audience") || "club");
      const subgroupId = audience.startsWith("subgroup:") ? Number(audience.slice("subgroup:".length)) : null;
      const groupName = groups.find((group) => group.id === subgroupId)?.name;
      const { data: created, error } = await client.rpc("create_attendance_session", {
        p_scope: subgroupId === null ? "club" : "subgroup",
        p_subgroup_id: subgroupId as number, // NULL for a club-wide meeting: the function takes it, the generated type cannot say so for a required argument
        p_title: subgroupId === null ? "General Body Meeting" : `${groupName || "Subgroup"} rehearsal`,
        p_starts_at: new Date(String(form.get("starts_at"))).toISOString(),
      });
      if (error) { notify(friendlyError(error, "The meeting could not be created."), "error"); return; }
      const session = Array.isArray(created) ? created[0] : created;
      if (form.get("open_now") === "on" && session?.id) await openCheckIn(client, session.id, Number(form.get("duration") || 60));
      setShowNewSession(false);
      notify("Meeting created");
      load();
    });
  }

  async function openAttendance(sessionId: number) {
    const client = supabase;
    if (!client) return;
    await exclusive(() => openCheckIn(client, sessionId, 60));
  }

  async function rotateCode(sessionId: number) {
    const client = supabase;
    if (!client) return;
    await exclusive(async () => {
      const { data: rotated, error } = await client.rpc("rotate_attendance_code", { p_session_id: sessionId });
      if (error) notify(friendlyError(error, "The code could not be changed."), "error");
      else { const result = Array.isArray(rotated) ? rotated[0] : rotated; setLiveCode(result?.check_in_code || /* `code` is never returned: see openCheckIn */ (result as { code?: string } | undefined)?.code || ""); notify("A new code is active"); load(); }
    });
  }

  // Runs the request behind an open dialog. A failure keeps the dialog open;
  // cancelling a dialog never sends anything.
  async function runDialog(call: (client: NonNullable<typeof supabase>) => PromiseLike<{ error: { message?: string; code?: string } | null }>, success: string, fallback: string, onDone?: () => void) {
    const client = supabase;
    if (!client) return;
    await exclusive(async () => {
      const { error } = await call(client);
      if (error) { notify(friendlyError(error, fallback), "error"); return; }
      setDialog(null);
      onDone?.();
      notify(success, "success");
      refresh();
    });
  }

  function submitDialog(values: Record<string, string>) {
    if (!dialog || dialog.kind === "session") return;
    if (dialog.kind === "status") {
      const { sessionId, memberId, status } = dialog;
      let minutesLate = 0;
      if (status === "tardy") {
        const minutes = parseMinutesLate(values.minutes ?? "");
        if (minutes === null) { notify("Enter a whole number of minutes, from 0 to 1440.", "error"); return; }
        minutesLate = minutes;
      }
      runDialog((client) => client.rpc("set_attendance_status", { p_session_id: sessionId, p_member_id: memberId, p_status: status, p_note: values.note ?? "", p_minutes_late: minutesLate }), "Attendance updated", "The mark could not be saved.");
    } else if (dialog.kind === "review") {
      const { excuse, decision } = dialog;
      runDialog((client) => client.rpc("review_attendance_excuse", { p_excuse_id: excuse.id, p_decision: decision, p_note: values.note ?? "" }), `Absence form ${decision}`, "The form could not be reviewed.");
    } else if (dialog.kind === "remediation") {
      const { item } = dialog;
      runDialog((client) => client.rpc("set_attendance_remediation", { p_remediation_id: item.id, p_status: "complete", p_assignment: values.assignment ?? item.assignment, p_due_at: item.due_at, p_note: null }), "Remediation updated", "The follow-up could not be updated.");
    } else {
      const { memberId, status } = dialog;
      runDialog((client) => client.rpc("set_attendance_eligibility", { p_term_key: view.summary_term, p_member_id: memberId, p_status: status, p_reason: values.reason ?? "" }), "Eligibility updated", "Eligibility could not be updated.");
    }
  }

  function confirmSession() {
    if (!dialog || dialog.kind !== "session") return;
    const { sessionId, action } = dialog;
    runDialog(
      (client) => client.rpc(action === "close" ? "close_attendance_session" : "cancel_attendance_session", { p_session_id: sessionId }),
      action === "close" ? "Attendance closed" : "Meeting canceled",
      action === "close" ? "Attendance could not be closed." : "The meeting could not be canceled.",
      () => setLiveCode(""),
    );
  }

  async function submitExcuse(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const client = supabase;
    if (!client) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const file = form.get("proof") as File;
    if (file?.size && file.size > 8 * 1024 * 1024) { notify("Proof images must be smaller than 8 MB", "error"); return; }
    if (file?.size && !file.type.startsWith("image/")) { notify("Choose an image as proof", "error"); return; }
    await exclusive(async () => {
      const sessionId = Number(form.get("session_id"));
      let proofPath: string | null = null;
      if (file?.size) {
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "-");
        proofPath = `${user.id}/${sessionId}/${crypto.randomUUID()}-${safeName}`;
        const upload = await client.storage.from("attendance-excuses").upload(proofPath, file, { upsert: false });
        if (upload.error) { notify(upload.error.message, "error"); return; }
      }
      const { error } = await client.rpc("submit_attendance_excuse", {
        p_session_id: sessionId,
        p_reason: String(form.get("reason") || ""),
        p_proof_path: proofPath,
        p_reason_category: String(form.get("reason_category") || "other"),
        p_notified_at: form.get("notified") === "on" ? new Date().toISOString() : null,
      });
      if (error) {
        if (proofPath) await client.storage.from("attendance-excuses").remove([proofPath]);
        notify(error.message, "error");
        return;
      }
      formElement.reset();
      setShowExcuse(false);
      notify("Absence form submitted");
      load();
    });
  }

  async function openProof(excuse: Excuse) {
    if (!supabase || !excuse.proof_path) return;
    const { data: signed, error } = await supabase.storage.from("attendance-excuses").createSignedUrl(excuse.proof_path, 300);
    if (error || !signed) notify("Proof could not be opened", "error"); else window.open(signed.signedUrl, "_blank", "noopener,noreferrer");
  }

  function changeScope(value: ScopeFilter) {
    setScopeFilter(value);
    listLimit.current = DEFAULT_LIST_LIMIT;
    setTab("overview");
    setLiveCode("");
    setFeedback("");
  }

  function changeTerm(value: string) {
    setTermFilter(value);
    listLimit.current = DEFAULT_LIST_LIMIT;
    setTab("overview");
    setLiveCode("");
    setFeedback("");
  }

  if (!data) {
    return <section className="section-shell page-section">
      {failedKey === cacheKey
        ? <div className="inline-loading">Attendance could not be loaded. <Button size="sm" variant="secondary" onClick={() => load()}>Try again</Button></div>
        : <div className="inline-loading">Loading attendance…</div>}
    </section>;
  }

  const form = dialog && dialog.kind !== "session" ? formConfig(dialog) : null;
  const rosterReady = roster !== null && selectedSession !== null && roster.session_id === selectedSession.id;
  const remediationNote = queueNote(pendingRemediations.length, view.remediations_pending, "open items", view.list_limit);
  const excuseNote = queueNote(view.excuses.length, view.excuses_total, "absence forms", view.list_limit);
  // 'Show more' asks the server for the next cap and keeps it for later loads
  // only once the larger lists have arrived (a failure leaves the page as it was
  // and the button to try again). It is absent once the most the server gives is
  // already in force.
  const nextLimit = canManage ? nextListLimit(view.list_limit) : null;
  const showMore = nextLimit === null ? null : () => {
    if (loadingMore) return;
    setLoadingMore(true);
    load(false, nextLimit).finally(() => setLoadingMore(false));
  };

  return <section className="section-shell page-section attendance-page">
    <div className="attendance-title-row">
      <div><p className="eyebrow">MEETINGS</p><h1>Attendance</h1><p>Check in to club-wide and subgroup meetings, review attendance, and handle absence forms.</p></div>
      <div className="attendance-title-actions">
        <label className="scope-picker"><span>View</span><select aria-label="Filter attendance by audience" value={typeof scopeFilter === "number" ? `group:${scopeFilter}` : scopeFilter} onChange={(event) => { const next = event.target.value; changeScope(next.startsWith("group:") ? Number(next.slice(6)) : next as "all" | "club"); }}><option value="all">All activity</option><option value="club">Club-wide meetings</option>{groups.map((group) => <option key={group.id} value={`group:${group.id}`}>{group.name} rehearsals</option>)}{!scopeInGroups && <option value={`group:${scopeFilter}`}>{scopeLabel} rehearsals</option>}</select></label>
        <label className="scope-picker"><span>Term</span><select aria-label="Filter attendance by term" value={termFilter} onChange={(event) => changeTerm(event.target.value)}><option value="all">All terms</option>{termOptions.map((term) => <option key={term} value={term}>{termLabel(term)}</option>)}</select></label>
        {canManage && <Button onClick={() => setShowNewSession(true)}>＋ New meeting</Button>}
      </div>
    </div>

    <form className="attendance-checkin" onSubmit={checkIn}><div><p className="eyebrow">MEMBER CHECK-IN</p><h2>Enter the meeting code</h2><p>Use the code shown by an executive while check-in is open.</p></div><div><input value={checkInCode} onChange={(event) => setCheckInCode(event.target.value)} required minLength={6} maxLength={8} inputMode="numeric" autoComplete="one-time-code" placeholder="000000" aria-label="Attendance code" /><Button type="submit" disabled={saving} className="shrink-0 bg-[var(--paper)] text-[var(--ink)] hover:bg-[var(--carolina-pale)]">{saving ? "Checking…" : "Check in"}</Button></div>{feedback && <p className={`attendance-feedback ${feedback.includes("confirmed") ? "success" : "error"}`} role="status">{feedback}</p>}</form>

    {canManage ? <>
      <div className="attendance-summary-grid"><Stat label="Closed meetings" value={closedSessions.length} /><Stat label="Attendance rate" value={`${overall}%`} /><Stat label="At policy limit" value={summaries.filter((item) => item.flag === "warning").length} tone="warning" /><Stat label="Needs review" value={summaries.filter((item) => item.flag === "critical").length} tone="critical" /></div>
      {openSession && <div className="attendance-live"><div><p className="eyebrow">LIVE NOW</p><h2>{openSession.title}</h2><p>{openSession.live?.checked_in_count ?? 0} of {openSession.live?.roster_count ?? 0} checked in</p></div><div className="attendance-live-code"><small>CHECK-IN CODE</small><strong>{liveCode || "Hidden after reload"}</strong><span>{liveCode ? "Share this with members" : "Rotate the code to display a new one"}</span></div><div className="attendance-live-actions"><Button variant="secondary" onClick={() => rotateCode(openSession.id)} disabled={saving}>Rotate code</Button><Button onClick={() => setDialog({ kind: "session", sessionId: openSession.id, title: openSession.title, action: "close" })} disabled={saving}>Close attendance</Button><Button variant="danger" onClick={() => setDialog({ kind: "session", sessionId: openSession.id, title: openSession.title, action: "cancel" })} disabled={saving}>Cancel meeting</Button></div></div>}
       <div className="attendance-tabs" role="tablist"><button type="button" role="tab" aria-selected={tab === "overview"} className={tab === "overview" ? "active" : ""} onClick={(event) => { event.preventDefault(); event.stopPropagation(); setTab("overview"); }}>Overview</button><button type="button" role="tab" aria-selected={tab === "meetings"} className={tab === "meetings" ? "active" : ""} onClick={(event) => { event.preventDefault(); event.stopPropagation(); setTab("meetings"); }}>Meetings</button><button type="button" role="tab" aria-selected={tab === "excuses"} className={tab === "excuses" ? "active" : ""} onClick={(event) => { event.preventDefault(); event.stopPropagation(); setTab("excuses"); }}>Absence forms {pendingExcuseCount ? `(${pendingExcuseCount})` : ""}</button></div>
      {tab === "overview" && <>
        <div className="attendance-panel"><div className="attendance-panel-heading"><div><p className="eyebrow">POLICY FLAGS</p><h2>Members needing attention</h2></div><span>At {warningLevel} · Review over {criticalLevel - 1} unexcused units <ThresholdSettings warning={warningLevel} critical={criticalLevel} notify={notify} onChanged={() => load(true)} /></span></div>{flagged.length ? <div className="attendance-flags">{flagged.map((summary) => <article key={summary.memberId} className={summary.flag}><div><b>{summary.name}</b><small>{summary.email}</small></div><span>{summary.rate}% attendance</span><strong>{formatUnits(summary.unexcusedUnits)} unexcused</strong><i>{summary.eligibility.replace("_", " ")}</i><div className="attendance-inline-actions"><Button size="sm" variant="secondary" disabled={saving} onClick={() => setDialog({ kind: "eligibility", memberId: summary.memberId, memberName: summary.name, status: "under_review" })}>Review</Button><Button size="sm" variant={summary.eligibility === "restricted" ? "secondary" : "danger"} disabled={saving} onClick={() => setDialog({ kind: "eligibility", memberId: summary.memberId, memberName: summary.name, status: summary.eligibility === "restricted" ? "reinstated" : "restricted" })}>{summary.eligibility === "restricted" ? "Reinstate" : "Restrict"}</Button></div></article>)}</div> : <div className="attendance-empty">No members are currently flagged in this view.</div>}</div>
        <div className="attendance-panel attendance-remediation-panel"><div className="attendance-panel-heading"><div><p className="eyebrow">REMEDIATION</p><h2>Open follow-up</h2></div><span>{view.remediations_pending} pending · {viewLabel}</span></div>{pendingRemediations.length ? <div className="remediation-list">{pendingRemediations.map((item) => { const session = sessions.find((sessionItem) => sessionItem.id === item.session_id); return <article key={item.id}><div><b>{profileName(item.member_id)}</b><small>{session?.title || "Meeting"} · {item.assignment}</small></div><Button size="sm" disabled={saving} onClick={() => setDialog({ kind: "remediation", item, memberName: profileName(item.member_id) })}>Mark complete</Button></article>; })}</div> : <div className="attendance-empty">No open remediation items.</div>}<QueueNote note={remediationNote} onShowMore={showMore} busy={loadingMore} /></div>
      </>}
      {tab === "meetings" && (
        <div className="attendance-meetings">
          <aside>
            {sessions.length ? sessions.map((session) => (
              <button type="button" className={selectedSessionId === session.id ? "active" : ""} key={session.id} onClick={() => setSelectedSessionId(session.id)}>
                <span className={`attendance-status ${session.status}`}>{session.status}</span>
                <b>{session.title}</b>
                <small>{sessionAudience(session, groups)} · {formatDateTime(session.starts_at)}</small>
              </button>
            )) : <div className="attendance-empty">No meetings yet.</div>}
          </aside>
          <div className="attendance-panel">
            {selectedSession ? (
              <>
                <div className="attendance-panel-heading">
                  <div><p className="eyebrow">{selectedSession.status.toUpperCase()}</p><h2>{selectedSession.title}</h2><span>{sessionAudience(selectedSession, groups)} · {formatDateTime(selectedSession.starts_at)}</span></div>
                  <div>{selectedSession.status === "draft" && <Button type="button" onClick={() => openAttendance(selectedSession.id)} disabled={saving}>Open check-in</Button>}{selectedSession.status === "open" && <Button type="button" onClick={() => setDialog({ kind: "session", sessionId: selectedSession.id, title: selectedSession.title, action: "close" })} disabled={saving}>Close</Button>}<SessionCorrections key={selectedSession.id} session={selectedSession} notify={notify} onChanged={() => load()} /></div>
                </div>
                <div className="attendance-roster">
                  <div className="attendance-roster-head"><span>Member</span><span>Status</span><span>Policy impact</span><span>Action</span></div>
                  {rosterReady ? roster.rows.map((row) => {
                    const memberName = row.full_name || row.email || "member";
                    return (
                      <div className="attendance-roster-row" key={row.member_id}>
                        <div><b>{row.full_name || row.email || "Member"}</b><small>{row.email}</small></div>
                        <span className={`attendance-status ${row.status || "pending"}`}>{row.status || "pending"}</span>
                        <span>{row.status === "tardy" ? `${row.minutes_late} min late · ${formatUnits(row.unexcused_units ?? 0)} unexcused` : row.status === "absent" ? "1 unexcused" : row.status === "excused" ? "Remediation required" : "-"}</span>
                        <select value={row.status || "pending"} disabled={saving} onChange={(event) => setDialog({ kind: "status", sessionId: selectedSession.id, memberId: row.member_id, memberName, status: event.target.value as AttendanceStatus })} aria-label={`Attendance status for ${memberName}`}>
                          <option value="pending" disabled>Pending</option><option value="present">Present</option><option value="tardy">Tardy</option><option value="absent">Absent</option><option value="excused">Excused</option>
                        </select>
                        {row.status && selectedSession.status !== "canceled" && <ClearMarkButton sessionId={selectedSession.id} memberId={row.member_id} memberName={memberName} notify={notify} onChanged={refresh} />}
                      </div>
                    );
                  }) : rosterFailed ? <div className="attendance-empty">The roster could not be loaded. <Button size="sm" variant="secondary" onClick={() => loadRoster(selectedSession.id)}>Try again</Button></div> : <div className="inline-loading">Loading roster…</div>}
                </div>
              </>
            ) : <div className="attendance-empty">Choose a meeting to view its roster.</div>}
          </div>
        </div>
      )}
      {tab === "excuses" && <div className="attendance-panel"><div className="attendance-panel-heading"><div><p className="eyebrow">PRIVATE REVIEW QUEUE</p><h2>Absence forms</h2></div><span>{pendingExcuseCount} awaiting review · {viewLabel}</span></div><div className="excuse-list">{view.excuses.length ? view.excuses.map((excuse) => { const session = sessions.find((item) => item.id === excuse.session_id); return <article key={excuse.id}><div><span className={`attendance-status ${excuse.status}`}>{excuse.status}</span><h3>{profileName(excuse.member_id)}</h3><small>{session?.title} · {session ? formatDateTime(session.starts_at) : "Meeting"} · {categoryLabels[excuse.reason_category]}</small><p>{excuse.reason}</p><small>{excuse.notified_at ? `Executive notified ${formatDateTime(excuse.notified_at)}` : "No notification time recorded"}</small>{excuse.review_note && <p className="review-note">Executive note: {excuse.review_note}</p>}</div><div>{excuse.proof_path && <Button variant="secondary" onClick={() => openProof(excuse)}>View proof</Button>}{excuse.status === "pending" && <><Button disabled={saving} onClick={() => setDialog({ kind: "review", excuse, memberName: profileName(excuse.member_id), decision: "approved" })}>Approve</Button><Button variant="danger" disabled={saving} onClick={() => setDialog({ kind: "review", excuse, memberName: profileName(excuse.member_id), decision: "denied" })}>Deny</Button></>}</div></article>; }) : <div className="attendance-empty">No absence forms have been submitted.</div>}</div><QueueNote note={excuseNote} onShowMore={showMore} busy={loadingMore} /></div>}
    </> : <>
      <div className="attendance-summary-grid member"><Stat label="Present" value={ownRecords.filter((record) => record.status === "present").length} /><Stat label="Excused" value={ownRecords.filter((record) => record.status === "excused").length} /><Stat label="Tardy" value={ownRecords.filter((record) => record.status === "tardy").length} /><Stat label="Absent" value={ownRecords.filter((record) => record.status === "absent").length} tone={ownRecords.filter((record) => record.status === "absent").length >= 2 ? "warning" : undefined} /></div>
      {ownEligibility && ownEligibility.status !== "eligible" && <div className={`attendance-eligibility-notice ${ownEligibility.status}`}><b>Performance eligibility: {ownEligibility.status.replace("_", " ")}</b>{ownEligibility.reason && <span>{ownEligibility.reason}</span>}</div>}
      <div className="member-attendance-grid"><div className="attendance-panel"><div className="attendance-panel-heading"><div><p className="eyebrow">MY HISTORY</p><h2>Meeting attendance</h2></div><span>{scopeLabel} · {termFilter === "all" ? "All terms" : termLabel(termFilter)}</span></div><div className="member-history">{sessions.length ? sessions.filter((session) => session.status !== "draft").map((session) => { const record = ownRecords.find((item) => item.session_id === session.id); return <article key={session.id}><div><b>{session.title}</b><small>{formatDateTime(session.starts_at)}</small></div><span className={`attendance-status ${record?.status || session.status}`}>{record?.status || session.status}{record?.status === "tardy" ? ` · ${record.minutes_late}m` : ""}</span></article>; }) : <div className="attendance-empty">No meetings are available for this view.</div>}</div></div><div className="attendance-panel"><div className="attendance-panel-heading"><div><p className="eyebrow">ABSENCE SUPPORT</p><h2>Need an excuse?</h2></div></div><p className="attendance-help">Submit the form for any absence. Executives decide whether it is excused under club policy. Proof is optional.</p><Button onClick={() => setShowExcuse(true)} disabled={!sessions.some((session) => session.status !== "canceled")}>Submit absence form</Button><div className="member-excuses">{view.excuses.map((excuse) => <article key={excuse.id}><div><b>{sessions.find((session) => session.id === excuse.session_id)?.title || "Meeting"}</b><small>{formatDateTime(excuse.submitted_at)}</small></div><span className={`attendance-status ${excuse.status}`}>{excuse.status}</span>{excuse.status === "pending" && excuse.member_id === user.id && <WithdrawExcuseButton excuseId={excuse.id} notify={notify} onChanged={() => load(true)} />}</article>)}</div>{ownRemediations.length > 0 && <div className="member-remediation"><h3>Remediation</h3>{ownRemediations.map((item) => <article key={item.id}><span>{item.assignment}</span><b className={item.status}>{item.status}</b></article>)}</div>}</div></div>
    </>}

    {showNewSession && <div className="modal-backdrop"><form className="modal attendance-modal" onSubmit={createSession}><button type="button" className="modal-close" onClick={() => setShowNewSession(false)}>×</button><p className="eyebrow">NEW MEETING</p><h2>New meeting</h2><p className="modal-copy">Create a club-wide meeting or subgroup rehearsal.</p><label>Audience<select name="audience" defaultValue={typeof scopeFilter === "number" && scopeInGroups ? `subgroup:${scopeFilter}` : "club"}><option value="club">Club-wide · General Body Meeting</option>{groups.map((group) => <option key={group.id} value={`subgroup:${group.id}`}>{group.name} · Subgroup rehearsal</option>)}</select></label><label>Meeting date and time<input name="starts_at" type="datetime-local" required defaultValue={localDateTime()} /></label><label>Code duration<select name="duration" defaultValue="60"><option value="15">15 minutes</option><option value="30">30 minutes</option><option value="60">1 hour</option><option value="120">2 hours</option></select></label><label className="check-label"><input name="open_now" type="checkbox" defaultChecked /> Open check-in immediately</label><Button type="submit" disabled={saving}>{saving ? "Creating…" : "Create meeting"}</Button></form></div>}
    {showExcuse && <div className="modal-backdrop"><form className="modal attendance-modal" onSubmit={submitExcuse}><button type="button" className="modal-close" onClick={() => setShowExcuse(false)}>×</button><p className="eyebrow">PRIVATE SUBMISSION</p><h2>Absence form</h2><p className="modal-copy">Submit this for every absence. An executive will decide whether it is excused.</p><label>Meeting<select name="session_id" required defaultValue=""><option value="" disabled>Choose a meeting</option>{sessions.filter((session) => session.status !== "canceled").map((session) => <option value={session.id} key={session.id}>{session.title} · {formatDateTime(session.starts_at)}</option>)}</select></label><label>Reason category<select name="reason_category" defaultValue="other">{Object.entries(categoryLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label>What happened<textarea name="reason" required rows={4} minLength={10} maxLength={3000} placeholder="Share the context executives need to review…" /></label><label className="check-label"><input name="notified" type="checkbox" /> I notified an executive</label><label>Proof image <span className="optional-label">(optional)</span><input name="proof" type="file" accept="image/*" /><small>JPG, PNG, HEIC, or another image up to 8 MB.</small></label><Button type="submit" disabled={saving}>{saving ? "Submitting…" : "Submit form"}</Button></form></div>}

    {form && <FormDialog open title={form.title} description={form.description} fields={form.fields} submitLabel={form.submitLabel} danger={form.danger} busy={saving} onSubmit={submitDialog} onCancel={() => setDialog(null)} />}
    <ConfirmDialog
      open={dialog?.kind === "session"}
      title={dialog?.kind === "session" && dialog.action === "cancel" ? "Cancel this meeting?" : "Close check-in?"}
      confirmLabel={dialog?.kind === "session" && dialog.action === "cancel" ? "Cancel meeting" : "Close attendance"}
      danger={dialog?.kind === "session" && dialog.action === "cancel"}
      busy={saving}
      onConfirm={confirmSession}
      onCancel={() => setDialog(null)}
    >
      {dialog?.kind === "session" && dialog.action === "cancel" ? "It will not count toward attendance." : "Everyone still missing is marked absent."}
    </ConfirmDialog>
  </section>;
}

// Says a list is capped and, when a larger cap exists, offers the next one.
function QueueNote({ note, onShowMore, busy }: { note: string; onShowMore: (() => void) | null; busy: boolean }) {
  if (!note) return null;
  return <p className="attendance-help">{note} {onShowMore && <Button size="sm" variant="secondary" disabled={busy} onClick={onShowMore}>{busy ? "Loading…" : "Show more"}</Button>}</p>;
}

function Stat({ label, value, tone }: { label: string; value: string | number; tone?: "warning" | "critical" }) {
  return <div className={tone || ""}><small>{label}</small><strong>{value}</strong></div>;
}

function formatUnits(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function sessionAudience(session: AttendanceSession, groups: Workspace[]) {
  return session.scope === "club" ? "Club-wide" : `${session.subgroup_name || groups.find((group) => group.id === session.subgroup_id)?.name || "Subgroup"} rehearsal`;
}

function formatDateTime(value: string | null | undefined) {
  const date = new Date(value || "");
  if (!Number.isFinite(date.getTime())) return "Date unavailable";
  try {
    return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
  } catch {
    return "Date unavailable";
  }
}

function localDateTime() {
  const date = new Date(Date.now() - new Date().getTimezoneOffset() * 60000);
  return date.toISOString().slice(0, 16);
}
