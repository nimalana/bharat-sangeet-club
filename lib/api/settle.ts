// A read that a screen handles on its own, next to other reads that may fail separately.
//
//   const [groups, memberships] = await Promise.all([settle(listSubgroups()), settle(listMyMemberships(userId))]);
//   setGroups((current) => listOrKeep(current, groups));      // a list that failed keeps what is shown
//
// The data layer throws an ApiError for a failed call, so `Promise.all` of several reads would reject on the first failure and the
// screen would lose the others. `settle` turns a failed read into `{ data: null, error }` and a good one into `{ data, error: null }`
// (the shape lib/refresh.ts `listOrKeep` reads), so every read of the batch is still answered. Only an ApiError is turned into an
// answer: anything else (a bug, not a database answer) is thrown on, as it was.
import { ApiError } from "../errors";

export type Settled<T> = { data: T | null; error: ApiError | null };

export async function settle<T>(read: Promise<T>): Promise<Settled<T>> {
  try {
    return { data: await read, error: null };
  } catch (error) {
    if (error instanceof ApiError) return { data: null, error };
    throw error;
  }
}
