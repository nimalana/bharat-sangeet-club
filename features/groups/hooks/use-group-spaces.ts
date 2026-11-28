"use client";

// What the groups page shows and how it is read: the groups, the person's memberships, the groups' recordings and announcements,
// and how many requests wait in each group. All five are asked together; a list that fails keeps what is shown (an empty list
// would read as "no groups") and one toast says that something could not be loaded. Several actions reload this page, so
// only the newest answer may replace the lists.
import type { User } from "@supabase/supabase-js";
import { useCallback, useEffect, useState } from "react";
import { listGroupAnnouncements, listGroupRecordings, listMyMemberships, listOthersWaitingRequests, listSubgroups } from "../../../lib/api/groups";
import { settle } from "../../../lib/api/settle";
import type { Announcement, ArchiveItem, Subgroup, SubgroupMembership } from "../../../lib/portal-types";
import { listOrKeep } from "../../../lib/refresh";
import { createRequestGate } from "../../../lib/request-gate";
import { useToast } from "../../../components/ui/toast";

/** How many requests wait in each group: one entry per group that has any. */
export function countRequestsByGroup(rows: ReadonlyArray<{ subgroup_id: number }>): Record<number, number> {
  const counts: Record<number, number> = {};
  for (const row of rows) counts[row.subgroup_id] = (counts[row.subgroup_id] || 0) + 1;
  return counts;
}

export function useGroupSpaces(user: User) {
  const { notify } = useToast();
  const [groups, setGroups] = useState<Subgroup[]>([]);
  const [memberships, setMemberships] = useState<SubgroupMembership[]>([]);
  const [items, setItems] = useState<ArchiveItem[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [requestCounts, setRequestCounts] = useState<Record<number, number>>({});
  const [loading, setLoading] = useState(true);
  // Several actions reload this screen; a slower, older answer must not replace a newer one.
  const [loadGate] = useState(createRequestGate);

  const load = useCallback(async () => {
    const isCurrent = loadGate.begin();
    const [groupResult, membershipResult, archiveResult, announcementResult, requestResult] = await Promise.all([
      settle(listSubgroups()),
      settle(listMyMemberships(user.id)),
      settle(listGroupRecordings()),
      settle(listGroupAnnouncements()),
      // Row-level security returns other people's waiting requests only to executives and to that group's leaders and managers.
      settle(listOthersWaitingRequests(user.id)),
    ]);
    if (!isCurrent()) return;
    if (groupResult.error || membershipResult.error || archiveResult.error || announcementResult.error) notify("Some group information could not be loaded", "error");
    // A list that failed keeps what is shown instead of becoming empty.
    if (!requestResult.error) setRequestCounts(countRequestsByGroup(requestResult.data || []));
    setGroups((current) => listOrKeep(current, groupResult));
    setMemberships((current) => listOrKeep(current, membershipResult));
    setItems((current) => listOrKeep(current, archiveResult));
    setAnnouncements((current) => listOrKeep(current, announcementResult));
    setLoading(false);
  }, [loadGate, notify, user.id]);

  useEffect(() => { load(); }, [load]);

  return { groups, memberships, items, announcements, requestCounts, loading, load, setMemberships };
}
