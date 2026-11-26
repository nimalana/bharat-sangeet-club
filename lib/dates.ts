// Date helpers for the club portal.
//
// The database stores two different kinds of values and they must not be
// formatted the same way:
//   - calendar days (`date` columns such as purchase_date): "2026-09-05"
//   - instants (`timestamptz` columns such as starts_at): "2026-09-05T23:30:00+00:00"
//
// A calendar day has no time zone and is shown as written. An instant is shown
// in the club's own time zone so every member sees the same day and time.

export const CLUB_TIME_ZONE = "America/New_York";

const DAY_ONLY = /^\d{4}-\d{2}-\d{2}$/;

const dayFormat = { month: "short", day: "numeric", year: "numeric" } as const;

/** Formats a calendar day or an instant as a day, e.g. "Sep 5, 2026". */
export function formatDay(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const timeZone = DAY_ONLY.test(value) ? "UTC" : CLUB_TIME_ZONE;
  return new Intl.DateTimeFormat("en-US", { ...dayFormat, timeZone }).format(date);
}

/** Formats an instant as a day and time in the club's time zone. */
export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", { ...dayFormat, hour: "numeric", minute: "2-digit", timeZone: CLUB_TIME_ZONE }).format(date);
}

/** Today's calendar day in the club's time zone, as "YYYY-MM-DD". */
export function clubToday(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: CLUB_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}
