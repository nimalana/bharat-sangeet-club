"use client";

// The one-click changes: Mark paid on a reimbursement and the status buttons of a funding claim (Mark ready, Mark submitted, Back to editing).
//
// They run one at a time. `pendingKey` says which one is running so its button can show it ("Paying…"); the screen's single flight
// stops a second click before the next render can switch the buttons off. A change stays "running" until the refreshed lists are on
// screen (a paid request is still listed as approved until then, with its button). Paying out money and sending a claim to the funder
// ask first: the button sets `confirming`, and the confirmation dialog calls confirmChange.
import { useState } from "react";
import { clubToday } from "../../../lib/dates";
import { friendlyError } from "../../../lib/errors";
import type { SingleFlight } from "../../../lib/single-flight";
import { financeAvailable, payPersonalReimbursement, setFundingClaimStatus, type FundingClaim } from "../../../lib/api/finance";
import { useToast } from "../../../components/ui/toast";
import { CHANGE_NOT_SAVED_OFFLINE } from "../constants";
import { refusal } from "../refusal";
import type { FinanceConfirm } from "../types";

export function useOneClickChanges({ flight, refreshAfterChange, isClaimComplete }: {
  flight: SingleFlight;
  refreshAfterChange: (saved?: boolean) => Promise<void>;
  isClaimComplete: (claim: FundingClaim) => boolean;
}) {
  const { notify } = useToast();
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<FinanceConfirm>(null);

  // Runs one of the one-click changes. A second click while one is running does nothing.
  async function runOnce(key: string, work: () => Promise<void>) {
    await flight.run(async () => {
      setPendingKey(key);
      try { await work(); }
      catch { notify(CHANGE_NOT_SAVED_OFFLINE, "error"); }
      finally { setPendingKey(null); }
    });
  }

  async function markReimbursementPaid(id: number) {
    if (!financeAvailable()) return;
    await runOnce(`pay-${id}`, async () => {
      const failure = await refusal(payPersonalReimbursement(id, clubToday(), "Club bank account"));
      // Reload either way: a failure usually means another executive already paid it.
      if (failure) { notify(friendlyError(failure, "The payment could not be recorded."), "error"); await refreshAfterChange(false); return; }
      notify("Reimbursement marked paid"); await refreshAfterChange();
    });
  }

  async function updateClaimStatus(claim: FundingClaim, status: string) {
    if (!financeAvailable()) return;
    if (status === "ready" && !isClaimComplete(claim)) { notify("Complete every required claim document first", "error"); return; }
    await runOnce(`claim-${claim.id}-${status}`, async () => {
      const failure = await refusal(setFundingClaimStatus(claim.id, status));
      if (failure) { notify(friendlyError(failure, "The claim could not be updated"), "error"); await refreshAfterChange(false); return; }
      notify("Funding claim updated"); await refreshAfterChange();
    });
  }

  async function confirmChange() {
    if (!confirming) return;
    // The dialog stays open until the change is done, then closes whatever the outcome (a toast says how it went).
    if (confirming.kind === "pay") await markReimbursementPaid(confirming.request.id);
    else await updateClaimStatus(confirming.claim, "submitted");
    setConfirming(null);
  }

  return { pendingKey, confirming, setConfirming, updateClaimStatus, confirmChange };
}
