"use client";

// A group's roster (its members and the people waiting to join), read with list_subgroup_roster. Reloads follow every change and can
// overlap, so only the newest answer may replace the roster; a failed read keeps the roster shown and says so.
import { useCallback, useEffect, useState } from "react";
import { listSubgroupRoster, type RosterRow } from "../../../lib/api/groups";
import { settle } from "../../../lib/api/settle";
import { friendlyError } from "../../../lib/errors";
import { createRequestGate } from "../../../lib/request-gate";

export function useGroupRoster(groupId: number) {
  const [roster, setRoster] = useState<RosterRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  // Reloads follow every change and can overlap; only the newest answer may replace the roster.
  const [loadGate] = useState(createRequestGate);

  const loadRoster = useCallback(async () => {
    const isCurrent = loadGate.begin();
    const { data, error } = await settle(listSubgroupRoster(groupId));
    if (!isCurrent()) return;
    if (error) setLoadError(friendlyError(error, "The roster could not be loaded."));
    else { setLoadError(""); setRoster(data || []); }
    setLoading(false);
  }, [groupId, loadGate]);

  // The loader synchronizes remote Supabase state into this client component.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void loadRoster(); }, [loadRoster]);

  /** "Try again": shows the loading line again and asks once more. */
  const retry = () => { setLoading(true); void loadRoster(); };

  return { roster, loading, loadError, loadRoster, retry };
}
