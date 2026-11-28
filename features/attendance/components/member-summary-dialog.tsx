"use client";

import { useMemo, useState } from "react";
import { Button } from "../../../components/ui/button";
import { Dialog } from "../../../components/ui/dialog";
import { ErrorBlock } from "../../../components/ui/error-block";
import { IconButton } from "../../../components/ui/icon-button";
import { SkeletonRows } from "../../../components/ui/skeleton";
import { getMemberAttendance } from "../../../lib/api/attendance";
import { useQuery } from "../../../lib/hooks/use-query";
import { historyRows, summarizeMarks, termLabel, type AttendanceSession } from "../model";
import { MarkHistory } from "./mark-history";
import { Stat } from "./stat";

/** Who the summary is about, as the roster or the flagged list knows them. */
export type SummaryMember = { id: string; name: string; email: string };

// One member's attendance for the meetings in view, for an executive: how many present, tardy, excused and absent, the rate, their
// eligibility for the term, and every meeting with its mark. The overview sends an executive no marks (only totals for the flagged),
// so the marks are read here, for this one member, when the dialog opens (lib/api/attendance.ts getMemberAttendance).
//
// Each opening reads afresh and shows rows while it does (the key carries a nonce): a summary of someone's marks that is a minute old
// must not be shown as the truth after a mark was changed in between. A read that fails shows the error with Try again, not an empty list.
export function MemberSummaryDialog({ userId, member, sessions, summaryTerm, periodLabel, onClose }: {
  userId: string;
  member: SummaryMember;
  /** The meetings of the view (audience and term) the executive is looking at. */
  sessions: AttendanceSession[];
  /** The term eligibility is read for (the overview's summary_term); empty: none to ask about. */
  summaryTerm: string;
  /** "Club-wide · Fall 2026": which view these are the meetings of. */
  periodLabel: string;
  onClose: () => void;
}) {
  const [opening] = useState(() => crypto.randomUUID());
  const sessionIds = useMemo(() => sessions.map((session) => session.id), [sessions]);
  const { data, loading, failed, retry } = useQuery({
    userId,
    key: `attendance-member:${opening}:${member.id}`,
    load: () => getMemberAttendance(member.id, sessionIds, summaryTerm || null),
  });
  const counts = data ? summarizeMarks(sessions, data.records) : null;
  const eligibility = data?.eligibility?.status ?? "eligible";
  return <Dialog open onClose={onClose} labelledBy="member-summary-title" describedBy="member-summary-copy" className="modal attendance-modal attendance-summary-modal">
    <IconButton className="modal-close" aria-label="Close the attendance summary" onClick={onClose}>×</IconButton>
    <p className="eyebrow">ATTENDANCE SUMMARY</p>
    <h2 id="member-summary-title">{member.name}</h2>
    <p id="member-summary-copy" className="modal-copy">{member.email ? `${member.email} · ` : ""}{periodLabel}</p>
    {data && counts ? <>
      <div className="attendance-summary-grid attendance-mark-stats">
        <Stat label="Present" value={counts.present} />
        <Stat label="Tardy" value={counts.tardy} />
        <Stat label="Excused" value={counts.excused} />
        <Stat label="Absent" value={counts.absent} tone={counts.absent >= 2 ? "warning" : undefined} />
        <Stat label="Rate" value={counts.rate === null ? "None yet" : `${counts.rate}%`} />
      </div>
      <p className="attendance-help">The rate counts closed meetings that count toward attendance: present and tardy against absent. An excused absence is left out.</p>
      {summaryTerm && <p className="attendance-eligibility-line"><b>Performance eligibility · {termLabel(summaryTerm)}:</b> {eligibility.replace("_", " ")}{data.eligibility?.reason ? ` (${data.eligibility.reason})` : ""}</p>}
      <MarkHistory rows={historyRows(sessions, data.records)} emptyText="No meetings are available for this view." />
    </> : failed ? <ErrorBlock message="The attendance summary could not be loaded." onRetry={() => { void retry(); }} role="alert" />
      : loading ? <SkeletonRows rows={5} label="Loading attendance summary…" /> : null}
    <Button type="button" variant="secondary" onClick={onClose}>Close</Button>
  </Dialog>;
}
