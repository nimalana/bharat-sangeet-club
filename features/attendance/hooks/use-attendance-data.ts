// What the attendance screen reads and keeps fresh: the overview for the audience and term in view, the roster of the selected
// meeting, and the 10 second poll while check-in is open. The screen's own state (tabs, dialogs, writes) is not here.
//
// The rules this hook keeps (pinned by tests/component/attendance.test.tsx):
// - only the answer to the newest request of each kind is used (overview, poll, roster), so a slow answer for an earlier
//   audience, term or poll can never overwrite newer data;
// - a failing background refresh is reported once, not every 10 seconds;
// - reopening the screen shows the last data at once and refreshes behind it;
// - the poll patches the open meeting in place and reads the overview again only when something it cannot patch changed;
// - the roster is read when a meeting is selected on the Meetings tab, and again when the poll says its marks moved.
import type { User } from "@supabase/supabase-js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { attempt } from "../../../lib/api/attempt";
import { getAttendanceOverview, getAttendanceRoster } from "../../../lib/api/attendance";
import { readCache, writeCache } from "../../../lib/cache";
import type { ScopeFilter } from "../../../lib/db";
import { useToast } from "../../../components/ui/toast";
import {
  DEFAULT_LIST_LIMIT, EMPTY_OVERVIEW, createFailureGate, createSequencer, nextListLimit, normalizeOverview,
  type AttendanceOverview, type AttendanceTab, type Roster,
} from "../model";
import { useAttendancePoll, type PollState } from "./use-attendance-poll";

const viewKey = (scope: ScopeFilter, term: string) => `attendance2:${scope}:${term}`;

