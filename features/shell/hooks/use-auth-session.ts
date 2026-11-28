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
 * Supabase hands back a new user object on every token refresh. Keeping the old one while the id is unchanged stops
 * every screen from reloading, so `user` changes identity only when the account does.
 */
export function useAuthSession() {
  const savedSession = useSyncExternalStore(subscribeNothing, hasSavedSession, () => false);
  const [authLoading, setAuthLoading] = useState(true);
  const [user, setUser] = useState<User | null>(null);

  const adoptUser = useCallback((next: User | null) => { setUser((current) => (current?.id === next?.id ? current : next)); }, []);

  useEffect(() => {
    if (!isSupabaseConfigured()) { setAuthLoading(false); return; }
    let cancelled = false;
    const loadingTimeouts = new Set<number>();
    const hydrateAuth = async () => {
      const loadingTimeout = window.setTimeout(() => { if (!cancelled) setAuthLoading(false); }, 7000);
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
        if (!cancelled) setAuthLoading(false);
      }
    };
    void hydrateAuth();
    const stopListening = onAuthChange((nextUser) => {
      if (cancelled) return;
      adoptUser(nextUser);
    });
    const restore = (event: PageTransitionEvent) => { if (event.persisted) { setAuthLoading(true); void hydrateAuth(); } };
    window.addEventListener("pageshow", restore);
    return () => { cancelled = true; loadingTimeouts.forEach((timeout) => window.clearTimeout(timeout)); window.removeEventListener("pageshow", restore); stopListening(); };
  }, [adoptUser]);

  return { savedSession, authLoading, user };
}
