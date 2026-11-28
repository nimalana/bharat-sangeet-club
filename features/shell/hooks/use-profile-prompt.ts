"use client";

import type { User } from "@supabase/supabase-js";
import { useCallback, useEffect, useRef, useState } from "react";
import { getOwnProfile } from "../../../lib/api/members";
import type { MemberProfile } from "../../../lib/db";

const flagKey = (userId: string) => `bharat-sangeet-profile-step:${userId}`;
/** "done": the profile has contact details (typed here or before). "skipped": the person pressed Skip for now or closed the step. */
type Flag = "done" | "skipped";

// Storage can be blocked, full or absent (a private window, cleared site data): every access is guarded and the page works without it.
// Without it the step is offered on every sign-in instead of once, which is the only thing lost.
function readFlag(userId: string): string | null {
  try { return window.localStorage.getItem(flagKey(userId)); } catch { return null; }
}
function writeFlag(userId: string, value: Flag) {
  try { window.localStorage.setItem(flagKey(userId), value); } catch { /* the step may come back next time */ }
}

/**
 * A profile is "not completed" when none of the three optional details (phone, class year, voice or instrument) has ever been filled in: the
 * name always is, it comes from the Google account. (A database column, profiles.profile_completed_at, would say it exactly: needs.)
 */
function hasContactDetails(profile: MemberProfile): boolean {
  return [profile.phone, profile.class_year, profile.specialty].some((value) => typeof value === "string" && value.trim() !== "");
}

/**
 * The "Complete your profile" step, once, for a member whose profile has no contact details: `profile` is the person's own row while the
 * step is due (null otherwise: show nothing), `skip` closes it for good (Skip for now, Close, Escape) and `saved` closes it after a save.
 *
 * `ready` is "the shell has the answer of the bootstrap" (a pending, rejected, deactivated or failed account never gets here) and `atHome` is
 * "the person is on the home page", where everyone lands after signing in: somebody who followed a link to the calendar or a recording is not
 * interrupted on the way, and sees the step when they next open Home. It only looks if this browser has no recorded answer for this person.
 * A profile that already has details records "done" and is not read again; a read that fails or answers nothing readable shows nothing, is not
 * recorded (it looks again on the next sign-in) and is not repeated in the same visit.
 */
export function useProfilePrompt(user: User | null, ready: boolean, atHome: boolean) {
  const userId = user?.id ?? null;
  const [due, setDue] = useState<{ userId: string; profile: MemberProfile } | null>(null);
  const looked = useRef<string | null>(null);
  const enabled = ready && atHome;

  useEffect(() => {
    if (!userId || !enabled || looked.current === userId || readFlag(userId)) return;
    looked.current = userId;
    getOwnProfile(userId).then(
      (profile) => {
        // An answer that comes after the person signed out or changed account is not theirs to act on (the check below), and one that is not a
        // single row of this person (no row, a list, somebody else's row) is not readable.
        if (!profile || typeof profile !== "object" || Array.isArray(profile) || profile.id !== userId) return;
        if (hasContactDetails(profile)) writeFlag(userId, "done");
        else setDue({ userId, profile });
      },
      () => { /* not shown, not recorded: it looks again next time */ },
    );
  }, [userId, enabled]);

  const finish = useCallback((flag: Flag) => { if (userId) writeFlag(userId, flag); setDue(null); }, [userId]);
  const skip = useCallback(() => finish("skipped"), [finish]);
  const saved = useCallback(() => finish("done"), [finish]);
  return { profile: enabled && due && due.userId === userId ? due.profile : null, skip, saved };
}
