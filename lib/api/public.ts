// What the signed-out pages ask of Supabase (features/public): signing in with Google from the login screen, and the public concert
// archive when the server could not hand the list over (the server's own read stays in lib/public-concerts.ts, and the shell's
// session handling in lib/api/auth.ts).
//
// Plain async functions: no React, no sentence for the person. A database or auth error is thrown as an ApiError that keeps the
// message and code (lib/errors.ts).
import { ApiError, toApiError } from "../errors";
import { supabase } from "../supabase";
import { must } from "./_core";

/** False when the portal has no Supabase configuration: the public pages do nothing that needs it, as they always did. */
export const publicSiteAvailable = (): boolean => supabase !== null;

function client() {
  if (!supabase) throw new ApiError("The portal is not connected.");
  return supabase;
}

/** The columns the signed-out page shows of a public concert recording; no signed link is part of it. */
export async function listPublicConcertRecordings() {
  return must(await client().from("archive_items").select("id,title,description,type,storage_path,event_date,raga,tala,created_at,is_public").eq("type", "recording").eq("is_public", true).order("event_date", { ascending: false }));
}

/**
 * A link that plays one public concert for 10 minutes, or null when none could be made (the page then does nothing, as it
 * always did). It is asked for when a visitor clicks Watch: nothing time-limited sits in the cached page.
 */
export async function signPublicConcertUrl(storagePath: string): Promise<string | null> {
  const { data } = await client().storage.from("club-archive").createSignedUrl(storagePath, 600);
  return data ? data.signedUrl : null;
}

/** Sends the visitor to Google. The browser leaves the page on success; an error from Supabase's auth is thrown as an ApiError. */
export async function signInWithGoogle(redirectTo: string): Promise<void> {
  const { error } = await client().auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo },
  });
  if (error) throw toApiError(error);
}
