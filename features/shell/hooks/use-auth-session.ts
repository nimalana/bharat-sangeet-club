"use client";

import type { User } from "@supabase/supabase-js";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { getSessionUser, hasSavedSession, isSupabaseConfigured, onAuthChange } from "../../../lib/api/auth";

// The server render cannot know whether this browser holds a saved sign-in, so it
// reports false and the first client render agrees; the value is read right after hydration.
const subscribeNothing = () => () => {};

/**
 * Who is signed in. `authLoading` is true until the saved session has been read (or 7 seconds have passed: a session
 * that cannot be read must not keep the portal on its loading screen). `user` is null when nobody is signed in.
 *
 * With no Supabase project configured there is no session to read: `authLoading` is false from the first render (the setup screen
 * shows at once) instead of being set to false by an effect.
 *
 * Supabase hands back a new user object on every token refresh. Keeping the old one while the id is unchanged stops
 * every screen from reloading, so `user` changes identity only when the account does.
 */
export function useAuthSession() {
  const savedSession = useSyncExternalStore(subscribeNothing, hasSavedSession, () => false);
  const configured = isSupabaseConfigured();
  const [loadingSession, setLoadingSession] = useState(true);
  const authLoading = configured && loadingSession;
  const [user, setUser] = useState<User | null>(null);

  const adoptUser = useCallback((next: User | null) => { setUser((current) => (current?.id === next?.id ? current : next)); }, []);

  useEffect(() => {
    if (!configured) return;
    let cancelled = false;
    const loadingTimeouts = new Set<number>();
    const hydrateAuth = async () => {
      const loadingTimeout = window.setTimeout(() => { if (!cancelled) setLoadingSession(false); }, 7000);
      loadingTimeouts.add(loadingTimeout);
      try {
        const sessionUser = await getSessionUser();
        if (cancelled) return;
        adoptUser(sessionUser);
      } catch {
        if (!cancelled) adoptUser(null);
      } finally {
        window.clearTimeout(loadingTimeout);
        loadingTimeouts.delete(loadingTimeout);
        if (!cancelled) setLoadingSession(false);
      }
    };
    void hydrateAuth();
    const stopListening = onAuthChange((nextUser) => {
      if (cancelled) return;
      adoptUser(nextUser);
    });
    const restore = (event: PageTransitionEvent) => { if (event.persisted) { setLoadingSession(true); void hydrateAuth(); } };
    window.addEventListener("pageshow", restore);
    return () => { cancelled = true; loadingTimeouts.forEach((timeout) => window.clearTimeout(timeout)); window.removeEventListener("pageshow", restore); stopListening(); };
  }, [adoptUser, configured]);

  return { savedSession, authLoading, user };
}
