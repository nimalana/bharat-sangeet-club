"use client";

import type { User } from "@supabase/supabase-js";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { Button } from "../components/ui/button";

type ClubRole = "member" | "executive" | "admin";
type Workspace = { id: number; name: string };
type ScopeFilter = "all" | "club" | number;
type SessionStatus = "draft" | "open" | "closed" | "canceled";
type RecordStatus = "pending" | "present" | "absent" | "excused" | "tardy";
type ExcuseStatus = "pending" | "approved" | "denied";
type RemediationStatus = "pending" | "complete" | "waived";
type EligibilityStatus = "eligible" | "under_review" | "restricted" | "reinstated";
type AbsenceCategory = "class_exam" | "family_emergency" | "illness" | "other_club_event" | "other";

type AttendanceSession = {
  id: number;
  scope: "club" | "subgroup";
  subgroup_id: number | null;
  title: string;
  starts_at: string;
  status: SessionStatus;
  opened_at: string | null;
  closes_at: string | null;
  closed_at: string | null;
  canceled_at: string | null;
  code_expires_at: string | null;
  created_at: string;
  counts_toward_metrics: boolean;
};
type AttendanceRecord = {
  session_id: number;
  member_id: string;
  status: RecordStatus;
  source: string;
  note: string | null;
  marked_at: string | null;
  minutes_late: number;
  unexcused_units: number;
};
type Participant = { session_id: number; member_id: string; snapshotted_at: string };
type Profile = { id: string; full_name: string; email: string };
type Excuse = {
  id: number;
  session_id: number;
  member_id: string;
  reason: string;
  proof_path: string | null;
  reason_category: AbsenceCategory;
  notified_at: string | null;
  status: ExcuseStatus;
  submitted_at: string;
  reviewed_at: string | null;
  review_note: string | null;
};
type Remediation = {
  id: number;
  session_id: number;
  member_id: string;
  assignment: string;
  due_at: string | null;
  status: RemediationStatus;
  note: string | null;
};
type Eligibility = { term_key: string; member_id: string; status: EligibilityStatus; reason: string | null };

const categoryLabels: Record<AbsenceCategory, string> = {
  class_exam: "Class or exam conflict",
  family_emergency: "Family emergency",
  illness: "Illness",
  other_club_event: "Other club meeting or event",
  other: "Other",
};

