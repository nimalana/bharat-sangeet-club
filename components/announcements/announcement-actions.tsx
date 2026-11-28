"use client";

import type { User } from "@supabase/supabase-js";
import { FormEvent, useState } from "react";
import type { Tables } from "../../lib/db";
import { friendlyError } from "../../lib/errors";
import { supabase } from "../../lib/supabase";
import type { Notify } from "../../lib/toast";
import { Button } from "../ui/button";
import { ConfirmDialog } from "../ui/confirm-dialog";
import { Dialog } from "../ui/dialog";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";

export type EditableAnnouncement = Pick<Tables<"announcements">, "id" | "title" | "body" | "is_pinned" | "subgroup_id">;
type GroupOption = Pick<Tables<"subgroups">, "id" | "name">;

// Create or edit an announcement. Row-level security allows executives and
// admins to write announcements; nobody else is shown this dialog.
export function AnnouncementEditor({ user, groups, announcement, lockedSubgroupId, onClose, onSaved, notify }: {
  user: User; groups: GroupOption[]; announcement?: EditableAnnouncement; lockedSubgroupId?: number;
  onClose: () => void; onSaved: () => void | Promise<void>; notify: Notify;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const lockedGroup = lockedSubgroupId ? groups.find((group) => group.id === lockedSubgroupId) : undefined;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || saving) return;
    const form = new FormData(event.currentTarget);
    const subgroupValue = lockedSubgroupId ? String(lockedSubgroupId) : String(form.get("subgroup_id") || "");
    const fields = {
      title: String(form.get("title") || "").trim(),
      body: String(form.get("body") || "").trim(),
      is_pinned: form.get("is_pinned") === "on",
      subgroup_id: subgroupValue ? Number(subgroupValue) : null,
    };
    setSaving(true); setError("");
    const result = announcement
      ? await supabase.from("announcements").update(fields).eq("id", announcement.id).select("id")
      : await supabase.from("announcements").insert({ ...fields, created_by: user.id }).select("id");
    setSaving(false);
    // An update that matches no row returns no error, so check that something was written.
    if (result.error || !result.data?.length) { setError(friendlyError(result.error, "This announcement could not be saved. It may have been deleted.")); return; }
    notify(announcement ? "Announcement updated" : "Announcement published");
    await onSaved();
    onClose();
  }

  return <Dialog open onClose={saving ? () => {} : onClose} className="max-w-[560px]">
    <form onSubmit={submit} className="grid gap-4">
      <h2 className="m-0 text-2xl">{announcement ? "Edit announcement" : "Post an announcement"}</h2>
      {lockedGroup ? <p className="m-0 text-xs text-[#70818c]">For {lockedGroup.name}</p> : <label htmlFor="announcement-audience" className="grid gap-1 text-xs font-semibold">Audience<select id="announcement-audience" name="subgroup_id" defaultValue={announcement?.subgroup_id ?? ""} className="h-11 border border-[var(--line)] bg-[var(--paper)] px-3 text-sm"><option value="">Whole club</option>{groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>}
      <label htmlFor="announcement-title" className="grid gap-1 text-xs font-semibold">Title<Input id="announcement-title" name="title" required maxLength={140} defaultValue={announcement?.title ?? ""} /></label>
      <label htmlFor="announcement-body" className="grid gap-1 text-xs font-semibold">Message<Textarea id="announcement-body" name="body" required rows={6} maxLength={5000} defaultValue={announcement?.body ?? ""} /></label>
      <label htmlFor="announcement-pinned" className="flex items-center gap-2 text-sm"><input id="announcement-pinned" name="is_pinned" type="checkbox" defaultChecked={announcement?.is_pinned ?? false} /> Pin to the top</label>
      {error && <p className="action-feedback error m-0" role="alert">{error}</p>}
      <div className="flex flex-wrap justify-end gap-2"><Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button><Button type="submit" disabled={saving}>{saving ? "Saving…" : announcement ? "Save changes" : "Publish"}</Button></div>
    </form>
  </Dialog>;
}

// Edit, pin and delete controls for one announcement.
export function AnnouncementActions({ user, groups, announcement, onChanged, notify }: {
  user: User; groups: GroupOption[]; announcement: EditableAnnouncement;
  onChanged: () => void | Promise<void>; notify: Notify;
}) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  async function togglePin() {
    if (!supabase || busy) return;
    setBusy(true);
    const { error } = await supabase.from("announcements").update({ is_pinned: !announcement.is_pinned }).eq("id", announcement.id);
    setBusy(false);
    if (error) { notify(friendlyError(error), "error"); return; }
    notify(announcement.is_pinned ? "Announcement unpinned" : "Announcement pinned");
    await onChanged();
  }

  async function remove() {
    if (!supabase || busy) return;
    setBusy(true);
    const { error } = await supabase.from("announcements").delete().eq("id", announcement.id);
    setBusy(false); setConfirming(false);
    if (error) { notify(friendlyError(error), "error"); return; }
    notify("Announcement deleted");
    await onChanged();
  }

  return <div className="flex flex-wrap gap-1">
    <Button size="sm" variant="ghost" onClick={() => setEditing(true)} aria-label={`Edit ${announcement.title}`}>Edit</Button>
    <Button size="sm" variant="ghost" onClick={togglePin} disabled={busy} aria-label={`${announcement.is_pinned ? "Unpin" : "Pin"} ${announcement.title}`}>{announcement.is_pinned ? "Unpin" : "Pin"}</Button>
    <Button size="sm" variant="ghost" className="!text-[#8b2832]" onClick={() => setConfirming(true)} aria-label={`Delete ${announcement.title}`}>Delete</Button>
    {editing && <AnnouncementEditor user={user} groups={groups} announcement={announcement} onClose={() => setEditing(false)} onSaved={onChanged} notify={notify} />}
    <ConfirmDialog open={confirming} title="Delete this announcement?" confirmLabel="Delete announcement" danger busy={busy} onConfirm={remove} onCancel={() => setConfirming(false)}>
      <p className="m-0">“{announcement.title}” will be removed for everyone. This cannot be undone.</p>
    </ConfirmDialog>
  </div>;
}
