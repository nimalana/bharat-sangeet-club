// Telling "the database said no" from "could not reach it".
//
// The functions of lib/api/finance.ts throw an ApiError when Supabase answers with an error. A call that REJECTS (the network went
// away) is not an answer: it throws something else, and the screen must not word it as a refusal.

import { ApiError } from "../../lib/errors";

export type Answered<T> = { ok: true; value: T } | { ok: false; error: ApiError };

/**
 * Waits for an api call that gives a value. Resolves to the value, or to the ApiError the database answered with. A call that
 * rejects with anything else still throws, as it did before the answers were thrown.
 */
export async function answered<T>(work: PromiseLike<T>): Promise<Answered<T>> {
  try {
    return { ok: true, value: await work };
  } catch (error) {
    if (error instanceof ApiError) return { ok: false, error };
    throw error;
  }
}

/** Waits for an api call that gives nothing: resolves to the ApiError the database answered with, or null when it went through. */
export async function refusal(work: PromiseLike<unknown>): Promise<ApiError | null> {
  const outcome = await answered(work);
  return outcome.ok ? null : outcome.error;
}
