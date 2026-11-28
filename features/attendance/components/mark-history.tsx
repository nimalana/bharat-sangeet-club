"use client";

import { formatDateTime } from "../display";
import type { HistoryRow } from "../model";

// A person's meetings, newest first as the overview sends them, each with the mark on it (or, with no mark, the meeting's own status).
// The member's own page and an executive's summary of a member draw it the same way.
export function MarkHistory({ rows, emptyText }: { rows: HistoryRow[]; emptyText: string }) {
  return <div className="member-history">{rows.length ? rows.map((row) => <article key={row.session.id}><div><b>{row.session.title}</b><small>{formatDateTime(row.session.starts_at)}</small></div><span className={`attendance-status ${row.status}`}>{row.status}{row.minutesLate !== null ? ` · ${row.minutesLate}m` : ""}</span></article>) : <div className="attendance-empty">{emptyText}</div>}</div>;
}
