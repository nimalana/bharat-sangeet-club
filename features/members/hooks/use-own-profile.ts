"use client";

import type { User } from "@supabase/supabase-js";
import { useCallback, useEffect, useState } from "react";
import { getOwnProfile } from "../../../lib/api/members";
import type { MemberProfile } from "../../../lib/db";

type State = { done: boolean; failed: boolean; profile: MemberProfile | null };

/**
 * The signed-in member's own profile row, read fresh each time the screen that asks for it opens (nothing is cached: the form it fills
 * starts from these values, and a copy from an earlier visit would put old values back on a save). `loading` until the read has answered,
 * `failed` when it could not be read (the screen says so and offers `retry`), `profile` null when no row answered.
 * `enabled: false` reads nothing.
 */
export function useOwnProfile(user: User, enabled = true) {
  const [round, setRound] = useState(0);
  const [state, setState] = useState<State>({ done: false, failed: false, profile: null });

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    getOwnProfile(user.id).then(
      (profile) => { if (!cancelled) setState({ done: true, failed: false, profile }); },
      () => { if (!cancelled) setState({ done: true, failed: true, profile: null }); },
    );
    return () => { cancelled = true; };
  }, [user.id, enabled, round]);

  /** Try again after a failed read: the screen shows its loading state while it runs. */
  const retry = useCallback(() => { setState({ done: false, failed: false, profile: null }); setRound((current) => current + 1); }, []);
  return { loading: !state.done, failed: state.failed, profile: state.profile, retry };
}
