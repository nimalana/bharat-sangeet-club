// Everything the portal shell does with supabase.auth: who is signed in, hearing about a change, signing out.
// (The public login screen's signInWithOAuth is the public area's own call and stays with that screen.)
//
// Nothing here knows about React or a toast. A call that fails throws an ApiError (lib/errors.ts); a project that
// has no URL or key in its environment has no client, which the shell finds out with isSupabaseConfigured() before
// it asks for anything else, so the functions below throw an ApiError in that case instead of being called.
import type { User } from "@supabase/supabase-js";
import { ApiError, toApiError } from "../errors";
import { supabase } from "../supabase";

function client() {
  if (!supabase) throw new ApiError("Supabase is not configured");
  return supabase;
}

/** False when the project URL and key are missing from the environment: the shell then shows the setup screen. */
export function isSupabaseConfigured(): boolean {
  return supabase !== null;
}

/**
 * True when this browser holds a saved sign-in (the client keeps it in localStorage as sb-<project>-auth-token).
 * The server render cannot know, so the shell reads it right after hydration (useSyncExternalStore).
 */
export function hasSavedSession(): boolean {
  try { return Object.keys(window.localStorage).some((key) => /^sb-.+-auth-token$/.test(key)); } catch { return false; }
}

/** The signed-in user, or null when nobody is. Throws when the client cannot read the session. */
export async function getSessionUser(): Promise<User | null> {
  const { data, error } = await client().auth.getSession();
  if (error) throw toApiError(error);
  return data.session?.user ?? null;
}

/**
 * Calls `listener` with the signed-in user (null after sign-out) on every sign-in, token refresh and sign-out the client
 * reports. Returns the function that stops listening. Note that a token refresh hands over a NEW user object for the
 * same account: compare ids before treating it as a change.
 */
export function onAuthChange(listener: (user: User | null) => void): () => void {
  const { data } = client().auth.onAuthStateChange((_event, session) => { listener(session?.user ?? null); });
  return () => data.subscription.unsubscribe();
}

/** Signs this browser out. */
export async function signOut(): Promise<void> {
  const { error } = await client().auth.signOut();
  if (error) throw toApiError(error);
}
