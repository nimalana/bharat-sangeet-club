// The poll that keeps an open meeting current: every 10 seconds, only for a visible page, plus one at once when the page becomes
// visible again. It patches the open meeting in place (counts, status, the person's own mark) and reads the overview again only
// when something it cannot patch changed (see pulseNeedsReload in model.ts). It never sends a queue cap, and an answer for a
// poll that is no longer the newest, or for another audience or term, changes nothing.
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { useCallback } from "react";
import { attempt } from "../../../lib/api/attempt";
import { getAttendancePulse, type AttendanceViewArgs } from "../../../lib/api/attendance";
import { usePolling } from "../../../lib/hooks/use-polling";
import { applyPulse, pulseNeedsReload, rosterIsStale, type AttendanceOverview, type AttendanceTab, type Pulse, type Roster, type createFailureGate, type createSequencer } from "../model";

const POLL_MS = 10000;

/** What the poll compares its answer with: the screen as of its last render. */
export type PollState = { key: string; data: AttendanceOverview | null; roster: Roster | null; selectedSessionId: number | null; tab: AttendanceTab };

export function useAttendancePoll({ cacheKey, scopeArgs, canManage, hasOpenSession, latest, loadSeq, pulseSeq, failures, reportFailure, load, loadRoster, setViews }: {
  cacheKey: string;
  scopeArgs: AttendanceViewArgs;
  canManage: boolean;
  hasOpenSession: boolean;
  latest: MutableRefObject<PollState>;
  loadSeq: ReturnType<typeof createSequencer>;
  pulseSeq: ReturnType<typeof createSequencer>;
  failures: ReturnType<typeof createFailureGate>;
  reportFailure: (background: boolean, message: string) => void;
  load: (silent?: boolean) => Promise<void>;
  loadRoster: (sessionId: number, background?: boolean) => Promise<void>;
  setViews: Dispatch<SetStateAction<Record<string, AttendanceOverview>>>;
}) {
  const pulse = useCallback(async () => {
    const key = cacheKey;
    const generation = loadSeq.current();
    const id = pulseSeq.next();
    try {
      const { data: result, error } = await attempt(() => getAttendancePulse(scopeArgs));
      const state = latest.current;
      if (!pulseSeq.isLatest(id) || !loadSeq.isLatest(generation) || state.key !== key || !state.data) return;
      if (error || !result) { reportFailure(true, "Attendance could not be refreshed. Try again in a moment."); return; }
      failures.succeeded();
      const reply = result as Pulse;
      const watchingRoster = canManage && state.tab === "meetings" && state.selectedSessionId !== null;
      if (pulseNeedsReload(state.data.sessions, reply, state.data.excuses_pending, canManage, state.data.items_version)) {
        load(true);
        if (watchingRoster && state.selectedSessionId !== null) loadRoster(state.selectedSessionId, true);
        return;
      }
      setViews((current) => current[key] ? { ...current, [key]: { ...current[key], ...applyPulse(current[key], reply) } } : current);
      // The open meeting's marks changed since its roster was read: read it again.
      const watched = reply.sessions.find((session) => session.id === state.selectedSessionId);
      if (watchingRoster && watched && rosterIsStale(state.roster, watched)) loadRoster(watched.id, true);
    } catch {
      if (!pulseSeq.isLatest(id)) return;
      reportFailure(true, "Attendance could not be refreshed. Check your connection and try again.");
    }
  }, [cacheKey, canManage, failures, latest, load, loadRoster, loadSeq, pulseSeq, reportFailure, scopeArgs, setViews]);

  usePolling(pulse, POLL_MS, hasOpenSession);
}
