"use client";

// The correction dialog: one small form (a reason, an amount, edited details) that runs one audited change.
//
// `action` is what the dialog shows (null: closed). Submitting it runs the action once, whatever the number of clicks: the run goes
// through the screen's single flight (shared with the one-click changes, so a correction and a Mark paid cannot overlap). The dialog
// stays busy until the lists have been read again (bounded by refreshAfterChange), so no second change can start in between.
//
//   - the database refused the change (ApiError): its sentence, as an error; the dialog stays open for another try;
//   - the call threw (no network): "That change could not be saved. Check your connection and try again."; the dialog stays open;
//   - the change went through: its success message (or, when it left something undone, the warning instead, as an error); the
//     dialog closes and the lists are read again.
import { useState } from "react";
import { ApiError, friendlyError } from "../../../lib/errors";
import type { SingleFlight } from "../../../lib/single-flight";
import { useToast } from "../../../components/ui/toast";
import { CHANGE_NOT_SAVED_OFFLINE } from "../constants";
import type { ActionOutcome, FinanceAction } from "../types";

export function useActionRunner({ flight, refreshAfterChange }: { flight: SingleFlight; refreshAfterChange: () => Promise<void> }) {
  const { notify } = useToast();
  const [action, setAction] = useState<FinanceAction | null>(null);
  const [actionBusy, setActionBusy] = useState(false);

  async function runAction(values: Record<string, string>) {
    const current = action;
    if (!current) return;
    await flight.run(async () => {
      // Busy until the refreshed lists are on screen, so no second change can start in between.
      setActionBusy(true);
      try {
        let outcome: ActionOutcome;
        // A change the database refuses is an ApiError, worded by friendlyError; anything else thrown is a call that never got an answer.
        try { outcome = await current.run(values); }
        catch (error) {
          if (error instanceof ApiError) notify(friendlyError(error, "That change could not be saved."), "error");
          else notify(CHANGE_NOT_SAVED_OFFLINE, "error");
          return;
        }
        // A change that went through but left something undone is reported as the problem it is.
        if (outcome?.warning) notify(outcome.warning, "error"); else notify(current.success, "success");
        setAction(null); await refreshAfterChange();
      } finally { setActionBusy(false); }
    });
  }

  return { action, setAction, actionBusy, runAction };
}
