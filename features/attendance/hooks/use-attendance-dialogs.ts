// The dialog that is open on the attendance screen and the request behind it. A failure keeps the dialog open; cancelling a
// dialog never sends anything.
import { useState } from "react";
import { attempt } from "../../../lib/api/attempt";
import {
  cancelAttendanceSession, closeAttendanceSession, reviewAttendanceExcuse, setAttendanceEligibility, setAttendanceRemediation, setAttendanceStatus,
} from "../../../lib/api/attendance";
import { friendlyError } from "../../../lib/errors";
import { useToast } from "../../../components/ui/toast";
import type { ActionDialog } from "../action-dialog";
import { parseMinutesLate } from "../model";
import type { Exclusive } from "./use-exclusive";

export function useAttendanceDialogs({ summaryTerm, exclusive, refresh, clearLiveCode }: {
  /** The term the eligibility marks are for (the overview's `summary_term`). */
  summaryTerm: string;
  exclusive: Exclusive;
  /** Read the overview, and the roster the Meetings tab shows, again. */
  refresh: () => void;
  /** Closing or canceling check-in forgets the live code. */
  clearLiveCode: () => void;
}) {
  const { notify } = useToast();
  const [dialog, setDialog] = useState<ActionDialog | null>(null);

  // Runs the request behind an open dialog. A failure keeps the dialog open;
  // cancelling a dialog never sends anything.
  async function runDialog(call: () => Promise<unknown>, success: string, fallback: string, onDone?: () => void) {
    await exclusive(async () => {
      const { error } = await attempt(call);
      if (error) { notify(friendlyError(error, fallback), "error"); return; }
      setDialog(null);
      onDone?.();
      notify(success, "success");
      refresh();
    }, "dialog");
  }

  function submitDialog(values: Record<string, string>) {
    if (!dialog || dialog.kind === "session") return;
    if (dialog.kind === "status") {
      const { sessionId, memberId, status } = dialog;
      let minutesLate = 0;
      if (status === "tardy") {
        const minutes = parseMinutesLate(values.minutes ?? "");
        if (minutes === null) { notify("Enter a whole number of minutes, from 0 to 1440.", "error"); return; }
        minutesLate = minutes;
      }
      runDialog(() => setAttendanceStatus({ sessionId, memberId, status, note: values.note ?? "", minutesLate }), "Attendance updated", "The mark could not be saved.");
    } else if (dialog.kind === "review") {
      const { excuse, decision } = dialog;
      runDialog(() => reviewAttendanceExcuse({ excuseId: excuse.id, decision, note: values.note ?? "" }), `Absence form ${decision}`, "The form could not be reviewed.");
    } else if (dialog.kind === "remediation") {
      const { item } = dialog;
      runDialog(() => setAttendanceRemediation({ remediationId: item.id, status: "complete", assignment: values.assignment ?? item.assignment, dueAt: item.due_at, note: null }), "Remediation updated", "The follow-up could not be updated.");
    } else {
      const { memberId, status } = dialog;
      runDialog(() => setAttendanceEligibility({ termKey: summaryTerm, memberId, status, reason: values.reason ?? "" }), "Eligibility updated", "Eligibility could not be updated.");
    }
  }

  function confirmSession() {
    if (!dialog || dialog.kind !== "session") return;
    const { sessionId, action } = dialog;
    runDialog(
      () => action === "close" ? closeAttendanceSession(sessionId) : cancelAttendanceSession(sessionId),
      action === "close" ? "Attendance closed" : "Meeting canceled",
      action === "close" ? "Attendance could not be closed." : "The meeting could not be canceled.",
      clearLiveCode,
    );
  }

  return { dialog, setDialog, submitDialog, confirmSession };
}
