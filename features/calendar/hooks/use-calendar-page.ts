"use client";

import { useState } from "react";
import { isSupabaseConfigured } from "../../../lib/api/auth";
import { deleteEvent } from "../../../lib/api/events";
import type { ClubEvent, ScopeFilter } from "../../../lib/db";
import { useToast } from "../../../components/ui/toast";

export type CalendarPageState = ReturnType<typeof useCalendarPage>;

/**
 * What the calendar page keeps between visits: the audience filter, whether the "add a date" form is open, which date is
 * being edited, and removing a date. The shell calls this (not the page) because the page is drawn only while it is open
 * and the person's filter must survive going to another page and back.
 *
 * `onChanged` reloads the shell's lists after a date was added, changed or removed.
 */
export function useCalendarPage({ onChanged }: { onChanged: () => void | Promise<void> }) {
  const { notify } = useToast();
  const [scope, setScope] = useState<ScopeFilter>("all");
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<ClubEvent | null>(null);

  async function remove(eventId: number) {
    if (!isSupabaseConfigured() || !window.confirm("Remove this date from the calendar?")) return;
    const { error } = await deleteEvent(eventId);
    if (error) notify(error.message, "error"); else { notify("Calendar date removed"); void onChanged(); }
  }

  return { scope, setScope, adding, setAdding, editing, setEditing, remove };
}
