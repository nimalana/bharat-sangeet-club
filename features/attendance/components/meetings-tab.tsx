"use client";

import { Button } from "../../../components/ui/button";
import type { ActionDialog } from "../action-dialog";
import { formatDateTime, sessionAudience } from "../display";
import type { GroupOption } from "../../../lib/db";
import type { AttendanceSession, Roster } from "../model";
import { SessionCorrections } from "./attendance-corrections";
import type { SummaryMember } from "./member-summary-dialog";
import { SessionRoster } from "./session-roster";

// Meetings tab (executives): the list of meetings, and for the selected one its roster with open, close and the corrections
// (edit, delete, void).
export function MeetingsTab({ sessions, groups, selectedSessionId, onSelect, roster, rosterFailed, saving, openingSessionId = null, onOpenAttendance, onDialog, onSessionChanged, onRefresh, onRetryRoster, onSummary }: {
  sessions: AttendanceSession[];
  groups: GroupOption[];
  selectedSessionId: number | null;
  onSelect: (sessionId: number) => void;
  roster: Roster | null;
  rosterFailed: boolean;
  saving: boolean;
  /** The meeting whose check-in is being opened right now (its button is busy). */
  openingSessionId?: number | null;
  onOpenAttendance: (sessionId: number) => void;
  onDialog: (dialog: ActionDialog) => void;
  /** A meeting was edited, deleted or voided: read the overview again. */
  onSessionChanged: () => void;
  /** A mark changed: read the overview and the roster again. */
  onRefresh: () => void;
  onRetryRoster: (sessionId: number) => void;
  /** Opens a member's attendance summary from the roster. Without it a name is only text. */
  onSummary?: (member: SummaryMember) => void;
}) {
  const selectedSession = sessions.find((session) => session.id === selectedSessionId) || null;
  return <div className="attendance-meetings">
    <aside aria-label="Meetings">
      {sessions.length ? sessions.map((session) => (
        <button type="button" className={selectedSessionId === session.id ? "active" : ""} aria-current={selectedSessionId === session.id ? "true" : undefined} key={session.id} onClick={() => onSelect(session.id)}>
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
            <div>{selectedSession.status === "draft" && <Button type="button" onClick={() => onOpenAttendance(selectedSession.id)} disabled={saving} pending={openingSessionId === selectedSession.id}>Open check-in</Button>}{selectedSession.status === "open" && <Button type="button" onClick={() => onDialog({ kind: "session", sessionId: selectedSession.id, title: selectedSession.title, action: "close" })} disabled={saving}>Close</Button>}<SessionCorrections key={selectedSession.id} session={selectedSession} onChanged={onSessionChanged} /></div>
          </div>
          <SessionRoster session={selectedSession} roster={roster} failed={rosterFailed} saving={saving} onDialog={onDialog} onRefresh={onRefresh} onRetry={() => onRetryRoster(selectedSession.id)} onSummary={onSummary} />
        </>
      ) : <div className="attendance-empty">Choose a meeting to view its roster.</div>}
    </div>
  </div>;
}