export function AttendancePage({ user, role, groups, initialScope = "all", notify }: {
  user: User;
  role: ClubRole;
  groups: Workspace[];
  initialScope?: ScopeFilter;
  notify: (message: string) => void;
}) {
  const canManage = role !== "member";
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>(initialScope);
  const [termFilter, setTermFilter] = useState("all");
  const [sessions, setSessions] = useState<AttendanceSession[]>([]);
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [excuses, setExcuses] = useState<Excuse[]>([]);
  const [remediations, setRemediations] = useState<Remediation[]>([]);
  const [eligibility, setEligibility] = useState<Eligibility[]>([]);
  const [thresholds, setThresholds] = useState({ warning: 2, critical: 3 });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<"overview" | "meetings" | "excuses">("overview");
  const [selectedSessionId, setSelectedSessionId] = useState<number | null>(null);
  const [showNewSession, setShowNewSession] = useState(false);
  const [showExcuse, setShowExcuse] = useState(false);
  const [checkInCode, setCheckInCode] = useState("");
  const [liveCode, setLiveCode] = useState("");
  const [feedback, setFeedback] = useState("");

  const load = useCallback(async (silent = false) => {
    if (!supabase) return;
    if (!silent) setLoading(true);
    try {
      const { data: sessionData, error: sessionError } = await supabase
        .from("attendance_sessions")
        .select("id,scope,subgroup_id,title,starts_at,status,opened_at,closes_at,closed_at,canceled_at,code_expires_at,created_at,counts_toward_metrics")
        .order("starts_at", { ascending: false });
      const allSessions = (sessionData || []) as AttendanceSession[];
      const nextSessions = allSessions.filter((session) => scopeFilter === "all" || (scopeFilter === "club" ? session.scope === "club" : session.subgroup_id === scopeFilter));
      const ids = nextSessions.map((session) => session.id);
      const [recordResult, participantResult, excuseResult, profileResult, settingsResult, remediationResult, eligibilityResult] = await Promise.all([
        ids.length ? supabase.from("attendance_records").select("session_id,member_id,status,source,note,marked_at,minutes_late,unexcused_units").in("session_id", ids) : Promise.resolve({ data: [], error: null }),
        ids.length ? supabase.from("attendance_session_participants").select("session_id,member_id,snapshotted_at").in("session_id", ids) : Promise.resolve({ data: [], error: null }),
        ids.length ? supabase.from("attendance_excuses").select("id,session_id,member_id,reason,proof_path,reason_category,notified_at,status,submitted_at,reviewed_at,review_note").in("session_id", ids).order("submitted_at", { ascending: false }) : Promise.resolve({ data: [], error: null }),
        canManage ? supabase.from("profiles").select("id,full_name,email").order("full_name") : supabase.from("profiles").select("id,full_name,email").eq("id", user.id),
        supabase.from("attendance_settings").select("warning_absences,critical_absences").eq("id", true).maybeSingle(),
        ids.length ? supabase.from("attendance_remediations").select("id,session_id,member_id,assignment,due_at,status,note").in("session_id", ids).order("created_at", { ascending: false }) : Promise.resolve({ data: [], error: null }),
        supabase.from("attendance_eligibility").select("term_key,member_id,status,reason"),
      ]);
      if (sessionError || recordResult.error || participantResult.error || excuseResult.error || profileResult.error || settingsResult.error || remediationResult.error || eligibilityResult.error) notify("Some attendance information could not be loaded");
      setSessions(nextSessions);
      setRecords((recordResult.data || []) as AttendanceRecord[]);
      setParticipants((participantResult.data || []) as Participant[]);
      setExcuses((excuseResult.data || []) as Excuse[]);
      setProfiles((profileResult.data || []) as Profile[]);
      setRemediations((remediationResult.data || []) as Remediation[]);
      setEligibility((eligibilityResult.data || []) as Eligibility[]);
      if (settingsResult.data) setThresholds({ warning: settingsResult.data.warning_absences, critical: settingsResult.data.critical_absences });
      setSelectedSessionId((current) => current && ids.includes(current) ? current : nextSessions[0]?.id || null);
    } catch {
      notify("Attendance could not be loaded. Check your connection and try again.");
    } finally {
      if (!silent) setLoading(false);
    }
  }, [canManage, notify, scopeFilter, user.id]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!sessions.some((session) => session.status === "open")) return;
    const timer = window.setInterval(() => load(true), 10000);
    return () => window.clearInterval(timer);
  }, [load, sessions]);
  const termOptions = useMemo(() => [...new Set(sessions.map((session) => termKey(session.starts_at)))].sort().reverse(), [sessions]);
  const visibleSessions = useMemo(() => sessions.filter((session) => termFilter === "all" || termKey(session.starts_at) === termFilter), [sessions, termFilter]);
  const visibleIds = useMemo(() => new Set(visibleSessions.map((session) => session.id)), [visibleSessions]);
  const selectedSession = visibleSessions.find((session) => session.id === selectedSessionId) || null;
  const openSession = visibleSessions.find((session) => session.status === "open");
  const closedSessions = visibleSessions.filter((session) => session.status === "closed" && session.counts_toward_metrics);
  const ownRecords = records.filter((record) => record.member_id === user.id && visibleIds.has(record.session_id));
  const selectedParticipants = participants.filter((participant) => participant.session_id === selectedSessionId);
  const scopeLabel = scopeFilter === "all" ? "All activity" : scopeFilter === "club" ? "Club-wide" : groups.find((group) => group.id === scopeFilter)?.name || "Subgroup";

  const summaries = useMemo(() => {
    const closedIds = new Set(closedSessions.map((session) => session.id));
    const orderedSessions = [...closedSessions].sort((left, right) => new Date(left.starts_at).getTime() - new Date(right.starts_at).getTime());
    const memberIds = new Set(participants.filter((participant) => closedIds.has(participant.session_id)).map((participant) => participant.member_id));
    return [...memberIds].map((memberId) => {
      const memberRecords = records.filter((record) => record.member_id === memberId && closedIds.has(record.session_id));
      const present = memberRecords.filter((record) => record.status === "present").length;
      const absent = memberRecords.filter((record) => record.status === "absent").length;
      const excused = memberRecords.filter((record) => record.status === "excused").length;
      const tardy = memberRecords.filter((record) => record.status === "tardy").length;
      const sessionById = new Map(closedSessions.map((session) => [session.id, session]));
      const unitValue = (record: AttendanceRecord) => Number(record.unexcused_units) || (record.status === "absent" ? 1 : 0);
      const clubUnits = memberRecords.filter((record) => sessionById.get(record.session_id)?.scope === "club").reduce((total, record) => total + unitValue(record), 0);
      const subgroupUnits = memberRecords.filter((record) => sessionById.get(record.session_id)?.scope === "subgroup").reduce((total, record) => total + unitValue(record), 0);
      const unexcusedUnits = clubUnits + subgroupUnits;
      const memberRemediations = remediations.filter((item) => item.member_id === memberId && closedIds.has(item.session_id));
      const openRemediations = memberRemediations.filter((item) => item.status === "pending");
      const counted = present + absent + tardy;
      const profile = profiles.find((item) => item.id === memberId);
      const memberTerm = termFilter === "all" ? termKey(orderedSessions.at(-1)?.starts_at || new Date().toISOString()) : termFilter;
      const memberEligibility = eligibility.find((item) => item.member_id === memberId && item.term_key === memberTerm);
      return {
        memberId,
        name: profile?.full_name || profile?.email || "Member",
        email: profile?.email || "",
        present,
        absent,
        excused,
        tardy,
        clubUnits,
        subgroupUnits,
        unexcusedUnits,
        openRemediations,
        rate: counted ? Math.round(((present + tardy) / counted) * 100) : 100,
        flag: Math.max(clubUnits, subgroupUnits) >= thresholds.critical ? "critical" : Math.max(clubUnits, subgroupUnits) >= thresholds.warning ? "warning" : "none",
        eligibility: memberEligibility?.status || "eligible",
      };
    }).sort((left, right) => right.unexcusedUnits - left.unexcusedUnits || left.name.localeCompare(right.name));
  }, [closedSessions, eligibility, participants, profiles, records, remediations, termFilter, thresholds]);

  const overallRate = (() => {
    const scopedRecords = records.filter((record) => closedSessions.some((session) => session.id === record.session_id));
    const present = scopedRecords.filter((record) => record.status === "present" || record.status === "tardy").length;
    const absent = scopedRecords.filter((record) => record.status === "absent").length;
    return present + absent ? Math.round((present / (present + absent)) * 100) : 100;
  })();
  const flagged = summaries.filter((summary) => summary.flag !== "none");
  const pendingExcuseCount = excuses.filter((item) => item.status === "pending").length;
  const memberTerm = termFilter === "all" ? termKey(visibleSessions[0]?.starts_at || new Date().toISOString()) : termFilter;
  const ownEligibility = eligibility.find((item) => item.member_id === user.id && item.term_key === memberTerm);
  const ownRemediations = remediations.filter((item) => item.member_id === user.id && visibleIds.has(item.session_id));

  async function checkIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return;
    setSaving(true);
    setFeedback("");
    const { error } = await supabase.rpc("check_in_attendance", { p_code: checkInCode.replace(/\s/g, "").toUpperCase() });
    setSaving(false);
    if (error) setFeedback(error.message);
    else { setFeedback("You are checked in. Your attendance is confirmed."); setCheckInCode(""); notify("Attendance confirmed"); load(); }
  }

  async function createSession(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return;
    const form = new FormData(event.currentTarget);
    setSaving(true);
    const audience = String(form.get("audience") || "club");
    const subgroupId = audience.startsWith("subgroup:") ? Number(audience.slice("subgroup:".length)) : null;
    const groupName = groups.find((group) => group.id === subgroupId)?.name;
    const { data, error } = await supabase.rpc("create_attendance_session", {
      p_scope: subgroupId === null ? "club" : "subgroup",
      p_subgroup_id: subgroupId,
      p_title: subgroupId === null ? "General Body Meeting" : `${groupName || "Subgroup"} rehearsal`,
      p_starts_at: new Date(String(form.get("starts_at"))).toISOString(),
    });
    if (error) { setSaving(false); notify(error.message); return; }
    const created = Array.isArray(data) ? data[0] : data;
    if (form.get("open_now") === "on" && created?.id) await openAttendance(created.id, Number(form.get("duration") || 60));
    setSaving(false);
    setShowNewSession(false);
    notify("Meeting created");
    load();
  }

  async function openAttendance(sessionId: number, duration = 60) {
    if (!supabase) return;
    setSaving(true);
    const { data, error } = await supabase.rpc("open_attendance_session", { p_session_id: sessionId, p_duration_minutes: duration });
    setSaving(false);
    if (error) notify(error.message);
    else { const result = Array.isArray(data) ? data[0] : data; setLiveCode(result?.check_in_code || result?.code || ""); notify("Check-in is open"); load(); }
  }

  async function rotateCode(sessionId: number) {
    if (!supabase) return;
    setSaving(true);
    const { data, error } = await supabase.rpc("rotate_attendance_code", { p_session_id: sessionId });
    setSaving(false);
    if (error) notify(error.message);
    else { const result = Array.isArray(data) ? data[0] : data; setLiveCode(result?.check_in_code || result?.code || ""); notify("A new code is active"); load(); }
  }

  async function changeSession(sessionId: number, action: "close" | "cancel") {
    if (!supabase || !window.confirm(action === "close" ? "Close check-in and mark everyone still missing as absent?" : "Cancel this meeting? It will not count toward attendance.")) return;
    setSaving(true);
    const { error } = await supabase.rpc(action === "close" ? "close_attendance_session" : "cancel_attendance_session", { p_session_id: sessionId });
    setSaving(false);
    if (error) notify(error.message);
    else { setLiveCode(""); notify(action === "close" ? "Attendance closed" : "Meeting canceled"); load(); }
  }

  async function setStatus(sessionId: number, memberId: string, status: RecordStatus) {
    if (!supabase || status === "pending") return;
    let minutesLate = 0;
    if (status === "tardy") {
      const value = window.prompt("Minutes late", "10");
      if (value === null) return;
      minutesLate = Number(value);
      if (!Number.isInteger(minutesLate) || minutesLate < 0) { notify("Enter a whole number of minutes"); return; }
    }
    const note = window.prompt("Optional correction note") || "";
    const { error } = await supabase.rpc("set_attendance_status", { p_session_id: sessionId, p_member_id: memberId, p_status: status, p_note: note, p_minutes_late: minutesLate });
    if (error) notify(error.message); else { notify("Attendance updated"); load(true); }
  }

  async function submitExcuse(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const file = form.get("proof") as File;
    if (file?.size && file.size > 8 * 1024 * 1024) { notify("Proof images must be smaller than 8 MB"); return; }
    if (file?.size && !file.type.startsWith("image/")) { notify("Choose an image as proof"); return; }
    setSaving(true);
    const sessionId = Number(form.get("session_id"));
    let proofPath: string | null = null;
    if (file?.size) {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "-");
      proofPath = `${user.id}/${sessionId}/${crypto.randomUUID()}-${safeName}`;
      const upload = await supabase.storage.from("attendance-excuses").upload(proofPath, file, { upsert: false });
      if (upload.error) { setSaving(false); notify(upload.error.message); return; }
    }
    const { error } = await supabase.rpc("submit_attendance_excuse", {
      p_session_id: sessionId,
      p_reason: String(form.get("reason") || ""),
      p_proof_path: proofPath,
      p_reason_category: String(form.get("reason_category") || "other"),
      p_notified_at: form.get("notified") === "on" ? new Date().toISOString() : null,
    });
    if (error) {
      if (proofPath) await supabase.storage.from("attendance-excuses").remove([proofPath]);
      setSaving(false);
      notify(error.message);
      return;
    }
    setSaving(false);
    formElement.reset();
    setShowExcuse(false);
    notify("Absence form submitted");
    load();
  }

  async function reviewExcuse(excuseId: number, decision: "approved" | "denied") {
    if (!supabase) return;
    const note = window.prompt(decision === "approved" ? "Optional approval note" : "Why is this being denied?") || "";
    const { error } = await supabase.rpc("review_attendance_excuse", { p_excuse_id: excuseId, p_decision: decision, p_note: note });
    if (error) notify(error.message); else { notify(`Absence form ${decision}`); load(true); }
  }

  async function openProof(excuse: Excuse) {
    if (!supabase || !excuse.proof_path) return;
    const { data, error } = await supabase.storage.from("attendance-excuses").createSignedUrl(excuse.proof_path, 300);
    if (error || !data) notify("Proof could not be opened"); else window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  }

  async function updateRemediation(item: Remediation, nextStatus: RemediationStatus) {
    if (!supabase) return;
    const assignment = window.prompt("Remediation instruction", item.assignment);
    if (assignment === null) return;
    const { error } = await supabase.rpc("set_attendance_remediation", { p_remediation_id: item.id, p_status: nextStatus, p_assignment: assignment, p_due_at: item.due_at, p_note: null });
    if (error) notify(error.message); else { notify("Remediation updated"); load(true); }
  }

  async function updateEligibility(memberId: string, status: EligibilityStatus) {
    if (!supabase) return;
    const reason = window.prompt(status === "restricted" ? "Reason for restricting performance eligibility" : "Optional eligibility note") || "";
    const { error } = await supabase.rpc("set_attendance_eligibility", { p_term_key: memberTerm, p_member_id: memberId, p_status: status, p_reason: reason });
    if (error) notify(error.message); else { notify("Eligibility updated"); load(true); }
  }

  function changeScope(value: ScopeFilter) {
    setScopeFilter(value);
    setTab("overview");
    setLiveCode("");
    setFeedback("");
  }

  function changeTerm(value: string) {
    setTermFilter(value);
    setTab("overview");
    setLiveCode("");
    setFeedback("");
  }

  if (loading) return <section className="section-shell page-section"><div className="inline-loading">Loading attendance…</div></section>;

  return <section className="section-shell page-section attendance-page">
    <div className="attendance-title-row">
      <div><p className="eyebrow">MEETINGS</p><h1>Attendance</h1><p>Check in to club-wide and subgroup meetings, review attendance, and handle absence forms.</p></div>
      <div className="attendance-title-actions">
        <label className="scope-picker"><span>View</span><select aria-label="Filter attendance by audience" value={typeof scopeFilter === "number" ? `group:${scopeFilter}` : scopeFilter} onChange={(event) => { const next = event.target.value; changeScope(next.startsWith("group:") ? Number(next.slice(6)) : next as "all" | "club"); }}><option value="all">All activity</option><option value="club">Club-wide meetings</option>{groups.map((group) => <option key={group.id} value={`group:${group.id}`}>{group.name} rehearsals</option>)}</select></label>
        <label className="scope-picker"><span>Term</span><select aria-label="Filter attendance by term" value={termFilter} onChange={(event) => changeTerm(event.target.value)}><option value="all">All terms</option>{termOptions.map((term) => <option key={term} value={term}>{termLabel(term)}</option>)}</select></label>
        {canManage && <Button onClick={() => setShowNewSession(true)}>＋ New meeting</Button>}
      </div>
    </div>

    <form className="attendance-checkin" onSubmit={checkIn}><div><p className="eyebrow">MEMBER CHECK-IN</p><h2>Enter the meeting code</h2><p>Use the code shown by an executive while check-in is open.</p></div><div><input value={checkInCode} onChange={(event) => setCheckInCode(event.target.value)} required minLength={6} maxLength={8} inputMode="numeric" autoComplete="one-time-code" placeholder="000000" aria-label="Attendance code" /><Button type="submit" disabled={saving} className="shrink-0 bg-[var(--paper)] text-[var(--ink)] hover:bg-[var(--carolina-pale)]">{saving ? "Checking…" : "Check in"}</Button></div>{feedback && <p className={`attendance-feedback ${feedback.includes("confirmed") ? "success" : "error"}`} role="status">{feedback}</p>}</form>

    {canManage ? <>
      <div className="attendance-summary-grid"><Stat label="Closed meetings" value={closedSessions.length} /><Stat label="Attendance rate" value={`${overallRate}%`} /><Stat label="At policy limit" value={summaries.filter((item) => item.flag === "warning").length} tone="warning" /><Stat label="Needs review" value={summaries.filter((item) => item.flag === "critical").length} tone="critical" /></div>
      {openSession && <div className="attendance-live"><div><p className="eyebrow">LIVE NOW</p><h2>{openSession.title}</h2><p>{records.filter((record) => record.session_id === openSession.id && (record.status === "present" || record.status === "tardy")).length} of {participants.filter((participant) => participant.session_id === openSession.id).length} checked in</p></div><div className="attendance-live-code"><small>CHECK-IN CODE</small><strong>{liveCode || "Hidden after reload"}</strong><span>{liveCode ? "Share this with members" : "Rotate the code to display a new one"}</span></div><div className="attendance-live-actions"><Button variant="secondary" onClick={() => rotateCode(openSession.id)} disabled={saving}>Rotate code</Button><Button onClick={() => changeSession(openSession.id, "close")} disabled={saving}>Close attendance</Button><Button variant="danger" onClick={() => changeSession(openSession.id, "cancel")} disabled={saving}>Cancel meeting</Button></div></div>}
      <div className="attendance-tabs" role="tablist"><button type="button" role="tab" aria-selected={tab === "overview"} className={tab === "overview" ? "active" : ""} onClick={() => setTab("overview")}>Overview</button><button type="button" role="tab" aria-selected={tab === "meetings"} className={tab === "meetings" ? "active" : ""} onClick={() => setTab("meetings")}>Meetings</button><button type="button" role="tab" aria-selected={tab === "excuses"} className={tab === "excuses" ? "active" : ""} onClick={() => setTab("excuses")}>Absence forms {pendingExcuseCount ? `(${pendingExcuseCount})` : ""}</button></div>
      {tab === "overview" && <>
        <div className="attendance-panel"><div className="attendance-panel-heading"><div><p className="eyebrow">POLICY FLAGS</p><h2>Members needing attention</h2></div><span>At {thresholds.warning} · Review over {thresholds.critical - 1} unexcused units</span></div>{flagged.length ? <div className="attendance-flags">{flagged.map((summary) => <article key={summary.memberId} className={summary.flag}><div><b>{summary.name}</b><small>{summary.email}</small></div><span>{summary.rate}% attendance</span><strong>{formatUnits(summary.unexcusedUnits)} unexcused</strong><i>{summary.eligibility.replace("_", " ")}</i><div className="attendance-inline-actions"><Button size="sm" variant="secondary" onClick={() => updateEligibility(summary.memberId, "under_review")}>Review</Button><Button size="sm" variant={summary.eligibility === "restricted" ? "secondary" : "danger"} onClick={() => updateEligibility(summary.memberId, summary.eligibility === "restricted" ? "reinstated" : "restricted")}>{summary.eligibility === "restricted" ? "Reinstate" : "Restrict"}</Button></div></article>)}</div> : <div className="attendance-empty">No members are currently flagged in this view.</div>}</div>
        <div className="attendance-panel attendance-remediation-panel"><div className="attendance-panel-heading"><div><p className="eyebrow">REMEDIATION</p><h2>Open follow-up</h2></div><span>{remediations.filter((item) => item.status === "pending" && visibleIds.has(item.session_id)).length} pending</span></div>{remediations.filter((item) => item.status === "pending" && visibleIds.has(item.session_id)).length ? <div className="remediation-list">{remediations.filter((item) => item.status === "pending" && visibleIds.has(item.session_id)).map((item) => { const member = profiles.find((profile) => profile.id === item.member_id); const session = sessions.find((sessionItem) => sessionItem.id === item.session_id); return <article key={item.id}><div><b>{member?.full_name || member?.email || "Member"}</b><small>{session?.title || "Meeting"} · {item.assignment}</small></div><Button size="sm" onClick={() => updateRemediation(item, "complete")}>Mark complete</Button></article>; })}</div> : <div className="attendance-empty">No open remediation items.</div>}</div>
      </>}
      {tab === "meetings" && (
        <div className="attendance-meetings">
          <aside>
            {visibleSessions.length ? visibleSessions.map((session) => (
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
                  <div>{selectedSession.status === "draft" && <Button onClick={() => openAttendance(selectedSession.id)}>Open check-in</Button>}{selectedSession.status === "open" && <Button onClick={() => changeSession(selectedSession.id, "close")}>Close</Button>}</div>
                </div>
                <div className="attendance-roster">
                  <div className="attendance-roster-head"><span>Member</span><span>Status</span><span>Policy impact</span><span>Action</span></div>
                  {selectedParticipants.map((participant) => {
                    const profile = profiles.find((item) => item.id === participant.member_id);
                    const record = records.find((item) => item.session_id === selectedSession.id && item.member_id === participant.member_id);
                    const memberName = profile?.full_name || profile?.email || "member";
                    return (
                      <div className="attendance-roster-row" key={participant.member_id}>
                        <div><b>{profile?.full_name || profile?.email || "Member"}</b><small>{profile?.email}</small></div>
                        <span className={`attendance-status ${record?.status || "pending"}`}>{record?.status || "pending"}</span>
                        <span>{record?.status === "tardy" ? `${record.minutes_late} min late · ${formatUnits(record.unexcused_units)} unexcused` : record?.status === "absent" ? "1 unexcused" : record?.status === "excused" ? "Remediation required" : "-"}</span>
                        <select value={record?.status || "pending"} onChange={(event) => setStatus(selectedSession.id, participant.member_id, event.target.value as RecordStatus)} aria-label={`Attendance status for ${memberName}`}>
                          <option value="pending" disabled>Pending</option><option value="present">Present</option><option value="tardy">Tardy</option><option value="absent">Absent</option><option value="excused">Excused</option>
                        </select>
                      </div>
                    );
                  })}
                </div>
              </>
            ) : <div className="attendance-empty">Choose a meeting to view its roster.</div>}
          </div>
        </div>
      )}
      {tab === "excuses" && <div className="attendance-panel"><div className="attendance-panel-heading"><div><p className="eyebrow">PRIVATE REVIEW QUEUE</p><h2>Absence forms</h2></div><span>{pendingExcuseCount} awaiting review</span></div><div className="excuse-list">{excuses.length ? excuses.map((excuse) => { const member = profiles.find((item) => item.id === excuse.member_id); const session = sessions.find((item) => item.id === excuse.session_id); return <article key={excuse.id}><div><span className={`attendance-status ${excuse.status}`}>{excuse.status}</span><h3>{member?.full_name || member?.email || "Member"}</h3><small>{session?.title} · {session ? formatDateTime(session.starts_at) : "Meeting"} · {categoryLabels[excuse.reason_category]}</small><p>{excuse.reason}</p><small>{excuse.notified_at ? `Executive notified ${formatDateTime(excuse.notified_at)}` : "No notification time recorded"}</small>{excuse.review_note && <p className="review-note">Executive note: {excuse.review_note}</p>}</div><div>{excuse.proof_path && <Button variant="secondary" onClick={() => openProof(excuse)}>View proof</Button>}{excuse.status === "pending" && <><Button onClick={() => reviewExcuse(excuse.id, "approved")}>Approve</Button><Button variant="danger" onClick={() => reviewExcuse(excuse.id, "denied")}>Deny</Button></>}</div></article>; }) : <div className="attendance-empty">No absence forms have been submitted.</div>}</div></div>}
    </> : <>
      <div className="attendance-summary-grid member"><Stat label="Present" value={ownRecords.filter((record) => record.status === "present").length} /><Stat label="Excused" value={ownRecords.filter((record) => record.status === "excused").length} /><Stat label="Tardy" value={ownRecords.filter((record) => record.status === "tardy").length} /><Stat label="Absent" value={ownRecords.filter((record) => record.status === "absent").length} tone={ownRecords.filter((record) => record.status === "absent").length >= 2 ? "warning" : undefined} /></div>
      {ownEligibility && ownEligibility.status !== "eligible" && <div className={`attendance-eligibility-notice ${ownEligibility.status}`}><b>Performance eligibility: {ownEligibility.status.replace("_", " ")}</b>{ownEligibility.reason && <span>{ownEligibility.reason}</span>}</div>}
      <div className="member-attendance-grid"><div className="attendance-panel"><div className="attendance-panel-heading"><div><p className="eyebrow">MY HISTORY</p><h2>Meeting attendance</h2></div><span>{scopeLabel} · {termFilter === "all" ? "All terms" : termLabel(termFilter)}</span></div><div className="member-history">{visibleSessions.length ? visibleSessions.filter((session) => session.status !== "draft").map((session) => { const record = ownRecords.find((item) => item.session_id === session.id); return <article key={session.id}><div><b>{session.title}</b><small>{formatDateTime(session.starts_at)}</small></div><span className={`attendance-status ${record?.status || session.status}`}>{record?.status || session.status}{record?.status === "tardy" ? ` · ${record.minutes_late}m` : ""}</span></article>; }) : <div className="attendance-empty">No meetings are available for this view.</div>}</div></div><div className="attendance-panel"><div className="attendance-panel-heading"><div><p className="eyebrow">ABSENCE SUPPORT</p><h2>Need an excuse?</h2></div></div><p className="attendance-help">Submit the form for any absence. Executives decide whether it is excused under club policy. Proof is optional.</p><Button onClick={() => setShowExcuse(true)} disabled={!visibleSessions.some((session) => session.status !== "canceled")}>Submit absence form</Button><div className="member-excuses">{excuses.map((excuse) => <article key={excuse.id}><div><b>{sessions.find((session) => session.id === excuse.session_id)?.title || "Meeting"}</b><small>{formatDateTime(excuse.submitted_at)}</small></div><span className={`attendance-status ${excuse.status}`}>{excuse.status}</span></article>)}</div>{ownRemediations.length > 0 && <div className="member-remediation"><h3>Remediation</h3>{ownRemediations.map((item) => <article key={item.id}><span>{item.assignment}</span><b className={item.status}>{item.status}</b></article>)}</div>}</div></div>
    </>}

    {showNewSession && <div className="modal-backdrop"><form className="modal attendance-modal" onSubmit={createSession}><button type="button" className="modal-close" onClick={() => setShowNewSession(false)}>×</button><p className="eyebrow">NEW MEETING</p><h2>New meeting</h2><p className="modal-copy">Create a club-wide meeting or subgroup rehearsal.</p><label>Audience<select name="audience" defaultValue={scopeFilter === "club" || scopeFilter === "all" ? "club" : `subgroup:${scopeFilter}`}><option value="club">Club-wide · General Body Meeting</option>{groups.map((group) => <option key={group.id} value={`subgroup:${group.id}`}>{group.name} · Subgroup rehearsal</option>)}</select></label><label>Meeting date and time<input name="starts_at" type="datetime-local" required defaultValue={localDateTime()} /></label><label>Code duration<select name="duration" defaultValue="60"><option value="15">15 minutes</option><option value="30">30 minutes</option><option value="60">1 hour</option><option value="120">2 hours</option></select></label><label className="check-label"><input name="open_now" type="checkbox" defaultChecked /> Open check-in immediately</label><Button type="submit" disabled={saving}>{saving ? "Creating…" : "Create meeting"}</Button></form></div>}
    {showExcuse && <div className="modal-backdrop"><form className="modal attendance-modal" onSubmit={submitExcuse}><button type="button" className="modal-close" onClick={() => setShowExcuse(false)}>×</button><p className="eyebrow">PRIVATE SUBMISSION</p><h2>Absence form</h2><p className="modal-copy">Submit this for every absence. An executive will decide whether it is excused.</p><label>Meeting<select name="session_id" required defaultValue=""><option value="" disabled>Choose a meeting</option>{visibleSessions.filter((session) => session.status !== "canceled").map((session) => <option value={session.id} key={session.id}>{session.title} · {formatDateTime(session.starts_at)}</option>)}</select></label><label>Reason category<select name="reason_category" defaultValue="other">{Object.entries(categoryLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label>What happened<textarea name="reason" required rows={4} minLength={10} maxLength={3000} placeholder="Share the context executives need to review…" /></label><label className="check-label"><input name="notified" type="checkbox" /> I notified an executive</label><label>Proof image <span className="optional-label">(optional)</span><input name="proof" type="file" accept="image/*" /><small>JPG, PNG, HEIC, or another image up to 8 MB.</small></label><Button type="submit" disabled={saving}>{saving ? "Submitting…" : "Submit form"}</Button></form></div>}
  </section>;
}

function Stat({ label, value, tone }: { label: string; value: string | number; tone?: "warning" | "critical" }) {
  return <div className={tone || ""}><small>{label}</small><strong>{value}</strong></div>;
}

function termKey(value: string) {
  const date = new Date(value);
  return `${date.getFullYear()}-${date.getMonth() < 6 ? "spring" : "fall"}`;
}

function termLabel(value: string) {
  const [year, season] = value.split("-");
  return `${season === "spring" ? "Spring" : "Fall"} ${year}`;
}

function formatUnits(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function sessionAudience(session: AttendanceSession, groups: Workspace[]) {
  return session.scope === "club" ? "Club-wide" : `${groups.find((group) => group.id === session.subgroup_id)?.name || "Subgroup"} rehearsal`;
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

function localDateTime() {
  const date = new Date(Date.now() - new Date().getTimezoneOffset() * 60000);
  return date.toISOString().slice(0, 16);
}
