// Types and pure helpers for the attendance screen (app/attendance.tsx).
// Kept free of React and Supabase so they run under `node --test`.

export type ClubRole = "member" | "executive" | "admin";
export type SessionStatus = "draft" | "open" | "closed" | "canceled";
export type RecordStatus = "pending" | "present" | "absent" | "excused" | "tardy";
export type ExcuseStatus = "pending" | "approved" | "denied" | "withdrawn";
export type RemediationStatus = "pending" | "complete" | "waived";
export type EligibilityStatus = "eligible" | "under_review" | "restricted" | "reinstated";
export type AbsenceCategory = "class_exam" | "family_emergency" | "illness" | "other_club_event" | "other";

// What an executive sees about a meeting that is open right now. `version`
// changes whenever the roster's content does: a participant joins (opening
// check-in adds them all, with no mark yet) or a mark is added, changed or
// cleared. It is the same text as the roster's own `version`. Treat it as
// opaque: only compare it for equality.
export type SessionLive = { roster_count: number; checked_in_count: number; version: string };

export type AttendanceSession = {
  id: number;
  scope: "club" | "subgroup";
  subgroup_id: number | null;
  subgroup_name?: string | null;
  title: string;
  starts_at: string;
  status: SessionStatus;
  opened_at: string | null;
  closes_at: string | null;
  closed_at: string | null;
  canceled_at: string | null;
  cancel_reason?: string | null;
  code_expires_at: string | null;
  created_at: string;
  counts_toward_metrics: boolean;
  live?: SessionLive | null;
};
export type AttendanceRecord = {
  session_id: number;
  member_id: string;
  status: RecordStatus;
  source: string;
  note: string | null;
  marked_at: string | null;
  minutes_late: number;
  unexcused_units: number;
};
export type Profile = { id: string; full_name: string; email: string };
export type Excuse = {
  id: number;
  session_id: number;
  member_id: string;
  reason: string;
  proof_path: string | null;
  reason_category: AbsenceCategory;
  notified_at: string | null;
  status: ExcuseStatus;
  submitted_at: string;
  reviewed_at: string | null;
  review_note: string | null;
};
export type Remediation = {
  id: number;
  session_id: number;
  member_id: string;
  assignment: string;
  due_at: string | null;
  status: RemediationStatus;
  note: string | null;
};
export type Eligibility = { term_key: string; member_id: string; status: EligibilityStatus; reason: string | null };
// One member's totals over the closed meetings in view. The server sends these
// only for members at or above the warning level.
export type FlaggedRow = {
  member_id: string;
  present: number;
  absent: number;
  excused: number;
  tardy: number;
  club_units: number;
  subgroup_units: number;
  eligibility: EligibilityStatus | null;
};
export type Thresholds = { warning: number; critical: number };

export type AttendanceOverview = {
  terms: string[];
  term: string | null;
  view_term: string;
  summary_term: string;
  sessions: AttendanceSession[];
  records: AttendanceRecord[];
  excuses: Excuse[];
  excuses_pending: number;
  excuses_total: number;
  remediations: Remediation[];
  remediations_pending: number;
  eligibility: Eligibility[];
  flagged: FlaggedRow[];
  attended_total: number;
  absent_total: number;
  profiles: Profile[];
  settings: { warning_absences: number; critical_absences: number } | null;
  // Changes when the caller's own absence forms or follow-up items change (an
  // executive: when the number of waiting forms or open items does). The poll
  // carries the same text. Null from a server that does not send it.
  items_version: string | null;
  // The cap the server applied to each review queue an executive sees.
  list_limit: number;
};

export type RosterRow = {
  member_id: string;
  full_name: string | null;
  email: string | null;
  status: RecordStatus | null;
  minutes_late: number | null;
  unexcused_units: number | null;
};
export type Roster = { session_id: number; version: string; rows: RosterRow[] };

