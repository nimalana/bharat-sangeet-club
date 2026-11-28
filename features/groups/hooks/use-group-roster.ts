"use client";

// A group's roster (its members and the people waiting to join), read with list_subgroup_roster as a cached read (lib/hooks/use-query.ts,
// key "group-roster:<id>"): reopening a group's people shows the last roster at once and refreshes behind it. Reloads follow every
// change and can overlap, so only the newest answer may replace the roster; a failed read keeps the roster shown and says so, and a
// failed FIRST read has nothing to show (`loadError` with an empty roster and `hasRoster` false: the screen offers Try again).
import { listSubgroupRoster, type RosterRow } from "../../../lib/api/groups";
import { friendlyError } from "../../../lib/errors";
import { useQuery } from "../../../lib/hooks/use-query";

/** `userId` keys the cache (a roster is remembered for the person who read it); without it the read is simply not remembered. */
export function useGroupRoster(groupId: number, userId = "") {
  const query = useQuery<RosterRow[]>({ userId, key: `group-roster:${groupId}`, load: () => listSubgroupRoster(groupId) });
  const loadError = query.failed ? friendlyError(query.error as Parameters<typeof friendlyError>[0], "The roster could not be loaded.") : "";

  return {
    roster: query.data ?? [],
    loading: query.loading,
    loadError,
    /** Something is on screen (a read answered at least once, now or in an earlier visit). */
    hasRoster: query.data !== undefined,
    loadRoster: query.refetch,
    /** "Try again": shows the loading state again when there is nothing to show, and asks once more. */
    retry: query.retry,
  };
}
