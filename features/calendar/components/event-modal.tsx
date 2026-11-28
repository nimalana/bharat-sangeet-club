"use client";

import type { User } from "@supabase/supabase-js";
import { FormEvent, useState } from "react";
import { isSupabaseConfigured } from "../../../lib/api/auth";
import { createEvent, updateEvent } from "../../../lib/api/events";
import { friendlyError } from "../../../lib/errors";
import type { ClubEvent, Subgroup } from "../../../lib/portal-types";
import type { Notify } from "../../../lib/toast";
import { Button } from "../../../components/ui/button";

export function EventModal({ user, groups, editing, onClose, onSaved, notify }: { user: User; groups: Subgroup[]; editing?: ClubEvent; onClose: () => void; onSaved: () => void; notify: Notify }) {
  const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!isSupabaseConfigured()) return; setSaving(true);
    const form = new FormData(event.currentTarget);
    const subgroupId = String(form.get("subgroup_id") || "");
    const fields = { title: String(form.get("title") || ""), description: String(form.get("description") || ""), starts_at: new Date(String(form.get("starts_at") || "")).toISOString(), location: String(form.get("location") || ""), subgroup_id: subgroupId ? Number(subgroupId) : null };
    const result = editing ? await updateEvent(editing.id, fields) : await createEvent(fields, user.id);
    setSaving(false);
    // An update that matches no row returns no error, so check that something was written.
    if (result.error || !result.data?.length) notify(friendlyError(result.error, "This date could not be saved. It may have been removed."), "error"); else onSaved();
  }
  return <div className="modal-backdrop" onMouseDown={onClose}><form className="modal" onMouseDown={(event) => event.stopPropagation()} onSubmit={submit}><button type="button" className="modal-close" onClick={onClose}>×</button><p className="eyebrow">EXECUTIVE TOOL</p><h2>{editing ? "Edit this date" : "Add an important date"}</h2><label>Audience<select name="subgroup_id" defaultValue={editing?.subgroup_id ?? ""}><option value="">Whole club</option>{groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label><label>Title<input name="title" required defaultValue={editing?.title ?? ""} placeholder="Concert, rehearsal, meeting…" /></label><label>Date and time<input name="starts_at" type="datetime-local" required defaultValue={editing ? toLocalInputValue(editing.starts_at) : undefined} /></label><label>Location<input name="location" defaultValue={editing?.location ?? ""} placeholder="Room, venue, or online" /></label><label>Details<input name="description" defaultValue={editing?.description ?? ""} placeholder="Anything members should know" /></label><Button type="submit" disabled={saving}>{saving ? "Saving…" : editing ? "Save changes" : "Add to calendar"}</Button></form></div>;
}

function toLocalInputValue(value: string) { const date = new Date(value); return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16); }
