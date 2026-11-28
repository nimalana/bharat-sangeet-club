"use client";

import { useCallback, useRef, useState } from "react";
import { useToast } from "../../../components/ui/toast";
import { isSupabaseConfigured } from "../../../lib/api/auth";
import { loadPortalLists, loadWorkspaceLists } from "../../../lib/api/portal";
import type { Announcement, ArchiveItem, ClubEvent, Subgroup, SubgroupMembership } from "../../../lib/portal-types";
import { countOrKeep, listOrKeep } from "../../../lib/refresh";
import { createRequestGate } from "../../../lib/request-gate";

/** What get_portal_bootstrap hands the shell besides the profile: the lists every page may read. */
export type PortalLists = { groups: Subgroup[]; memberships: SubgroupMembership[]; announcements: Announcement[]; events: ClubEvent[]; archive: ArchiveItem[]; resource_count: number };

export type PortalData = ReturnType<typeof usePortalData>;

/**
 * The lists the shell keeps for every page (the club's recordings, the calendar, the announcements, the groups and the
 * person's memberships, the resource count) and the loads that refresh them.
 *
 * Overlapping loads: only the newest may change the screen, and none may once the signed-in account has changed
 * (`switchAccount` makes everything still in flight stale; a load also compares the account it started for). A list that
 * failed to load keeps what is shown; it is not replaced by an empty one (lib/refresh.ts).
 */
export function usePortalData() {
  const { notify } = useToast();
  const [archive, setArchive] = useState<ArchiveItem[]>([]);
  const [events, setEvents] = useState<ClubEvent[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [groups, setGroups] = useState<Subgroup[]>([]);
  const [memberships, setMemberships] = useState<SubgroupMembership[]>([]);
  const [resourceCount, setResourceCount] = useState(0);
  const [dataLoading, setDataLoading] = useState(false);
  const [dataGate] = useState(createRequestGate);
  const [workspaceGate] = useState(createRequestGate);
  // The account the lists belong to: null while nobody is signed in.
  const activeUserId = useRef<string | null>(null);

  /** The signed-in account is now `userId` (or nobody): loads that are still in flight no longer count. */
  const switchAccount = useCallback((userId: string | null) => {
    activeUserId.current = userId;
    dataGate.cancel(); workspaceGate.cancel();
  }, [dataGate, workspaceGate]);

  const isActiveAccount = useCallback((userId: string) => activeUserId.current === userId, []);

  /** Takes the lists out of the bootstrap answer. */
  const adoptBootstrap = useCallback((boot: PortalLists) => {
    setGroups(boot.groups);
    setMemberships(boot.memberships);
    setAnnouncements(boot.announcements);
    setEvents(boot.events);
    setArchive(boot.archive);
    setResourceCount(Number(boot.resource_count) || 0);
  }, []);

  /** Forgets everything: nobody is signed in. */
  const clear = useCallback(() => {
    setGroups([]); setMemberships([]);
    setAnnouncements([]); setEvents([]); setArchive([]); setResourceCount(0); setDataLoading(false);
  }, []);

  /** Reloads the club archive, the calendar, the announcements and the resource count. */
  const loadData = useCallback(async () => {
    if (!isSupabaseConfigured()) return;
    const owner = activeUserId.current;
    const isCurrent = dataGate.begin();
    setDataLoading(true);
    try {
      const { archive: archiveResult, events: eventsResult, announcements: announcementResult, resourceCount: resourceCountResult } = await loadPortalLists();
      if (!isCurrent() || activeUserId.current !== owner) return;
      if (archiveResult.error) notify("The club archive could not be loaded");
      if (eventsResult.error) notify("The calendar could not be loaded");
      if (announcementResult.error) notify("Announcements could not be loaded");
      if (resourceCountResult.error) notify("The resource count could not be loaded");
      // A list that failed to load keeps what is shown; it is not replaced by an empty one.
      setArchive((current) => listOrKeep(current, archiveResult));
      setEvents((current) => listOrKeep(current, eventsResult));
      setAnnouncements((current) => listOrKeep(current, announcementResult));
      setResourceCount((current) => countOrKeep(current, resourceCountResult));
    } catch {
      if (isCurrent()) notify("The club data could not be loaded. Check your connection and try again.");
    } finally {
      if (isCurrent()) setDataLoading(false);
    }
  }, [dataGate, notify]);

  /** Reloads the groups and this person's memberships (after they join, leave or change one). */
  const reloadWorkspaces = useCallback(async (userId: string) => {
    const isCurrent = workspaceGate.begin();
    const { groups: groupResult, memberships: membershipResult } = await loadWorkspaceLists(userId);
    if (!isCurrent() || activeUserId.current !== userId) return;
    if (groupResult.error || membershipResult.error) { notify("Your groups could not be loaded"); return; }
    setGroups(groupResult.data || []);
    setMemberships(membershipResult.data || []);
  }, [notify, workspaceGate]);

  return {
    archive, events, announcements, groups, memberships, resourceCount, dataLoading,
    setResourceCount, setDataLoading,
    switchAccount, isActiveAccount, adoptBootstrap, clear, loadData, reloadWorkspaces,
  };
}
