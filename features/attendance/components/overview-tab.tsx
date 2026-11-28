"use client";

import { Button } from "../../../components/ui/button";
import type { ActionDialog } from "../action-dialog";
import { formatUnits } from "../display";
import { queueNote, type AttendanceOverview, type AttendanceSession, type MemberSummary } from "../model";
import type { Notify } from "../../../lib/toast";
import { ThresholdSettings } from "./attendance-corrections";
import { QueueNote } from "./queue-note";

// Overview tab (executives): the members at or past the policy limit, and the open follow-up items.
export function OverviewTab({ view, sessions, flagged, warningLevel, criticalLevel, viewLabel, saving, notify, profileName, onDialog, onThresholdsChanged, showMore, loadingMore }: {
  view: AttendanceOverview;
  sessions: AttendanceSession[];
  flagged: MemberSummary[];
  warningLevel: number;
  criticalLevel: number;
  /** Says which audience and term the panels list, e.g. "Club-wide · Fall 2026". */
  viewLabel: string;
  saving: boolean;
  notify: Notify;
  profileName: (memberId: string) => string;
  onDialog: (dialog: ActionDialog) => void;
  onThresholdsChanged: () => void;
  showMore: (() => void) | null;
  loadingMore: boolean;
}) {
  const pendingRemediations = view.remediations.filter((item) => item.status === "pending");
  const remediationNote = queueNote(pendingRemediations.length, view.remediations_pending, "open items", view.list_limit);
  return <>
    <div className="attendance-panel"><div className="attendance-panel-heading"><div><p className="eyebrow">POLICY FLAGS</p><h2>Members needing attention</h2></div><span>At {warningLevel} · Review over {criticalLevel - 1} unexcused units <ThresholdSettings warning={warningLevel} critical={criticalLevel} notify={notify} onChanged={onThresholdsChanged} /></span></div>{flagged.length ? <div className="attendance-flags">{flagged.map((summary) => <article key={summary.memberId} className={summary.flag}><div><b>{summary.name}</b><small>{summary.email}</small></div><span>{summary.rate}% attendance</span><strong>{formatUnits(summary.unexcusedUnits)} unexcused</strong><i>{summary.eligibility.replace("_", " ")}</i><div className="attendance-inline-actions"><Button size="sm" variant="secondary" disabled={saving} onClick={() => onDialog({ kind: "eligibility", memberId: summary.memberId, memberName: summary.name, status: "under_review" })}>Review</Button><Button size="sm" variant={summary.eligibility === "restricted" ? "secondary" : "danger"} disabled={saving} onClick={() => onDialog({ kind: "eligibility", memberId: summary.memberId, memberName: summary.name, status: summary.eligibility === "restricted" ? "reinstated" : "restricted" })}>{summary.eligibility === "restricted" ? "Reinstate" : "Restrict"}</Button></div></article>)}</div> : <div className="attendance-empty">No members are currently flagged in this view.</div>}</div>
    <div className="attendance-panel attendance-remediation-panel"><div className="attendance-panel-heading"><div><p className="eyebrow">REMEDIATION</p><h2>Open follow-up</h2></div><span>{view.remediations_pending} pending · {viewLabel}</span></div>{pendingRemediations.length ? <div className="remediation-list">{pendingRemediations.map((item) => { const session = sessions.find((sessionItem) => sessionItem.id === item.session_id); return <article key={item.id}><div><b>{profileName(item.member_id)}</b><small>{session?.title || "Meeting"} · {item.assignment}</small></div><Button size="sm" disabled={saving} onClick={() => onDialog({ kind: "remediation", item, memberName: profileName(item.member_id) })}>Mark complete</Button></article>; })}</div> : <div className="attendance-empty">No open remediation items.</div>}<QueueNote note={remediationNote} onShowMore={showMore} busy={loadingMore} /></div>
  </>;
}
