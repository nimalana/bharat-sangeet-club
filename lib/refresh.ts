// What a screen keeps when a refresh fails.
//
// The Supabase client does not throw on a failed query: it returns
// `{ data: null, error }`. Turning that into `data || []` replaced good,
// on-screen data with an empty list (Finance then showed $0.00 as the balance).
// A failed refresh keeps what is shown and tells the person; it never blanks it.

type ListResult<T> = { data: T[] | null; error?: unknown };
type CountResult = { count?: number | null; error?: unknown };

export function listOrKeep<T>(previous: T[], result: ListResult<T>): T[] {
  return result.error || !result.data ? previous : result.data;
}

export function countOrKeep(previous: number, result: CountResult): number {
  return result.error || typeof result.count !== "number" ? previous : result.count;
}

// A list loaded for one view (folder, filter, search) may only be kept when a
// refresh of that same view fails. Rows from another view would be wrong.
export function keepRowsOnFailure(shownKey: string | null, requestedKey: string): boolean {
  return shownKey !== null && shownKey === requestedKey;
}
