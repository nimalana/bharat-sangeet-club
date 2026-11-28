"use client";

import type { RosterRow } from "../../../lib/api/groups";
import { Button } from "../../../components/ui/button";

/** The people waiting to join a group, with Approve, Waitlist and Decline (what a group's leaders and executives see). */
export function JoinRequestsPanel({ requests, busyKey, onReview, onDecline }: {
  requests: RosterRow[]; busyKey: string; onReview: (row: RosterRow, decision: "approve" | "waitlist") => void; onDecline: (row: RosterRow) => void;
}) {
  return <div className="mt-5 border border-[var(--carolina)] bg-[var(--carolina-pale)] p-4">
    <h3 className="m-0 text-base">Requests to join <span className="ml-1 text-sm font-normal text-[#4c5f6b]">({requests.length})</span></h3>
    <ul className="m-0 mt-3 grid list-none gap-3 p-0">
      {requests.map((row) => <li key={row.member_id} className="flex flex-wrap items-center justify-between gap-3 border-t border-[#b9d3e3] pt-3 first:border-t-0 first:pt-0">
        <div className="min-w-0"><b className="block truncate text-sm">{row.full_name || row.email}</b><small className="block truncate text-xs text-[#4c5f6b]">{row.email}{row.status === "waitlisted" ? " · Waitlisted" : ""}</small></div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={Boolean(busyKey)} onClick={() => onReview(row, "approve")}>{busyKey === `approve-${row.member_id}` ? "Approving…" : "Approve"}</Button>
          {row.status === "pending" && <Button size="sm" variant="secondary" disabled={Boolean(busyKey)} onClick={() => onReview(row, "waitlist")}>{busyKey === `waitlist-${row.member_id}` ? "Waitlisting…" : "Waitlist"}</Button>}
          <Button size="sm" variant="danger" disabled={Boolean(busyKey)} onClick={() => onDecline(row)}>{busyKey === `decline-${row.member_id}` ? "Declining…" : "Decline"}</Button>
        </div>
      </li>)}
    </ul>
  </div>;
}
