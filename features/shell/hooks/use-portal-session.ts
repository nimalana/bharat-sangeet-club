"use client";

import type { User } from "@supabase/supabase-js";
import { useCallback, useEffect, useState } from "react";
import { useToast } from "../../../components/ui/toast";
import { isSupabaseConfigured, signOut } from "../../../lib/api/auth";
import { getPortalBootstrap, updateOwnFullName } from "../../../lib/api/portal";
import { runBootstrap, type ShellState } from "../../../lib/bootstrap";
import { setCacheOwner } from "../../../lib/cache";
import type { ClubRole, AccountStatus } from "../../../lib/db";
import { pendingSignupNameKey } from "../../public/constants";
import { useAuthSession } from "./use-auth-session";
import type { PortalData, PortalLists } from "./use-portal-data";

// `pending_signups` is only in the answer for executives and administrators: how many sign-ups wait for approval.
type PortalBootstrap = PortalLists & { profile: { full_name: string; role: ClubRole; status: AccountStatus } | null; pending_signups?: number };

/**
 * The state machine of the signed-in shell: nobody signed in, signed in and waiting for get_portal_bootstrap, ready,
 * failed (shown with Try again), deactivated, or not a member yet (pending: a sign-up waiting for an executive; rejected: one that was declined).
 * A pending or rejected account makes no request but the bootstrap, and nothing is adopted from its answer.
 *
 * One request loads everything the shell needs. The role and the deactivated flag both come from it, so nothing is
 * shown on a guess: if the answer does not arrive, `shellState` is "failed", never a member screen. A response that
 * arrives after the signed-in account has changed is thrown away (P1-07). It runs once per signed-in account, not on
 * every token refresh (useAuthSession keeps the same user object while the id is the same).
 */
export function usePortalSession(data: PortalData) {
  const { notify } = useToast();
  const { savedSession, authLoading, user } = useAuthSession();
  const [role, setRole] = useState<ClubRole>("member");
  const [shellState, setShellState] = useState<ShellState>("loading");
  const [name, setName] = useState("");
  const [pendingSignups, setPendingSignups] = useState(0);
  const { switchAccount, isActiveAccount, adoptBootstrap, clear, setDataLoading, reloadWorkspaces } = data;

  const bootstrap = useCallback(async (currentUser: User) => {
    if (!isSupabaseConfigured()) return;
    setShellState("loading");
    setDataLoading(true);
    const outcome = await runBootstrap<PortalBootstrap>(getPortalBootstrap);
    if (!isActiveAccount(currentUser.id)) return;
    setDataLoading(false);
    if (outcome.kind !== "ready") { setShellState(outcome.kind); return; }
    const boot = outcome.boot;
    setRole(boot.profile.role);
    adoptBootstrap(boot);
    setName(boot.profile.full_name || currentUser.email?.split("@")[0] || "Club member");
    setPendingSignups(typeof boot.pending_signups === "number" ? boot.pending_signups : 0);
    setShellState("ready");
    const pendingSignupName = window.sessionStorage.getItem(pendingSignupNameKey)?.trim();
    if (pendingSignupName) {
      const { error: updateError } = await updateOwnFullName(currentUser.id, pendingSignupName);
      if (updateError) notify("Your account was created, but your preferred name could not be saved");
      else {
        window.sessionStorage.removeItem(pendingSignupNameKey);
        if (isActiveAccount(currentUser.id)) setName(pendingSignupName);
      }
    }
  }, [notify, setDataLoading, isActiveAccount, adoptBootstrap]);

  const resetShell = useCallback(() => {
    setRole("member"); setName(""); setPendingSignups(0); setShellState("loading"); clear();
  }, [clear]);

  // Runs once per signed-in account, not on every token refresh.
  useEffect(() => {
    switchAccount(user?.id ?? null);
    setCacheOwner(user?.id ?? null);
    // This effect synchronizes the shell with the signed-in account.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (user) void bootstrap(user); else resetShell();
  }, [user, bootstrap, resetShell, switchAccount]);

  /** Asks for the bootstrap again (the Try again button of the failed screen, Check again on the pending one). */
  const retry = useCallback(() => { if (user) void bootstrap(user); }, [user, bootstrap]);

  /** Reloads the groups and memberships once the shell is ready (what the groups page asks for after a change). */
  const loadWorkspaces = useCallback(async () => {
    if (!isSupabaseConfigured() || !user || shellState !== "ready") return;
    await reloadWorkspaces(user.id);
  }, [user, shellState, reloadWorkspaces]);

  // A failed sign-out is silent, as it always was: the person is still signed in and presses it again.
  const signOutQuietly = useCallback(() => { if (isSupabaseConfigured()) void signOut().catch(() => {}); }, []);

  return { savedSession, authLoading, user, shellState, role, name, setName, pendingSignups, setPendingSignups, retry, loadWorkspaces, signOutQuietly };
}