export type PulseSession = {
  id: number;
  status: SessionStatus;
  closes_at: string | null;
  code_expires_at: string | null;
  live: SessionLive | null;
  my_record: AttendanceRecord | null;
};
export type Pulse = { sessions: PulseSession[]; pending_excuses: number | null; items_version?: string | null };

export const EMPTY_OVERVIEW: AttendanceOverview = {
  terms: [], term: null, view_term: "", summary_term: "", sessions: [], records: [], excuses: [], excuses_pending: 0, excuses_total: 0,
  remediations: [], remediations_pending: 0, eligibility: [], flagged: [], attended_total: 0, absent_total: 0, profiles: [], settings: null, items_version: null, list_limit: 100,
};

// A response from the server with any missing list read as empty, so a screen
// never crashes on a partial answer.
export function normalizeOverview(value: Partial<AttendanceOverview> | null | undefined): AttendanceOverview {
  return { ...EMPTY_OVERVIEW, ...(value || {}) };
}

export function termLabel(value: string) {
  const [year, season] = value.split("-");
  return `${season === "spring" ? "Spring" : "Fall"} ${year}`;
}

// The Term picker offers the terms the server found, plus the one in use even
// when this audience has no meetings in it, so the picker never shows a blank.
export function termChoices(terms: string[], active: string) {
  return active !== "all" && !terms.includes(active) ? [active, ...terms] : terms;
}

export type MemberSummary = {
  memberId: string;
  name: string;
  email: string;
  present: number;
  absent: number;
  excused: number;
  tardy: number;
  clubUnits: number;
  subgroupUnits: number;
  unexcusedUnits: number;
  rate: number;
  flag: "critical" | "warning" | "none";
  eligibility: EligibilityStatus;
};

// The members to list under "needing attention", from the server's totals.
// The attendance rate, the level and the order are worked out here exactly as
// they were when the page held every mark.
export function flaggedSummaries(rows: FlaggedRow[], profiles: Profile[], thresholds: Thresholds): MemberSummary[] {
  const byId = new Map(profiles.map((profile) => [profile.id, profile]));
  return rows.map((row) => {
    const clubUnits = Number(row.club_units) || 0;
    const subgroupUnits = Number(row.subgroup_units) || 0;
    const counted = row.present + row.absent + row.tardy;
    const profile = byId.get(row.member_id);
    const worst = Math.max(clubUnits, subgroupUnits);
    return {
      memberId: row.member_id,
      name: profile?.full_name || profile?.email || "Member",
      email: profile?.email || "",
      present: row.present,
      absent: row.absent,
      excused: row.excused,
      tardy: row.tardy,
      clubUnits,
      subgroupUnits,
      unexcusedUnits: clubUnits + subgroupUnits,
      rate: counted ? Math.round(((row.present + row.tardy) / counted) * 100) : 100,
      flag: (worst >= thresholds.critical ? "critical" : worst >= thresholds.warning ? "warning" : "none") as MemberSummary["flag"],
      eligibility: row.eligibility || "eligible",
    };
  }).filter((summary) => summary.flag !== "none")
    .sort((left, right) => right.unexcusedUnits - left.unexcusedUnits || left.name.localeCompare(right.name));
}

// Share of counted marks (present or tardy against absent) over the closed meetings.
export function overallRate(attended: number, absent: number) {
  return attended + absent ? Math.round((attended / (attended + absent)) * 100) : 100;
}

export function openSessionIds(sessions: Array<{ id: number; status: SessionStatus }>) {
  return sessions.filter((session) => session.status === "open").map((session) => session.id).sort((a, b) => a - b);
}

// Does the poll show something the page cannot patch in place? A meeting that
// opened, closed or was canceled, a changed number of waiting absence forms
// (executives), or a change in the caller's own forms and follow-up items (a
// decision on a member's form, a new or completed item) means the full overview
// is read again. `itemsVersion` is the overview's own `items_version`.
export function pulseNeedsReload(known: Array<{ id: number; status: SessionStatus }>, pulse: Pulse, excusesPending: number, canManage: boolean, itemsVersion: string | null = null) {
  const before = openSessionIds(known);
  const after = pulse.sessions.map((session) => session.id).sort((a, b) => a - b);
  if (before.length !== after.length || before.some((id, index) => id !== after[index])) return true;
  if (pulse.items_version != null && pulse.items_version !== itemsVersion) return true;
  return canManage && pulse.pending_excuses !== null && pulse.pending_excuses !== undefined && pulse.pending_excuses !== excusesPending;
}

