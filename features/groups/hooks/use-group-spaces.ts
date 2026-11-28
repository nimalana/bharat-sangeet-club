"use client";

// What the groups page shows and how it is read: the groups, the person's memberships, the groups' recordings and announcements,
// and how many requests wait in each group. The four reads go out together and are ONE cached read (lib/hooks/use-query.ts, key
// "groups"), the same discipline as the member directory: reopening the page shows the last lists at once and refreshes behind
// them, a failed refresh keeps the lists on screen, and if any of the reads fails the whole read counts as failed (a half-answer is
// never kept). A failed first read has nothing to show: the screen says so with Try again, not "no groups". Several actions reload
// this page (`load`), and only the newest answer may replace the lists.
//
// The memberships and the waiting requests of other people are ONE request (listMembershipsAndRequests: rows of both kinds), told
// apart here; the page used to send two reads of subgroup_memberships (finding F4 of docs/BROWSER_TIMINGS.md).
import type { User } from "@supabase/supabase-js";
import { useCallback, useEffect, useRef, useState } from "react";
import { listGroupAnnouncements, listGroupRecordings, listMembershipsAndRequests, listSubgroups } from "../../../lib/api/groups";
import type { Announcement, ArchiveItem, Subgroup, SubgroupMembership } from "../../../lib/db";
import { useQuery } from "../../../lib/hooks/use-query";
import { useToast } from "../../../components/ui/toast";

/** How many requests wait in each group: one entry per group that has any. */
export function countRequestsByGroup(rows: ReadonlyArray<{ subgroup_id: number }>): Record<number, number> {
  const counts: Record<number, number> = {};
  for (const row of rows) counts[row.subgroup_id] = (counts[row.subgroup_id] || 0) + 1;
  return counts;
}

/** Tells apart what one read of the memberships returns: the person's own rows, and the waiting requests of other people. */
export function splitMembershipRows(rows: readonly SubgroupMembership[], userId: string): { mine: SubgroupMembership[]; waitingOfOthers: SubgroupMembership[] } {
  return {
    mine: rows.filter((row) => row.member_id === userId),
    waitingOfOthers: rows.filter((row) => row.member_id !== userId && (row.status === "pending" || row.status === "waitlisted")),
  };
}

export type GroupSpacesSnapshot = { groups: Subgroup[]; memberships: SubgroupMembership[]; items: ArchiveItem[]; announcements: Announcement[]; requestCounts: Record<number, number> };

/** The page's one read: every list, asked together. Rejects (with the first ApiError) when any of them fails. */
async function readGroupSpaces(userId: string): Promise<GroupSpacesSnapshot> {
  const [groups, rows, items, announcements] = await Promise.all([listSubgroups(), listMembershipsAndRequests(userId), listGroupRecordings(), listGroupAnnouncements()]);
  const { mine, waitingOfOthers } = splitMembershipRows(rows, userId);
  return { groups, memberships: mine, items, announcements, requestCounts: countRequestsByGroup(waitingOfOthers) };
}

const EMPTY: GroupSpacesSnapshot = { groups: [], memberships: [], items: [], announcements: [], requestCounts: {} };

export function useGroupSpaces(user: User) {
  const { notify } = useToast();
  const query = useQuery<GroupSpacesSnapshot>({
    userId: user.id,
    key: "groups",
    load: () => readGroupSpaces(user.id),
    onError: () => notify("Some group information could not be loaded", "error"),
  });
  const snapshot = query.data;
  const { groups, items, announcements, requestCounts } = snapshot ?? EMPTY;

  // A person who joins is in the memberships at once, without a read: the page opens the group on the strength of it. The patch belongs
  // to the snapshot it was made over, so the next read (a different snapshot) replaces it with what the database says.
  const [patch, setPatch] = useState<{ over: GroupSpacesSnapshot | undefined; rows: SubgroupMembership[] } | null>(null);
  const memberships = patch && patch.over === snapshot ? patch.rows : (snapshot ?? EMPTY).memberships;
  // `setMemberships` keeps one identity and reads what is on screen when it is called (it is called after an await).
  const latest = useRef({ snapshot, memberships });
  useEffect(() => { latest.current = { snapshot, memberships }; });
  const setMemberships = useCallback((update: (current: SubgroupMembership[]) => SubgroupMembership[]) => setPatch({ over: latest.current.snapshot, rows: update(latest.current.memberships) }), []);

  return {
    groups, memberships, items, announcements, requestCounts,
    /** Nothing to show yet: the first read is on the way. */
    loading: query.loading,
    /** The last read failed; `hasData` says whether there is something (possibly old) on screen anyway. */
    failed: query.failed,
    hasData: snapshot !== undefined,
    load: query.refetch,
    retry: query.retry,
    setMemberships,
  };
}
