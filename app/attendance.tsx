"use client";

import type { User } from "@supabase/supabase-js";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { Button } from "../components/ui/button";

type ClubRole = "member" | "executive" | "admin";
type Workspace = { id: number; name: string };
type ScopeFilter = "all" | "club" | number;
type SessionStatus = "draft" | "open" | "closed" | "canceled";
type RecordStatus = "pending" | "present" | "absent" | "excused";
type ExcuseStatus = "pending" | "approved" | "denied";
type AttendanceSession = {
  id: number; scope: "club" | "subgroup"; subgroup_id: number | null; title: string;
  starts_at: string; status: SessionStatus; opened_at: string | null; closes_at: string | null;
  closed_at: string | null; canceled_at: string | null; code_expires_at: string | null; created_at: string;
  counts_toward_metrics: boolean;
};
type AttendanceRecord = {
  session_id: number; member_id: string; status: RecordStatus; source: string;
  note: string | null; marked_at: string | null;
};
type Participant = { session_id: number; member_id: string; snapshotted_at: string };
type Profile = { id: string; full_name: string; email: string };
type Excuse = {
  id: number; session_id: number; member_id: string; reason: string; proof_path: string;
  status: ExcuseStatus; submitted_at: string; reviewed_at: string | null; review_note: string | null;
};

