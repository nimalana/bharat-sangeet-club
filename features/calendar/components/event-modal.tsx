"use client";

import type { User } from "@supabase/supabase-js";
import { useRef, type FormEvent } from "react";
import { Button } from "../../../components/ui/button";
import { Dialog } from "../../../components/ui/dialog";
import { IconButton } from "../../../components/ui/icon-button";
import { useToast } from "../../../components/ui/toast";
import { isSupabaseConfigured } from "../../../lib/api/auth";
import { createEvent, updateEvent } from "../../../lib/api/events";
import type { ClubEvent, Subgroup } from "../../../lib/db";
import { toLocalInputValue } from "../../../lib/format";
import { useAsyncAction } from "../../../lib/hooks/use-async-action";

const NOT_SAVED = "This date could not be saved. It may have been removed.";

/**
 * The form that adds a date or changes one, in the portal's Dialog: named by its heading, focus on the title, Escape and Close close it
 * (a click beside it does not, and nothing closes it while it saves), one request however often Save is pressed, and a refusal keeps it open
 * with what was typed and a message that stays.
 */
export function EventModal({ user, groups, editing, onClose, onSaved }: {
  user: User; groups: Subgroup[]; editing?: ClubEvent; onClose: () => void; onSaved: () => void;
}) {
  const { notify } = useToast();
  const save = useAsyncAction(notify, { exclusive: true });
  const titleField = useRef<HTMLInputElement>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isSupabaseConfigured()) return;
    const form = new FormData(event.currentTarget);
    const outcome = await save.run(async () => {
      const subgroupId = String(form.get("subgroup_id") || "");
      const fields = { title: String(form.get("title") || ""), description: String(form.get("description") || ""), starts_at: new Date(String(form.get("starts_at") || "")).toISOString(), location: String(form.get("location") || ""), subgroup_id: subgroupId ? Number(subgroupId) : null };
      const result = editing ? await updateEvent(editing.id, fields) : await createEvent(fields, user.id);
      if (result.error) throw result.error;
      // An update that matches no row returns no error, so check that something was written.
      if (!result.data?.length) throw new Error(NOT_SAVED);
    }, { fallback: NOT_SAVED });
    if (outcome.ok) onSaved();
  }

  return <Dialog open onClose={onClose} labelledBy="event-modal-title" dismissible={!save.pending} closeOnBackdrop={false} initialFocus={titleField} className="modal">
    <form onSubmit={submit}>
      <IconButton aria-label="Close" className="modal-close" onClick={onClose} disabled={save.pending}>×</IconButton>
      <p className="eyebrow">EXECUTIVE TOOL</p>
      <h2 id="event-modal-title">{editing ? "Edit this date" : "Add an important date"}</h2>
      <label>Audience<select name="subgroup_id" defaultValue={editing?.subgroup_id ?? ""}><option value="">Whole club</option>{groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>
      <label>Title<input ref={titleField} name="title" required defaultValue={editing?.title ?? ""} placeholder="Concert, rehearsal, meeting…" /></label>
      <label>Date and time<input name="starts_at" type="datetime-local" required defaultValue={editing ? toLocalInputValue(editing.starts_at) : undefined} /></label>
      <label>Location<input name="location" defaultValue={editing?.location ?? ""} placeholder="Room, venue, or online" /></label>
      <label>Details<input name="description" defaultValue={editing?.description ?? ""} placeholder="Anything members should know" /></label>
      <Button type="submit" pending={save.pending}>{save.pending ? "Saving…" : editing ? "Save changes" : "Add to calendar"}</Button>
    </form>
  </Dialog>;
}
