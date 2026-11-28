// The live check-in flow: a member types the code; an executive creates a meeting, opens check-in, and rotates the code. The
// code is shown only on the device that opened or rotated it (the database stores no readable copy), and the form message
// says what the last check-in or opening answered.
import { useState, type FormEvent } from "react";
import { attempt } from "../../../lib/api/attempt";
import { checkInAttendance, createAttendanceSession, openAttendanceSession, rotateAttendanceCode } from "../../../lib/api/attendance";
import { friendlyError } from "../../../lib/errors";
import { useToast } from "../../../components/ui/toast";
import type { GroupOption } from "../../../lib/db";
import type { AttendanceTab } from "../model";
import type { Exclusive } from "./use-exclusive";

export function useLiveCheckIn({ groups, load, rereadRoster, setTab, exclusive }: {
  groups: GroupOption[];
  load: (silent?: boolean) => Promise<void>;
  rereadRoster: () => void;
  setTab: (tab: AttendanceTab) => void;
  exclusive: Exclusive;
}) {
  const { notify } = useToast();
  const [showNewSession, setShowNewSession] = useState(false);
  const [checkInCode, setCheckInCode] = useState("");
  const [liveCode, setLiveCode] = useState("");
  const [feedback, setFeedback] = useState("");

  async function checkIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await exclusive(async () => {
      setFeedback("");
      const { error } = await attempt(() => checkInAttendance(checkInCode.replace(/\s/g, "").toUpperCase()));
      if (error) setFeedback(error.message);
      else { setFeedback("You are checked in. Your attendance is confirmed."); setCheckInCode(""); notify("Attendance confirmed"); load(); }
    });
  }

  // Opens check-in for a meeting; returns whether it opened.
  async function openCheckIn(sessionId: number, duration: number) {
    setFeedback("");
    const { data: opened, error } = await attempt(() => openAttendanceSession(sessionId, duration));
    if (error) {
      const message = `Could not open check-in: ${error.message}`;
      setFeedback(message);
      notify(message, "error");
      return;
    }
    const result = Array.isArray(opened) ? opened[0] : opened;
    // `code` is not a column the function returns (none of the migrations ever returned it): an old fallback that never fires. The cast keeps it.
    const code = result?.check_in_code || (result as { code?: string } | undefined)?.code || "";
    if (!code) {
      const message = "Check-in opened, but no sign-in code was returned. Refresh and try again.";
      setFeedback(message);
      notify(message, "error");
      rereadRoster();
      await load();
      return;
    }
    setLiveCode(code);
    setTab("meetings");
    // Opening adds every participant to the meeting. If it is on screen as a
    // draft its roster is empty and nothing else would refresh it.
    rereadRoster();
    notify("Check-in is open");
    await load();
  }

  async function createSession(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await exclusive(async () => {
      const audience = String(form.get("audience") || "club");
      const subgroupId = audience.startsWith("subgroup:") ? Number(audience.slice("subgroup:".length)) : null;
      const groupName = groups.find((group) => group.id === subgroupId)?.name;
      const { data: created, error } = await attempt(() => createAttendanceSession({
        scope: subgroupId === null ? "club" : "subgroup",
        subgroupId,
        title: subgroupId === null ? "General Body Meeting" : `${groupName || "Subgroup"} rehearsal`,
        startsAt: new Date(String(form.get("starts_at"))).toISOString(),
      }));
      if (error) { notify(friendlyError(error, "The meeting could not be created."), "error"); return; }
      const session = Array.isArray(created) ? created[0] : created;
      if (form.get("open_now") === "on" && session?.id) await openCheckIn(session.id, Number(form.get("duration") || 60));
      setShowNewSession(false);
      notify("Meeting created");
      load();
    });
  }

  async function openAttendance(sessionId: number) {
    await exclusive(() => openCheckIn(sessionId, 60));
  }

  async function rotateCode(sessionId: number) {
    await exclusive(async () => {
      const { data: rotated, error } = await attempt(() => rotateAttendanceCode(sessionId));
      if (error) notify(friendlyError(error, "The code could not be changed."), "error");
      else { const result = Array.isArray(rotated) ? rotated[0] : rotated; setLiveCode(result?.check_in_code || /* `code` is never returned: see openCheckIn */ (result as { code?: string } | undefined)?.code || ""); notify("A new code is active"); load(); }
    });
  }

  // A new audience or term forgets the code and the message of the one before.
  function resetLive() {
    setLiveCode("");
    setFeedback("");
  }

  return { showNewSession, setShowNewSession, checkInCode, setCheckInCode, liveCode, setLiveCode, feedback, checkIn, openAttendance, createSession, rotateCode, resetLive };
}
