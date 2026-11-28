// The call-site half of the data layer: gives a lib/api function back the `{ data, error }` shape that a handler reads when it
// branches on the failure (which toast, which fallback) instead of letting it propagate.
//
//   const { data: rows, error } = await attempt(() => updateRecordingDetails(id, fields));
//   if (error || !rows?.length) { notify(friendlyError(error, "You do not have permission to edit this recording."), "error"); return; }
//
// Only an ApiError (the database answered with an error) becomes `error`. Anything else a call throws (a dropped connection that
// rejects, a bug) is thrown again, exactly as the raw `await supabase...` threw it before the data layer existed.
import { ApiError } from "../errors";

export type Attempt<T> = { data: T; error: null } | { data: null; error: ApiError };

export async function attempt<T>(call: () => Promise<T>): Promise<Attempt<T>> {
  try {
    return { data: await call(), error: null };
  } catch (thrown) {
    if (thrown instanceof ApiError) return { data: null, error: thrown };
    throw thrown;
  }
}
