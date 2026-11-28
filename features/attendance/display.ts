// How the attendance screens write things: the absence reasons, a count of units, an audience, a date and time.
// Pure and free of React and Supabase so they run under `node --test`. formatDateTime is the attendance screens' own (the
// viewer's time zone, "Date unavailable" for a bad value); lib/format.ts and lib/dates.ts word dates differently on purpose.

// Type-only import: this file is loaded by node's test runner, so it imports nothing at run time.
import type { AbsenceCategory, AttendanceSession, GroupOption } from "./model";

export const categoryLabels: Record<AbsenceCategory, string> = {
  class_exam: "Class or exam conflict",
  family_emergency: "Family emergency",
  illness: "Illness",
  other_club_event: "Other club meeting or event",
  other: "Other",
};

export function formatUnits(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export function sessionAudience(session: AttendanceSession, groups: GroupOption[]) {
  return session.scope === "club" ? "Club-wide" : `${session.subgroup_name || groups.find((group) => group.id === session.subgroup_id)?.name || "Subgroup"} rehearsal`;
}

export function formatDateTime(value: string | null | undefined) {
  const date = new Date(value || "");
  if (!Number.isFinite(date.getTime())) return "Date unavailable";
  try {
    return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
  } catch {
    return "Date unavailable";
  }
}

// The value of a datetime-local input for "now" in the viewer's time zone.
export function localDateTime() {
  const date = new Date(Date.now() - new Date().getTimezoneOffset() * 60000);
  return date.toISOString().slice(0, 16);
}
