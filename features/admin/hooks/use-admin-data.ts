"use client";

// What the Admin page shows and how it is read: every member (deactivated ones too), who is in which group, the latest
// announcements and the audit log. All four are asked together; a list that fails keeps what is shown (an empty roster would read
// as "no members") and one toast says that something could not be loaded. A reload after an edit can overlap the one before it,
// so only the newest answer may change the lists.
import { useCallback, useEffect, useState } from "react";
import { listAdminAnnouncements, listAdminMembers, listAuditLog, type AuditEntry } from "../../../lib/api/admin";
import { listAllMemberships } from "../../../lib/api/groups";
import { settle } from "../../../lib/api/settle";
import type { Announcement, MemberProfile, SubgroupMembership } from "../../../lib/portal-types";
import { listOrKeep } from "../../../lib/refresh";
import { createRequestGate } from "../../../lib/request-gate";
import { useToast } from "../../../components/ui/toast";

export function useAdminData() {
  const { notify } = useToast();
  const [members, setMembers] = useState<MemberProfile[]>([]);
  const [memberships, setMemberships] = useState<SubgroupMembership[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
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
    if (membersResult.error || membershipResult.error || announcementsResult.error || auditResult.error) notify("Some admin data could not be loaded", "error");
    // A list that failed keeps what is shown (an empty roster would read as "no members").
    setMembers((current) => listOrKeep(current, membersResult));
    setMemberships((current) => listOrKeep(current, membershipResult));
    setAnnouncements((current) => listOrKeep(current, announcementsResult));
    setAudit((current) => listOrKeep(current, auditResult));
    setLoading(false);
  }, [loadGate, notify]);
  useEffect(() => { load(); }, [load]);

  return { members, memberships, announcements, audit, loading, load };
}
