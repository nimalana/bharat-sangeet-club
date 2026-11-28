"use client";

import { Button } from "../../../components/ui/button";
import type { ActionDialog } from "../action-dialog";
import { categoryLabels, formatDateTime } from "../display";
import { queueNote, type AttendanceOverview, type AttendanceSession, type Excuse } from "../model";
import { QueueNote } from "./queue-note";

// Absence forms tab (executives): the private review queue, with the proof image and the approve and deny buttons.
export function ExcusesTab({ view, sessions, viewLabel, saving, profileName, onDialog, onOpenProof, showMore, loadingMore }: {
  view: AttendanceOverview;
  sessions: AttendanceSession[];
  /** Says which audience and term the queue lists, e.g. "Club-wide · Fall 2026". */
  viewLabel: string;
  saving: boolean;
  profileName: (memberId: string) => string;
  onDialog: (dialog: ActionDialog) => void;
  onOpenProof: (excuse: Excuse) => void;
  showMore: (() => void) | null;
  loadingMore: boolean;
}) {
  const excuseNote = queueNote(view.excuses.length, view.excuses_total, "absence forms", view.list_limit);
  return <div className="attendance-panel"><div className="attendance-panel-heading"><div><p className="eyebrow">PRIVATE REVIEW QUEUE</p><h2>Absence forms</h2></div><span>{view.excuses_pending} awaiting review · {viewLabel}</span></div><div className="excuse-list">{view.excuses.length ? view.excuses.map((excuse) => { const session = sessions.find((item) => item.id === excuse.session_id); return <article key={excuse.id}><div><span className={`attendance-status ${excuse.status}`}>{excuse.status}</span><h3>{profileName(excuse.member_id)}</h3><small>{session?.title} · {session ? formatDateTime(session.starts_at) : "Meeting"} · {categoryLabels[excuse.reason_category]}</small><p>{excuse.reason}</p><small>{excuse.notified_at ? `Executive notified ${formatDateTime(excuse.notified_at)}` : "No notification time recorded"}</small>{excuse.review_note && <p className="review-note">Executive note: {excuse.review_note}</p>}</div><div>{excuse.proof_path && <Button variant="secondary" onClick={() => onOpenProof(excuse)}>View proof</Button>}{excuse.status === "pending" && <><Button disabled={saving} onClick={() => onDialog({ kind: "review", excuse, memberName: profileName(excuse.member_id), decision: "approved" })}>Approve</Button><Button variant="danger" disabled={saving} onClick={() => onDialog({ kind: "review", excuse, memberName: profileName(excuse.member_id), decision: "denied" })}>Deny</Button></>}</div></article>; }) : <div className="attendance-empty">No absence forms have been submitted.</div>}</div><QueueNote note={excuseNote} onShowMore={showMore} busy={loadingMore} /></div>;
}
