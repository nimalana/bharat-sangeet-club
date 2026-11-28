// How the portal writes dates, money and initials. One copy of each.
//
// Calendar days and instants in the CLUB's time zone are in lib/dates.ts (formatDay, formatDateTime). The date
// helpers here show an instant in the VIEWER's own time zone, which is what the library, recordings and
// announcement screens always did (a member in another zone sees their own day).

const dateFormat = { month: "short", day: "numeric", year: "numeric" } as const;

/**
 * "Sep 5, 2026" in the viewer's time zone.
 * A value that is not a date gives "Invalid Date" (the recordings screen's old behaviour). The announcement and library
 * screens used to throw a RangeError on such a value instead; no call site can pass one (the columns are NOT NULL timestamps).
 */
export function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("en-US", dateFormat);
}

/** Like formatDate, for a column that may be empty: "No date" when there is nothing to show (the library's old behaviour). */
export function formatDateOrNone(value: string | null | undefined): string {
  if (!value) return "No date";
  return formatDate(value);
}

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

/** "$1,234.50". */
export function formatMoney(value: number): string {
  return usd.format(value);
}

/** Up to two capital letters from the first two words of a name; "BS" (Bharat Sangeet) when there is none. */
export function initials(value: string): string {
  return value.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "BS";
}