export function AttendancePage({ user, role, groups, initialScope = "all", notify }: {
  user: User; role: ClubRole; groups: Workspace[]; initialScope?: ScopeFilter;
  notify: (message: string) => void;
}) {
  const canManage = role !== "member";
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>(initialScope);
  const scopeLabel = scopeFilter === "all" ? "All activity" : scopeFilter === "club" ? "Club-wide" : groups.find((group) => group.id === scopeFilter)?.name || "Subgroup";
  const [sessions, setSessions] = useState<AttendanceSession[]>([]);
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [excuses, setExcuses] = useState<Excuse[]>([]);
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
      const { data: sessionData, error: sessionError } = await supabase.from("attendance_sessions").select("id,scope,subgroup_id,title,starts_at,status,opened_at,closes_at,closed_at,canceled_at,code_expires_at,created_at,counts_toward_metrics").order("starts_at", { ascending: false });
      const allSessions = (sessionData || []) as AttendanceSession[];
      const nextSessions = allSessions.filter((session) => scopeFilter === "all" || (scopeFilter === "club" ? session.scope === "club" : session.subgroup_id === scopeFilter));
      const ids = nextSessions.map((session) => session.id);
      const [recordResult, participantResult, excuseResult, profileResult, settingsResult] = await Promise.all([
        ids.length ? supabase.from("attendance_records").select("session_id,member_id,status,source,note,marked_at").in("session_id", ids) : Promise.resolve({ data: [], error: null }),
        ids.length ? supabase.from("attendance_session_participants").select("session_id,member_id,snapshotted_at").in("session_id", ids) : Promise.resolve({ data: [], error: null }),
        ids.length ? supabase.from("attendance_excuses").select("id,session_id,member_id,reason,proof_path,status,submitted_at,reviewed_at,review_note").in("session_id", ids).order("submitted_at", { ascending: false }) : Promise.resolve({ data: [], error: null }),
        canManage ? supabase.from("profiles").select("id,full_name,email").order("full_name") : supabase.from("profiles").select("id,full_name,email").eq("id", user.id),
        supabase.from("attendance_settings").select("warning_absences,critical_absences").eq("id", true).maybeSingle(),
      ]);
      if (sessionError || recordResult.error || participantResult.error || excuseResult.error || profileResult.error || settingsResult.error) notify("Some attendance information could not be loaded");
      setSessions(nextSessions);
      setRecords((recordResult.data || []) as AttendanceRecord[]);
      setParticipants((participantResult.data || []) as Participant[]);
      setExcuses((excuseResult.data || []) as Excuse[]);
      setProfiles((profileResult.data || []) as Profile[]);
      if (settingsResult.data) setThresholds({ warning: settingsResult.data.warning_absences, critical: settingsResult.data.critical_absences });
      setSelectedSessionId((current) => current && ids.includes(current) ? current : nextSessions[0]?.id || null);
    } catch {
      notify("Attendance could not be loaded. Check your connection and try again.");
    } finally {
      if (!silent) setLoading(false);
    }
  }, [canManage, notify, scopeFilter, user.id]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!sessions.some((session) => session.status === "open")) return;
    const timer = window.setInterval(() => load(true), 10000);
    return () => window.clearInterval(timer);
  }, [load, sessions]);
  useEffect(() => { setTab("overview"); setLiveCode(""); setFeedback(""); }, [scopeFilter]);

  const openSession = sessions.find((session) => session.status === "open");
  const selectedSession = sessions.find((session) => session.id === selectedSessionId) || null;
  const closedSessions = sessions.filter((session) => session.status === "closed" && session.counts_toward_metrics);
  const ownRecords = records.filter((record) => record.member_id === user.id);
  const ownPresent = ownRecords.filter((record) => record.status === "present").length;
  const ownAbsent = ownRecords.filter((record) => record.status === "absent").length;
  const ownExcused = ownRecords.filter((record) => record.status === "excused").length;

  const summaries = useMemo(() => {
    const closedIds = new Set(closedSessions.map((session) => session.id));
    const memberIds = new Set(participants.filter((participant) => closedIds.has(participant.session_id)).map((participant) => participant.member_id));
    return [...memberIds].map((memberId) => {
      const memberRecords = records.filter((record) => record.member_id === memberId && closedIds.has(record.session_id));
      const present = memberRecords.filter((record) => record.status === "present").length;
      const absent = memberRecords.filter((record) => record.status === "absent").length;
      const excused = memberRecords.filter((record) => record.status === "excused").length;
      const counted = present + absent;
      const profile = profiles.find((item) => item.id === memberId);
      return { memberId, name: profile?.full_name || profile?.email || "Member", email: profile?.email || "", present, absent, excused, rate: counted ? Math.round((present / counted) * 100) : 100, flag: absent >= thresholds.critical ? "critical" : absent >= thresholds.warning ? "warning" : "none" };
    }).sort((left, right) => right.absent - left.absent || left.name.localeCompare(right.name));
  }, [closedSessions, participants, profiles, records, thresholds]);

  const overallRate = (() => { const present = records.filter((record) => record.status === "present" && closedSessions.some((session) => session.id === record.session_id)).length; const absent = records.filter((record) => record.status === "absent" && closedSessions.some((session) => session.id === record.session_id)).length; return present + absent ? Math.round((present / (present + absent)) * 100) : 100; })();
  const flagged = summaries.filter((summary) => summary.flag !== "none");
  const selectedParticipants = participants.filter((participant) => participant.session_id === selectedSessionId);
  const sessionAudience = (session: AttendanceSession) => session.scope === "club" ? "Club-wide" : groups.find((group) => group.id === session.subgroup_id)?.name || "Subgroup";

  async function checkIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!supabase) return;
    setSaving(true); setFeedback("");
    const { error } = await supabase.rpc("check_in_attendance", { p_code: checkInCode.replace(/\s/g, "").toUpperCase() });
    setSaving(false);
    if (error) setFeedback(error.message); else { setFeedback("You are checked in. Your attendance is confirmed."); setCheckInCode(""); notify("Attendance confirmed"); load(); }
  }

  async function createSession(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!supabase) return;
    const form = new FormData(event.currentTarget); setSaving(true);
    const audience = String(form.get("audience") || "club");
    const subgroupId = audience.startsWith("subgroup:") ? Number(audience.slice("subgroup:".length)) : null;
    const { data, error } = await supabase.rpc("create_attendance_session", {
      p_scope: subgroupId === null ? "club" : "subgroup", p_subgroup_id: subgroupId, p_title: String(form.get("title") || "Meeting"),
      p_starts_at: new Date(String(form.get("starts_at"))).toISOString(),
    });
    if (error) { setSaving(false); notify(error.message); return; }
    const created = Array.isArray(data) ? data[0] : data;
    if (form.get("open_now") === "on" && created?.id) await openAttendance(created.id, Number(form.get("duration") || 60));
    setSaving(false); setShowNewSession(false); notify("Attendance session created"); load();
  }

  async function openAttendance(sessionId: number, duration = 60) {
    if (!supabase) return;
    setSaving(true);
    const { data, error } = await supabase.rpc("open_attendance_session", { p_session_id: sessionId, p_duration_minutes: duration });
    setSaving(false);
    if (error) notify(error.message); else { const result = Array.isArray(data) ? data[0] : data; setLiveCode(result?.check_in_code || result?.code || ""); notify("Check-in is open"); load(); }
  }

  async function rotateCode(sessionId: number) {
    if (!supabase) return;
    setSaving(true);
    const { data, error } = await supabase.rpc("rotate_attendance_code", { p_session_id: sessionId });
    setSaving(false);
    if (error) notify(error.message); else { const result = Array.isArray(data) ? data[0] : data; setLiveCode(result?.check_in_code || result?.code || ""); notify("A new code is active"); load(); }
  }

  async function changeSession(sessionId: number, action: "close" | "cancel") {
    if (!supabase || !window.confirm(action === "close" ? "Close check-in and mark everyone still missing as absent?" : "Cancel this meeting? It will not count toward attendance.")) return;
    setSaving(true);
    const { error } = await supabase.rpc(action === "close" ? "close_attendance_session" : "cancel_attendance_session", { p_session_id: sessionId });
    setSaving(false);
    if (error) notify(error.message); else { setLiveCode(""); notify(action === "close" ? "Attendance closed" : "Meeting canceled"); load(); }
  }

  async function setStatus(sessionId: number, memberId: string, status: RecordStatus) {
    if (!supabase) return;
    const note = window.prompt("Optional correction note") || "";
    const { error } = await supabase.rpc("set_attendance_status", { p_session_id: sessionId, p_member_id: memberId, p_status: status, p_note: note });
    if (error) notify(error.message); else { notify("Attendance updated"); load(); }
  }

  async function submitExcuse(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!supabase) return;
    const formElement = event.currentTarget; const form = new FormData(formElement); const file = form.get("proof") as File;
    if (!file?.size || !file.type.startsWith("image/")) { notify("Choose an image as proof"); return; }
    if (file.size > 8 * 1024 * 1024) { notify("Proof images must be smaller than 8 MB"); return; }
    setSaving(true);
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "-");
    const sessionId = Number(form.get("session_id"));
    const proofPath = `${user.id}/${sessionId}/${crypto.randomUUID()}-${safeName}`;
    const upload = await supabase.storage.from("attendance-excuses").upload(proofPath, file, { upsert: false });
    if (upload.error) { setSaving(false); notify(upload.error.message); return; }
    const { error } = await supabase.rpc("submit_attendance_excuse", { p_session_id: sessionId, p_reason: String(form.get("reason") || ""), p_proof_path: proofPath });
    if (error) { await supabase.storage.from("attendance-excuses").remove([proofPath]); setSaving(false); notify(error.message); return; }
    setSaving(false); formElement.reset(); setShowExcuse(false); notify("Absence excuse submitted"); load();
  }

  async function reviewExcuse(excuseId: number, decision: "approved" | "denied") {
    if (!supabase) return;
    const note = window.prompt(decision === "approved" ? "Optional approval note" : "Why is this being denied?") || "";
    const { error } = await supabase.rpc("review_attendance_excuse", { p_excuse_id: excuseId, p_decision: decision, p_note: note });
    if (error) notify(error.message); else { notify(`Excuse ${decision}`); load(); }
  }

  async function openProof(excuse: Excuse) {
    if (!supabase) return;
    const { data, error } = await supabase.storage.from("attendance-excuses").createSignedUrl(excuse.proof_path, 300);
    if (error || !data) notify("Proof could not be opened"); else window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  }

  if (loading) return <section className="section-shell page-section"><div className="inline-loading">Loading attendance…</div></section>;

  return <section className="section-shell page-section attendance-page">
    <div className="attendance-title-row"><div><p className="eyebrow">ATTENDANCE</p><h1>Attendance</h1><p>Live meeting check-in, attendance history, and absence support across the club and your groups.</p></div><div className="attendance-title-actions"><label className="scope-picker"><span>View</span><select aria-label="Filter attendance by audience" value={typeof scopeFilter === "number" ? `group:${scopeFilter}` : scopeFilter} onChange={(event) => { const next = event.target.value; setScopeFilter(next.startsWith("group:") ? Number(next.slice(6)) : next as "all" | "club"); }}><option value="all">All activity</option><option value="club">Club-wide</option>{groups.map((group) => <option key={group.id} value={`group:${group.id}`}>{group.name}</option>)}</select></label>{canManage && <Button onClick={() => setShowNewSession(true)}>＋ New session</Button>}</div></div>

    <form className="attendance-checkin" onSubmit={checkIn}><div><p className="eyebrow">MEMBER CHECK-IN</p><h2>Enter the meeting code</h2><p>Use the code shown by an executive while check-in is open.</p></div><div><input value={checkInCode} onChange={(event) => setCheckInCode(event.target.value)} required minLength={6} maxLength={8} inputMode="numeric" autoComplete="one-time-code" placeholder="000000" aria-label="Attendance code" /><Button type="submit" disabled={saving} className="shrink-0 bg-[var(--paper)] text-[var(--ink)] hover:bg-[var(--carolina-pale)]">{saving ? "Checking…" : "Check in"}</Button></div>{feedback && <p className={`attendance-feedback ${feedback.includes("confirmed") ? "success" : "error"}`} role="status">{feedback}</p>}</form>

    {canManage ? <>
      <div className="attendance-summary-grid"><Stat label="Closed meetings" value={closedSessions.length} /><Stat label="Attendance rate" value={`${overallRate}%`} /><Stat label="Warnings" value={summaries.filter((item) => item.flag === "warning").length} tone="warning" /><Stat label="Needs attention" value={summaries.filter((item) => item.flag === "critical").length} tone="critical" /></div>
      {openSession && <div className="attendance-live"><div><p className="eyebrow">LIVE NOW</p><h2>{openSession.title}</h2><p>{records.filter((record) => record.session_id === openSession.id && record.status === "present").length} of {participants.filter((participant) => participant.session_id === openSession.id).length} checked in</p></div><div className="attendance-live-code"><small>CHECK-IN CODE</small><strong>{liveCode || "Hidden after reload"}</strong><span>{liveCode ? "Share this with members" : "Rotate the code to display a new one"}</span></div><div className="attendance-live-actions"><Button variant="secondary" onClick={() => rotateCode(openSession.id)} disabled={saving}>Rotate code</Button><Button onClick={() => changeSession(openSession.id, "close")} disabled={saving}>Close attendance</Button><Button variant="danger" onClick={() => changeSession(openSession.id, "cancel")} disabled={saving}>Cancel meeting</Button></div></div>}
      <div className="attendance-tabs" role="tablist"><button role="tab" aria-selected={tab === "overview"} className={tab === "overview" ? "active" : ""} onClick={() => setTab("overview")}>Overview</button><button role="tab" aria-selected={tab === "meetings"} className={tab === "meetings" ? "active" : ""} onClick={() => setTab("meetings")}>Meetings</button><button role="tab" aria-selected={tab === "excuses"} className={tab === "excuses" ? "active" : ""} onClick={() => setTab("excuses")}>Excuses {excuses.filter((item) => item.status === "pending").length ? `(${excuses.filter((item) => item.status === "pending").length})` : ""}</button></div>
      {tab === "overview" && <div className="attendance-panel"><div className="attendance-panel-heading"><div><p className="eyebrow">ABSENCE FLAGS</p><h2>Members needing attention</h2></div><span>Warning at {thresholds.warning} · Critical at {thresholds.critical}</span></div>{flagged.length ? <div className="attendance-flags">{flagged.map((summary) => <article key={summary.memberId} className={summary.flag}><div><b>{summary.name}</b><small>{summary.email}</small></div><span>{summary.rate}% attendance</span><strong>{summary.absent} absences</strong><i>{summary.flag === "critical" ? "Needs attention" : "Warning"}</i></article>)}</div> : <div className="attendance-empty">No members are currently flagged in this view.</div>}</div>}
      {tab === "meetings" && <div className="attendance-meetings"><aside>{sessions.length ? sessions.map((session) => <button className={selectedSessionId === session.id ? "active" : ""} key={session.id} onClick={() => setSelectedSessionId(session.id)}><span className={`attendance-status ${session.status}`}>{session.status}</span><b>{session.title}</b><small>{sessionAudience(session)} · {formatDateTime(session.starts_at)}</small></button>) : <div className="attendance-empty">No meetings yet.</div>}</aside><div className="attendance-panel">{selectedSession ? <><div className="attendance-panel-heading"><div><p className="eyebrow">{selectedSession.status.toUpperCase()}</p><h2>{selectedSession.title}</h2><span>{sessionAudience(selectedSession)} · {formatDateTime(selectedSession.starts_at)}</span></div><div>{selectedSession.status === "draft" && <Button onClick={() => openAttendance(selectedSession.id)}>Open check-in</Button>}{selectedSession.status === "open" && <Button onClick={() => changeSession(selectedSession.id, "close")}>Close</Button>}</div></div><div className="attendance-roster"><div className="attendance-roster-head"><span>Member</span><span>Status</span><span>Action</span></div>{selectedParticipants.map((participant) => { const profile = profiles.find((item) => item.id === participant.member_id); const record = records.find((item) => item.session_id === selectedSession.id && item.member_id === participant.member_id); return <div className="attendance-roster-row" key={participant.member_id}><div><b>{profile?.full_name || profile?.email || "Member"}</b><small>{profile?.email}</small></div><span className={`attendance-status ${record?.status || "pending"}`}>{record?.status || "pending"}</span><select value={record?.status || "pending"} onChange={(event) => setStatus(selectedSession.id, participant.member_id, event.target.value as RecordStatus)} aria-label={`Attendance status for ${profile?.full_name || profile?.email || "member"}`}><option value="pending" disabled>Pending</option><option value="present">Present</option><option value="absent">Absent</option><option value="excused">Excused</option></select></div>; })}</div></> : <div className="attendance-empty">Choose a meeting to view its roster.</div>}</div></div>}
      {tab === "excuses" && <div className="attendance-panel"><div className="attendance-panel-heading"><div><p className="eyebrow">PRIVATE REVIEW QUEUE</p><h2>Absence excuses</h2></div><span>{excuses.filter((item) => item.status === "pending").length} awaiting review</span></div><div className="excuse-list">{excuses.length ? excuses.map((excuse) => { const member = profiles.find((item) => item.id === excuse.member_id); const session = sessions.find((item) => item.id === excuse.session_id); return <article key={excuse.id}><div><span className={`attendance-status ${excuse.status}`}>{excuse.status}</span><h3>{member?.full_name || member?.email || "Member"}</h3><small>{session?.title} · {session ? formatDateTime(session.starts_at) : "Meeting"}</small><p>{excuse.reason}</p>{excuse.review_note && <p className="review-note">Executive note: {excuse.review_note}</p>}</div><div><Button variant="secondary" onClick={() => openProof(excuse)}>View proof</Button>{excuse.status === "pending" && <><Button onClick={() => reviewExcuse(excuse.id, "approved")}>Approve</Button><Button variant="danger" onClick={() => reviewExcuse(excuse.id, "denied")}>Deny</Button></>}</div></article>; }) : <div className="attendance-empty">No absence excuses have been submitted.</div>}</div></div>}
    </> : <>
      <div className="attendance-summary-grid member"><Stat label="Present" value={ownPresent} /><Stat label="Excused" value={ownExcused} /><Stat label="Absent" value={ownAbsent} tone={ownAbsent >= 2 ? "warning" : undefined} /></div>
      <div className="member-attendance-grid"><div className="attendance-panel"><div className="attendance-panel-heading"><div><p className="eyebrow">MY HISTORY</p><h2>Meeting attendance</h2></div><span>{scopeLabel}</span></div><div className="member-history">{sessions.length ? sessions.filter((session) => session.status !== "draft").map((session) => { const record = ownRecords.find((item) => item.session_id === session.id); return <article key={session.id}><div><b>{session.title}</b><small>{formatDateTime(session.starts_at)}</small></div><span className={`attendance-status ${record?.status || session.status}`}>{record?.status || session.status}</span></article>; }) : <div className="attendance-empty">No meetings are available for this audience.</div>}</div></div><div className="attendance-panel"><div className="attendance-panel-heading"><div><p className="eyebrow">ABSENCE SUPPORT</p><h2>Need an excuse?</h2></div></div><p className="attendance-help">Send executives the meeting, your reason, and a private proof image. Only you and executives can view it.</p><Button onClick={() => setShowExcuse(true)} disabled={!sessions.some((session) => session.status !== "canceled" && session.status !== "draft")}>Submit absence excuse</Button><div className="member-excuses">{excuses.map((excuse) => <article key={excuse.id}><div><b>{sessions.find((session) => session.id === excuse.session_id)?.title || "Meeting"}</b><small>{formatDateTime(excuse.submitted_at)}</small></div><span className={`attendance-status ${excuse.status}`}>{excuse.status}</span></article>)}</div></div></div>
    </>}

    {showNewSession && <div className="modal-backdrop" onMouseDown={() => setShowNewSession(false)}><form className="modal attendance-modal" onSubmit={createSession} onMouseDown={(event) => event.stopPropagation()}><button type="button" className="modal-close" onClick={() => setShowNewSession(false)}>×</button><p className="eyebrow">NEW MEETING</p><h2>New attendance session</h2><p className="modal-copy">Choose who should be able to check in for this meeting.</p><label>Audience<select name="audience" defaultValue={scopeFilter === "club" || scopeFilter === "all" ? "club" : `subgroup:${scopeFilter}`}><option value="club">Club-wide · Bharat Sangeet</option>{groups.map((group) => <option key={group.id} value={`subgroup:${group.id}`}>{group.name}</option>)}</select></label><label>Meeting name<input name="title" required placeholder="Weekly rehearsal" /></label><label>Meeting date and time<input name="starts_at" type="datetime-local" required defaultValue={localDateTime()} /></label><label>Code duration<select name="duration" defaultValue="60"><option value="15">15 minutes</option><option value="30">30 minutes</option><option value="60">1 hour</option><option value="120">2 hours</option></select></label><label className="check-label"><input name="open_now" type="checkbox" defaultChecked /> Open check-in immediately</label><Button type="submit" disabled={saving}>{saving ? "Creating…" : "Create session"}</Button></form></div>}
    {showExcuse && <div className="modal-backdrop" onMouseDown={() => setShowExcuse(false)}><form className="modal attendance-modal" onSubmit={submitExcuse} onMouseDown={(event) => event.stopPropagation()}><button type="button" className="modal-close" onClick={() => setShowExcuse(false)}>×</button><p className="eyebrow">PRIVATE SUBMISSION</p><h2>Submit an absence excuse</h2><p className="modal-copy">Your reason and proof are visible only to you and club executives.</p><label>Meeting<select name="session_id" required defaultValue=""><option value="" disabled>Choose a meeting</option>{sessions.filter((session) => session.status !== "canceled" && session.status !== "draft").map((session) => <option value={session.id} key={session.id}>{session.title} — {formatDateTime(session.starts_at)}</option>)}</select></label><label>Reason<textarea name="reason" required rows={5} minLength={10} placeholder="Explain why you could not attend…" /></label><label>Picture for proof<input name="proof" type="file" required accept="image/*" /><small>JPG, PNG, HEIC, or another image up to 8 MB.</small></label><Button type="submit" disabled={saving}>{saving ? "Submitting…" : "Submit excuse"}</Button></form></div>}
  </section>;
}

function Stat({ label, value, tone }: { label: string; value: string | number; tone?: "warning" | "critical" }) {
  return <div className={tone || ""}><small>{label}</small><strong>{value}</strong></div>;
}
function formatDateTime(value: string) { return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value)); }
function localDateTime() { const date = new Date(Date.now() - new Date().getTimezoneOffset() * 60000); return date.toISOString().slice(0, 16); }