// Patches the open meetings with the poll's answer and replaces the caller's
// own mark on each of them (a cleared mark disappears).
export function applyPulse(state: { sessions: AttendanceSession[]; records: AttendanceRecord[] }, pulse: Pulse) {
  const byId = new Map(pulse.sessions.map((session) => [session.id, session]));
  const sessions = state.sessions.map((session) => {
    const update = byId.get(session.id);
    return update ? { ...session, status: update.status, closes_at: update.closes_at, code_expires_at: update.code_expires_at, live: update.live } : session;
  });
  const records = state.records.filter((record) => !byId.has(record.session_id));
  for (const update of pulse.sessions) if (update.my_record) records.push(update.my_record);
  return { sessions, records };
}

// A roster is out of date when the open meeting's roster changed after it was read:
// someone joined it or a mark was added, changed or cleared.
export function rosterIsStale(roster: { session_id: number; version: string } | null, session: { id: number; live?: SessionLive | null } | null) {
  return !!roster && !!session?.live && roster.session_id === session.id && roster.version !== session.live.version;
}

// Hands out request numbers so only the answer to the latest request is used.
export function createSequencer() {
  let latest = 0;
  return {
    next: () => ++latest,
    current: () => latest,
    isLatest: (id: number) => id === latest,
    // Drops every answer still on its way (used when the screen goes away).
    invalidate: () => { latest += 1; },
  };
}

// Decides which failures to show. A request the person made is always reported;
// a background refresh is reported once and then stays quiet until one succeeds.
export function createFailureGate() {
  let failing = false;
  return {
    shouldNotify(background: boolean) {
      const show = !background || !failing;
      failing = true;
      return show;
    },
    succeeded() { failing = false; },
  };
}

// The 10 second refresh only runs for a visible page with a meeting open.
export function shouldPoll(visibility: string | undefined, hasOpenMeeting: boolean) {
  return hasOpenMeeting && visibility !== "hidden";
}

// Whole minutes, 0 to 1440 (the most the database accepts), or null.
export function parseMinutesLate(value: string) {
  const text = value.trim();
  if (!/^\d{1,4}$/.test(text)) return null;
  const minutes = Number(text);
  return minutes <= 1440 ? minutes : null;
}

// The review queues an executive sees (waiting absence forms, other absence
// forms, open follow-up items) come newest first and are capped, so the first
// load stays small however many items there are. The totals are exact. The cap
// starts at DEFAULT_LIST_LIMIT and 'Show more' asks for the next step; the
// server (get_attendance_overview) accepts up to the last step and no more, so
// keep these in step with its p_list_limit clamp. Past that, the Term and View
// filters narrow what is listed. Members are never capped.
export const LIST_LIMIT_STEPS = [100, 250, 500, 1000] as const;
export const DEFAULT_LIST_LIMIT = LIST_LIMIT_STEPS[0];

// The next cap to ask for after `current`, or null when `current` is the most
// the server gives.
export function nextListLimit(current: number): number | null {
  return LIST_LIMIT_STEPS.find((step) => step > current) ?? null;
}

// Says what a capped list leaves out. `limit` is the cap in force: when no
// larger one exists the note points to the filters instead.
export function queueNote(shown: number, total: number, noun: string, limit: number = DEFAULT_LIST_LIMIT) {
  if (total <= shown) return "";
  const base = `Showing the latest ${shown} of ${total} ${noun}. Older ones are hidden.`;
  return nextListLimit(limit) === null ? `${base} Narrow the view by group or term to reach them.` : base;
}
