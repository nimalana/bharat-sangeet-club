"use client";

import { useCallback, useRef, useState } from "react";
import { isSupabaseConfigured } from "../../../lib/api/auth";
import { deleteEvent } from "../../../lib/api/events";
import type { ClubEvent, ScopeFilter } from "../../../lib/db";
import { useAsyncAction } from "../../../lib/hooks/use-async-action";
import { useConfirm } from "../../../components/ui/confirm";
import { useToast } from "../../../components/ui/toast";

export type CalendarPageState = ReturnType<typeof useCalendarPage>;

/**
 * What the calendar page keeps between visits: the audience filter, whether the "add a date" form is open, which date is
 * being edited, and removing a date. The shell calls this (not the page) because the page is drawn only while it is open
 * and the person's filter must survive going to another page and back. (The month and the open date are in the address: calendar-view.tsx.)
 *
 * `remove` asks first (the shared confirmation, in a ConfirmProvider), then removes the date, says so, and answers true when it was removed.
 * A second press while one removal is asking or running does nothing, so one date is removed once.
 * `onChanged` reloads the shell's lists after a date was added, changed or removed.
 */
export function useCalendarPage({ onChanged }: { onChanged: () => void | Promise<void> }) {
  const { notify } = useToast();
  const { confirm } = useConfirm();
  const { run } = useAsyncAction(notify, { exclusive: true });
  const [scope, setScope] = useState<ScopeFilter>("all");
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<ClubEvent | null>(null);
  const asking = useRef(false);

  const remove = useCallback(async (eventId: number, title?: string): Promise<boolean> => {
    if (!isSupabaseConfigured() || asking.current) return false;
    asking.current = true;
    try {
      const yes = await confirm({
        title: "Remove this date from the calendar?",
        message: title ? `"${title}" disappears from the calendar for everyone. Nothing else is changed.` : "It disappears from the calendar for everyone. Nothing else is changed.",
        confirmLabel: "Remove date",
        tone: "destructive",
      });
      if (!yes) return false;
      const outcome = await run(async () => { const { error } = await deleteEvent(eventId); if (error) throw error; }, { fallback: "This date could not be removed. Try again.", success: "Calendar date removed" });
      if (outcome.ok) void onChanged();
      return outcome.ok;
    } finally {
      asking.current = false;
    }
  }, [confirm, run, onChanged]);

  return { scope, setScope, adding, setAdding, editing, setEditing, remove };
}