export function useAttendanceData({ user, canManage, initialScope, tab }: {
  user: User;
  canManage: boolean;
  initialScope: ScopeFilter;
  /** The tab on screen: the poll reads the roster again only while the Meetings tab shows it. */
  tab: AttendanceTab;
}) {
  const { notify } = useToast();
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>(initialScope);
  const [termFilter, setTermFilter] = useState("all");
  // How many items each review queue lists for an executive (see queueNote in
  // attendance-model.ts). 'Show more' raises it once the server has answered
  // with the larger lists; changing the audience or term puts it back, so a long
  // list is only loaded on request. A ref, because every load reads the value
  // in force when it starts and none should start because it changed.
  const listLimit = useRef<number>(DEFAULT_LIST_LIMIT);
  const [loadingMore, setLoadingMore] = useState(false);
  // Reopening the screen shows the last data at once and refreshes behind it.
  const cacheKey = viewKey(scopeFilter, termFilter);
  const [cached] = useState(() => readCache<AttendanceOverview>(user.id, viewKey(initialScope, "all")));
  // What has been read for each audience and term this visit, so the data on
  // screen always belongs to the audience and term chosen now.
  const [views, setViews] = useState<Record<string, AttendanceOverview>>(() => cached ? { [viewKey(initialScope, "all")]: normalizeOverview(cached) } : {});
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const data = views[cacheKey] ?? null;
  const view = data ?? EMPTY_OVERVIEW;
  const sessions = view.sessions;
  const [roster, setRoster] = useState<Roster | null>(null);
  const [rosterFailed, setRosterFailed] = useState(false);
  const [selectedSessionId, setSelectedSessionId] = useState<number | null>(cached?.sessions?.[0]?.id ?? null);

  // Only the answer to the newest request of each kind is used, so a slow
  // answer for an earlier audience, term or poll can never overwrite newer data.
  const [loadSeq] = useState(createSequencer);
  const [pulseSeq] = useState(createSequencer);
  const [rosterSeq] = useState(createSequencer);
  // A refresh in the background reports a failure once, not every 10 seconds.
  const [failures] = useState(createFailureGate);
  const latest = useRef<PollState>({ key: cacheKey, data, roster, selectedSessionId, tab });
  useEffect(() => { latest.current = { key: cacheKey, data, roster, selectedSessionId, tab }; });
  useEffect(() => () => { loadSeq.invalidate(); pulseSeq.invalidate(); rosterSeq.invalidate(); }, [loadSeq, pulseSeq, rosterSeq]);

  const scopeArgs = useMemo(() => ({
    p_scope: scopeFilter === "all" ? "all" : scopeFilter === "club" ? "club" : "subgroup",
    p_subgroup_id: typeof scopeFilter === "number" ? scopeFilter : null,
    p_term_key: termFilter === "all" ? null : termFilter,
  }), [scopeFilter, termFilter]);

  const reportFailure = useCallback((background: boolean, message: string) => {
    if (failures.shouldNotify(background)) notify(message, "error");
  }, [failures, notify]);

  const load = useCallback(async (silent = false, limit: number = listLimit.current) => {
    const id = loadSeq.next();
    const key = cacheKey;
    if (!silent) {
      setFailedKey(null);
      // Show what this audience and term looked like last time while it refreshes.
      const earlier = readCache<AttendanceOverview>(user.id, key);
      if (earlier) setViews((current) => current[key] ? current : { ...current, [key]: normalizeOverview(earlier) });
    }
    try {
      // One request for the whole screen. It carries totals and the open
      // review queues, never every mark.
      // The overview alone takes the queue cap; the poll takes the audience only.
      const { data: result, error } = await attempt(() => getAttendanceOverview(scopeArgs, limit));
      if (!loadSeq.isLatest(id)) return;
      if (error || !result) { reportFailure(silent, "Attendance could not be loaded. Try again in a moment."); setFailedKey(key); return; }
      failures.succeeded();
      listLimit.current = limit;
      const next = normalizeOverview(result as Partial<AttendanceOverview>);
      const ids = next.sessions.map((session) => session.id);
      setViews((current) => ({ ...current, [key]: next }));
      setFailedKey(null);
      setSelectedSessionId((current) => current && ids.includes(current) ? current : next.sessions[0]?.id || null);
      writeCache(user.id, key, next);
    } catch {
      if (!loadSeq.isLatest(id)) return;
      reportFailure(silent, "Attendance could not be loaded. Check your connection and try again.");
      setFailedKey(key);
    }
  }, [cacheKey, failures, loadSeq, reportFailure, scopeArgs, user.id]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const loadRoster = useCallback(async (sessionId: number, background = false) => {
    const id = rosterSeq.next();
    // A read the person asked for (a meeting chosen, Try again) shows the loading rows while it runs; a read in the background
    // (the poll) leaves what is on screen alone.
    if (!background) setRosterFailed(false);
    try {
      const { data: result, error } = await attempt(() => getAttendanceRoster(sessionId));
      if (!rosterSeq.isLatest(id)) return;
      if (error || !result) { setRosterFailed(true); reportFailure(background, "The roster could not be loaded. Try again in a moment."); return; }
      failures.succeeded();
      setRosterFailed(false);
      setRoster(result as Roster);
    } catch {
      if (!rosterSeq.isLatest(id)) return;
      setRosterFailed(true);
      reportFailure(background, "The roster could not be loaded. Check your connection and try again.");
    }
  }, [failures, reportFailure, rosterSeq]);

  // The meeting roster is read when a meeting is selected, not with the overview.
  // `rosterTick` reads it again although neither the tab nor the selection
  // changed: opening check-in on the meeting that is on screen adds its whole
  // roster (the roster of a draft is empty), and nothing else would refresh it.
  const [rosterTick, setRosterTick] = useState(0);
  const rereadRoster = useCallback(() => setRosterTick((count) => count + 1), []);
  useEffect(() => {
    if (!canManage || tab !== "meetings" || selectedSessionId === null) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRosterFailed(false);
    loadRoster(selectedSessionId);
  }, [canManage, tab, selectedSessionId, loadRoster, rosterTick]);

  // While check-in is open the poll keeps the open meeting current (see use-attendance-poll.ts).
  const hasOpenSession = sessions.some((session) => session.status === "open");
  useAttendancePoll({ cacheKey, scopeArgs, canManage, hasOpenSession, latest, loadSeq, pulseSeq, failures, reportFailure, load, loadRoster, setViews });

  // A new audience or term starts again at the first page of the review queues.
  const chooseScope = useCallback((value: ScopeFilter) => { setScopeFilter(value); listLimit.current = DEFAULT_LIST_LIMIT; }, []);
  const chooseTerm = useCallback((value: string) => { setTermFilter(value); listLimit.current = DEFAULT_LIST_LIMIT; }, []);

  // 'Show more' asks the server for the next cap and keeps it for later loads
  // only once the larger lists have arrived (a failure leaves the page as it was
  // and the button to try again). It is absent once the most the server gives is
  // already in force.
  const nextLimit = canManage ? nextListLimit(view.list_limit) : null;
  const showMore = nextLimit === null ? null : () => {
    if (loadingMore) return;
    setLoadingMore(true);
    load(false, nextLimit).finally(() => setLoadingMore(false));
  };

  return {
    scopeFilter, termFilter, chooseScope, chooseTerm,
    /** The overview read for this audience and term; null until the first read has answered. */
    data,
    /** `data`, or an empty overview while there is none. */
    view,
    failedKey, cacheKey,
    load, showMore, loadingMore,
    roster, rosterFailed, loadRoster, rereadRoster,
    selectedSessionId, setSelectedSessionId,
  };
}
