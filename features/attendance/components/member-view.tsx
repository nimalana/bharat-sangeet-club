"use client";

import type { User } from "@supabase/supabase-js";
import { Button } from "../../../components/ui/button";
import type { Notify } from "../../../lib/toast";
import { formatDateTime } from "../display";
import { termLabel, type AttendanceOverview, type AttendanceSession } from "../model";
import { WithdrawExcuseButton } from "./attendance-corrections";
import { Stat } from "./stat";

// What a member sees: their own marks, their eligibility to perform, their history, the absence form and its follow-up.
export function MemberView({ view, sessions, user, scopeLabel, termFilter, notify, onSubmitExcuse, onWithdrawn }: {
  view: AttendanceOverview;
  sessions: AttendanceSession[];
  user: User;
  scopeLabel: string;
  termFilter: string;
  notify: Notify;
  onSubmitExcuse: () => void;
  /** A form was withdrawn: read the overview again. */
  onWithdrawn: () => void;
}) {
  const ownRecords = view.records;
  const ownEligibility = view.eligibility[0];
  const ownRemediations = view.remediations;
  return <>
    <div className="attendance-summary-grid member"><Stat label="Present" value={ownRecords.filter((record) => record.status === "present").length} /><Stat label="Excused" value={ownRecords.filter((record) => record.status === "excused").length} /><Stat label="Tardy" value={ownRecords.filter((record) => record.status === "tardy").length} /><Stat label="Absent" value={ownRecords.filter((record) => record.status === "absent").length} tone={ownRecords.filter((record) => record.status === "absent").length >= 2 ? "warning" : undefined} /></div>
    {ownEligibility && ownEligibility.status !== "eligible" && <div className={`attendance-eligibility-notice ${ownEligibility.status}`}><b>Performance eligibility: {ownEligibility.status.replace("_", " ")}</b>{ownEligibility.reason && <span>{ownEligibility.reason}</span>}</div>}
    <div className="member-attendance-grid"><div className="attendance-panel"><div className="attendance-panel-heading"><div><p className="eyebrow">MY HISTORY</p><h2>Meeting attendance</h2></div><span>{scopeLabel} · {termFilter === "all" ? "All terms" : termLabel(termFilter)}</span></div><div className="member-history">{sessions.length ? sessions.filter((session) => session.status !== "draft").map((session) => { const record = ownRecords.find((item) => item.session_id === session.id); return <article key={session.id}><div><b>{session.title}</b><small>{formatDateTime(session.starts_at)}</small></div><span className={`attendance-status ${record?.status || session.status}`}>{record?.status || session.status}{record?.status === "tardy" ? ` · ${record.minutes_late}m` : ""}</span></article>; }) : <div className="attendance-empty">No meetings are available for this view.</div>}</div></div><div className="attendance-panel"><div className="attendance-panel-heading"><div><p className="eyebrow">ABSENCE SUPPORT</p><h2>Need an excuse?</h2></div></div><p className="attendance-help">Submit the form for any absence. Executives decide whether it is excused under club policy. Proof is optional.</p><Button onClick={() => onSubmitExcuse()} disabled={!sessions.some((session) => session.status !== "canceled")}>Submit absence form</Button><div className="member-excuses">{view.excuses.map((excuse) => <article key={excuse.id}><div><b>{sessions.find((session) => session.id === excuse.session_id)?.title || "Meeting"}</b><small>{formatDateTime(excuse.submitted_at)}</small></div><span className={`attendance-status ${excuse.status}`}>{excuse.status}</span>{excuse.status === "pending" && excuse.member_id === user.id && <WithdrawExcuseButton excuseId={excuse.id} notify={notify} onChanged={onWithdrawn} />}</article>)}</div>{ownRemediations.length > 0 && <div className="member-remediation"><h3>Remediation</h3>{ownRemediations.map((item) => <article key={item.id}><span>{item.assignment}</span><b className={item.status}>{item.status}</b></article>)}</div>}</div></div>
  </>;
}
