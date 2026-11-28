"use client";

// What the Admin page shows and how it is read: every member (deactivated ones too), who is in which group, the latest
// announcements and the audit log. All four are asked together; a list that fails keeps what is shown (an empty roster would read
// as "no members") and one toast says that something could not be loaded. A reload after an edit can overlap the one before it,
// so only the newest answer may change the lists.
//
// Each list also says how its last read went (`status`): "ready", "stale" (the last read failed, the list on screen is from an earlier
// read) or "failed" (nothing was ever read: the screen shows an error with Try again, never an empty list). `retry` is that Try again.
import { useCallback, useEffect, useRef, useState } from "react";
import { listAdminAnnouncements, listAdminMembers, listAuditLog, type AuditEntry } from "../../../lib/api/admin";
import { listAllMemberships } from "../../../lib/api/groups";
import { settle } from "../../../lib/api/settle";
import type { Announcement, MemberProfile, SubgroupMembership } from "../../../lib/db";
import { listOrKeep } from "../../../lib/refresh";
import { createRequestGate } from "../../../lib/request-gate";
import { useToast } from "../../../components/ui/toast";

export type AdminListName = "members" | "memberships" | "announcements" | "audit";
export type AdminListStatus = "ready" | "stale" | "failed";

const NAMES: readonly AdminListName[] = ["members", "memberships", "announcements", "audit"];
const READY: Record<AdminListName, AdminListStatus> = { members: "ready", memberships: "ready", announcements: "ready", audit: "ready" };

export function useAdminData() {
  const { notify } = useToast();
  const [members, setMembers] = useState<MemberProfile[]>([]);
  const [memberships, setMemberships] = useState<SubgroupMembership[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState(READY);
  const [retrying, setRetrying] = useState(false);
  // Which lists have ever been read: a failed read of one of those is "stale", of any other "failed".
  const known = useRef<Record<AdminListName, boolean>>({ members: false, memberships: false, announcements: false, audit: false });
  // A reload after an edit can overlap the one before it; only the newest answer may change the lists.
  const [loadGate] = useState(createRequestGate);

  const load = useCallback(async () => {
    const isCurrent = loadGate.begin();
    const [membersResult, announcementsResult, auditResult, membershipResult] = await Promise.all([
      settle(listAdminMembers()),
      settle(listAdminAnnouncements()),
      settle(listAuditLog()),
      settle(listAllMemberships()),
    ]);
    if (!isCurrent()) return;
    const results = { members: membersResult, memberships: membershipResult, announcements: announcementsResult, audit: auditResult };
    if (membersResult.error || membershipResult.error || announcementsResult.error || auditResult.error) notify("Some admin data could not be loaded", "error");
    const next = { ...READY };
    for (const name of NAMES) {
      const answered = !results[name].error && Boolean(results[name].data);
      if (answered) known.current[name] = true;
      next[name] = answered ? "ready" : known.current[name] ? "stale" : "failed";
    }
    setStatus(next);
    // A list that failed keeps what is shown (an empty roster would read as "no members").
    setMembers((current) => listOrKeep(current, membersResult));
    setMemberships((current) => listOrKeep(current, membershipResult));
    setAnnouncements((current) => listOrKeep(current, announcementsResult));
    setAudit((current) => listOrKeep(current, auditResult));
    setLoading(false);
  }, [loadGate, notify]);
  // The loader synchronizes remote Supabase state into this client component: it sets state after the awaited read, not in the effect body.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  /** "Try again" of a list that could not be read: reads all four again; `retrying` is true until they have answered. */
  const retry = useCallback(async () => {
    setRetrying(true);
    try { await load(); } finally { setRetrying(false); }
  }, [load]);

  return { members, memberships, announcements, audit, loading, load, status, retry, retrying };
}
