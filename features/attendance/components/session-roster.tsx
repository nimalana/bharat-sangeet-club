"use client";

import { ErrorBlock } from "../../../components/ui/error-block";
import { SkeletonRows } from "../../../components/ui/skeleton";
import type { AttendanceStatus } from "../../../lib/db";
import type { ActionDialog } from "../action-dialog";
import { formatUnits } from "../display";
import type { AttendanceSession, Roster } from "../model";
import { ClearMarkButton } from "./attendance-corrections";

// The members of one meeting with their marks and what each mark costs under the policy. Changing a mark opens a dialog (the
// caller sends nothing until it is confirmed).
export function SessionRoster({ session, roster, failed, saving, onDialog, onRefresh, onRetry }: {
  session: AttendanceSession;
  /** The last roster read; it counts only when it is this meeting's. */
  roster: Roster | null;
  failed: boolean;
  saving: boolean;
  onDialog: (dialog: ActionDialog) => void;
  onRefresh: () => void;
  onRetry: () => void;
}) {
  const rosterReady = roster !== null && roster.session_id === session.id;
  return <div className="attendance-roster">
    <div className="attendance-roster-head"><span>Member</span><span>Status</span><span>Policy impact</span><span>Action</span></div>
    {rosterReady ? roster.rows.map((row) => {
      const memberName = row.full_name || row.email || "member";
      return (
        <div className="attendance-roster-row" key={row.member_id}>
          <div><b>{row.full_name || row.email || "Member"}</b><small>{row.email}</small></div>
          <span className={`attendance-status ${row.status || "pending"}`}>{row.status || "pending"}</span>
          <span>{row.status === "tardy" ? `${row.minutes_late} min late · ${formatUnits(row.unexcused_units ?? 0)} unexcused` : row.status === "absent" ? "1 unexcused" : row.status === "excused" ? "Remediation required" : "-"}</span>
          <select value={row.status || "pending"} disabled={saving} onChange={(event) => onDialog({ kind: "status", sessionId: session.id, memberId: row.member_id, memberName, status: event.target.value as AttendanceStatus })} aria-label={`Attendance status for ${memberName}`}>
            <option value="pending" disabled>Pending</option><option value="present">Present</option><option value="tardy">Tardy</option><option value="absent">Absent</option><option value="excused">Excused</option>
          </select>
          {row.status && session.status !== "canceled" && <ClearMarkButton sessionId={session.id} memberId={row.member_id} memberName={memberName} onChanged={onRefresh} />}
        </div>
      );
    }) : failed ? <ErrorBlock className="attendance-empty" message="The roster could not be loaded." onRetry={onRetry} role="alert" /> : <SkeletonRows rows={4} label="Loading roster…" />}
  </div>;
}
