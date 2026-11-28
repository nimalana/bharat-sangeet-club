"use client";

import type { AuditEntry } from "../../../lib/api/admin";
import { formatDate } from "../../../lib/format";
import type { AdminListStatus } from "../hooks/use-admin-data";
import { ListFailure } from "./list-failure";
import { adminActionLabels } from "./member-access";

/** The 20 latest administrator actions: what was done, to whom, by whom and when. `status` says how the last read went (default: fine). */
export function AdminAuditPanel({ audit, status = "ready", onRetry = () => {}, retrying = false }: { audit: AuditEntry[]; status?: AdminListStatus; onRetry?: () => void; retrying?: boolean }) {
  return <section className="admin-panel audit-panel"><div className="admin-panel-heading"><div><p className="eyebrow">SECURITY</p><h2>Recent admin activity</h2></div><span>Last 20 actions</span></div>
    <ListFailure status={status} failed="The admin activity could not be loaded." stale="The admin activity could not be refreshed, so it may be out of date." onRetry={onRetry} busy={retrying} />
    {status !== "failed" && (audit.length ? audit.map((entry) => <div className="audit-row" key={entry.id}><span>{adminActionLabels[entry.action] || "Admin action"}</span><b>{entry.target_email}</b><small>by {entry.actor_email} · {formatDate(entry.created_at)}</small></div>) : <p className="workspace-empty">No administrative changes recorded yet.</p>)}</section>;
}
