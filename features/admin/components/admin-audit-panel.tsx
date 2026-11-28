"use client";

import type { AuditEntry } from "../../../lib/api/admin";
import { formatDate } from "../../../lib/format";
import { adminActionLabels } from "./member-access";

/** The 20 latest administrator actions: what was done, to whom, by whom and when. */
export function AdminAuditPanel({ audit }: { audit: AuditEntry[] }) {
  return <section className="admin-panel audit-panel"><div className="admin-panel-heading"><div><p className="eyebrow">SECURITY</p><h2>Recent admin activity</h2></div><span>Last 20 actions</span></div>{audit.length ? audit.map((entry) => <div className="audit-row" key={entry.id}><span>{adminActionLabels[entry.action] || "Admin action"}</span><b>{entry.target_email}</b><small>by {entry.actor_email} · {formatDate(entry.created_at)}</small></div>) : <p className="workspace-empty">No administrative changes recorded yet.</p>}</section>;
}
