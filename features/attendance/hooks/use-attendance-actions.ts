// What the attendance screen does when the person acts. One request at a time for anything that writes (a double click sends
// one); after a change the overview is read again and, when the Meetings tab shows a roster, that roster too.
//
// The flows live in their own hooks and share the single-flight guard and the "saving" flag defined here:
//   use-live-check-in.ts       member check-in; open, rotate and create (the live code and the form message)
//   use-attendance-dialogs.ts  the dialog that is open and the request behind it (a mark, a decision, a follow-up, close or cancel)
//   use-absence-form.ts        the member's absence form and the proof link
import type { User } from "@supabase/supabase-js";
import type { GroupOption } from "../../../lib/db";
import type { AttendanceTab } from "../model";
import { useAbsenceForm } from "./use-absence-form";
import { useAttendanceDialogs } from "./use-attendance-dialogs";
import { useExclusive } from "./use-exclusive";
import { useLiveCheckIn } from "./use-live-check-in";

export function useAttendanceActions({ user, groups, summaryTerm, load, rereadRoster, setTab }: {
  user: User;
  groups: GroupOption[];
  /** The term the eligibility marks are for (the overview's `summary_term`). */
  summaryTerm: string;
  load: (silent?: boolean) => Promise<void>;
  rereadRoster: () => void;
  setTab: (tab: AttendanceTab) => void;
}) {
  const { saving, exclusive } = useExclusive();

  // After anything changed on the server: read the overview again and, when the
  // Meetings tab shows a roster, that roster too. Closing or canceling check-in
  // and every mark go through here.
  function refresh() {
    load(true);
    rereadRoster();
  }

  const live = useLiveCheckIn({ groups, load, rereadRoster, setTab, exclusive });
  const dialogs = useAttendanceDialogs({ summaryTerm, exclusive, refresh, clearLiveCode: () => live.setLiveCode("") });
  const absence = useAbsenceForm({ user, load, exclusive });

  return {
    saving, refresh,
    checkInCode: live.checkInCode, setCheckInCode: live.setCheckInCode, liveCode: live.liveCode, feedback: live.feedback, checkIn: live.checkIn,
    openAttendance: live.openAttendance, rotateCode: live.rotateCode, resetLive: live.resetLive,
    showNewSession: live.showNewSession, setShowNewSession: live.setShowNewSession, createSession: live.createSession,
    dialog: dialogs.dialog, setDialog: dialogs.setDialog, submitDialog: dialogs.submitDialog, confirmSession: dialogs.confirmSession,
    showExcuse: absence.showExcuse, setShowExcuse: absence.setShowExcuse, submitExcuse: absence.submitExcuse, openProof: absence.openProof,
  };
}
