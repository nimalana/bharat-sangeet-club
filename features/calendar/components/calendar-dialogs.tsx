"use client";

import type { User } from "@supabase/supabase-js";
import { useToast } from "../../../components/ui/toast";
import type { Subgroup } from "../../../lib/portal-types";
import type { CalendarPageState } from "../hooks/use-calendar-page";
import { EventModal } from "./event-modal";

/**
 * The forms of the calendar: add a date, edit a date. The shell draws them outside the page (they cover it), so they
 * stay open when the page changes underneath them, as they always did.
 */
export function CalendarDialogs({ user, groups, calendar, onChanged }: { user: User; groups: Subgroup[]; calendar: Pick<CalendarPageState, "adding" | "setAdding" | "editing" | "setEditing">; onChanged: () => void | Promise<void> }) {
  const { notify } = useToast();
  const { adding, setAdding, editing, setEditing } = calendar;
  return (
    <>
      {adding && <EventModal user={user} groups={groups} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); void onChanged(); notify("Important date added"); }} />}
      {editing && <EventModal key={editing.id} editing={editing} user={user} groups={groups} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void onChanged(); notify("Calendar date updated"); }} />}
    </>
  );
}
