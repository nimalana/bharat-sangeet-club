"use client";

// The finance screen's data: the load wave, the snapshot it makes, and the rules about what a refresh may replace.
//
// - Reopening the screen shows the last snapshot at once (lib/cache.ts) and reads again behind it. `loading` is true only while there
//   is nothing to show yet.
// - The eleven answers of a wave are applied together or not at all: if ANY of them failed (the totals RPC counts too, lib/finance-load.ts)
//   the lists, the totals and the cache keep the last good snapshot, `loadFailed` shows the banner and the person is told.
//   Without that, the cards would fall back to sums of the (capped) lists and the balance could read $0.00.
// - Only the newest read may change anything (lib/request-gate.ts): a slow older answer arriving last is dropped.
// - refreshAfterChange is what a change runs when it has been saved: it reads again and waits for that read, but not for ever
//   (lib/bounded-wait.ts): after REFRESH_WAIT_MS the caller moves on, the read carries on in the background and the person is told.
import { useCallback, useEffect, useState } from "react";
import { REFRESH_WAIT_MS, waitAtMost } from "../../../lib/bounded-wait";
import { readCache, writeCache } from "../../../lib/cache";
import { financeRefreshFailed } from "../../../lib/finance-load";
import { createRequestGate } from "../../../lib/request-gate";
import { financeAvailable, loadFinanceWave } from "../../../lib/api/finance";
import { useToast } from "../../../components/ui/toast";
import { REFRESH_SLOW_NOTICE, REFRESH_SLOW_NOTICE_UNSAVED } from "../constants";
import { buildSnapshot, snapshotFromCache } from "../model";
import type { FinanceSnapshot } from "../types";

export function useFinanceData({ userId, canManage }: { userId: string; canManage: boolean }) {
  const { notify } = useToast();
  // Reopening the screen shows the last data at once and refreshes behind it.
  const [cached] = useState(() => readCache<FinanceSnapshot>(userId, "finance"));
  const [snapshot, setSnapshot] = useState<FinanceSnapshot>(() => snapshotFromCache(cached));
  const [loading, setLoading] = useState(!cached);
  // A failed refresh keeps what is on screen; `loaded` says whether anything real is.
  const [loadFailed, setLoadFailed] = useState(false);
  const [loaded, setLoaded] = useState(Boolean(cached));
  const [loadGate] = useState(createRequestGate);
  // Try again after a failure is a read in flight that the button shows (busy) and cannot start twice.
  const [retrying, setRetrying] = useState(false);

  const loadFinance = useCallback(async () => {
    if (!financeAvailable()) return;
    if (!readCache(userId, "finance")) setLoading(true);
    const isCurrent = loadGate.begin();
    // Everything in one wave (it used to be three, one after another).
    const wave = await loadFinanceWave(canManage);
    if (!isCurrent()) return;
    // One failed query must not blank the lists (the balance would read $0.00): keep what is shown.
    // The totals RPC counts too. Without it the cards would fall back to sums of the (capped)
    // lists and quietly replace the database totals.
    if (financeRefreshFailed({ expenses: wave.expenses, reimbursements: wave.reimbursements, payments: wave.payments, documents: wave.documents, expenseDocuments: wave.expenseDocuments, reimbursementDocuments: wave.reimbursementDocuments, summary: wave.summary, claims: wave.claims, claimExpenses: wave.claimExpenses, claimDocuments: wave.claimDocuments, profiles: wave.profiles })) {
      setLoadFailed(true); setLoading(false);
      notify("Some finance records could not be loaded", "error");
      return;
    }
    setLoadFailed(false); setLoaded(true);
    const next = buildSnapshot(wave);
    setSnapshot(next);
    writeCache(userId, "finance", next);
    setLoading(false);
  }, [canManage, loadGate, notify, userId]);

  useEffect(() => {
    const timer = window.setTimeout(() => { loadFinance(); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadFinance]);

  // After a change the dialog stays busy until the lists have been read again, but not for ever: a read
  // that hangs must not leave a dialog stuck on a change that already went through. After REFRESH_WAIT_MS
  // the caller moves on (the dialog closes), the read carries on in the background and the person is told.
  // `saved` is false when the change was NOT saved (the refresh is run anyway): the notice must not say "Saved".
  const refreshAfterChange = useCallback(async (saved = true) => {
    const result = await waitAtMost(loadFinance(), REFRESH_WAIT_MS);
    if (result === "timeout") { if (saved) notify(REFRESH_SLOW_NOTICE, "success"); else notify(REFRESH_SLOW_NOTICE_UNSAVED, "error"); }
  }, [loadFinance, notify]);

  const retry = useCallback(async () => {
    setRetrying(true);
    try { await loadFinance(); } finally { setRetrying(false); }
  }, [loadFinance]);

  return { snapshot, loading, loaded, loadFailed, retrying, retry, loadFinance, refreshAfterChange };
}
