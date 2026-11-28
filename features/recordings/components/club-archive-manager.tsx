"use client";

import { useState, type FormEvent } from "react";
import { attempt } from "../../../lib/api/attempt";
import { createClubArchiveUrl, deleteClubArchiveItem, isInRecordingRoom, removeClubArchiveFile, updateClubArchiveItem } from "../../../lib/api/recordings";
import { SHARED_ACCESS_NOTICE, SHARED_DELETE_NOTICE, accessChangeBreaksPlayback, accessColumns, archiveAccess, loweringToExecutivesOnly, type ArchiveAccess } from "../../../lib/archive-sharing";
import type { ClubArchiveItem } from "../../../lib/db";
import { friendlyError } from "../../../lib/errors";
import { useAsyncAction } from "../../../lib/hooks/use-async-action";
import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import { ConfirmDialog } from "../../../components/ui/confirm-dialog";
import { Dialog } from "../../../components/ui/dialog";
import { Input } from "../../../components/ui/input";
import { PreviewDialog } from "../../../components/ui/preview-dialog";
import { Textarea } from "../../../components/ui/textarea";
import { useToast } from "../../../components/ui/toast";

const accessLabel: Record<ArchiveAccess, string> = { public: "Public concert page", members: "All club members", executives: "Executives only" };

// Club recordings (the older archive) still feed the public concert page.
// Executives manage them here: add, edit, change who can see them, delete.
export function ClubArchiveManager({ items, groups, onAdd, onChanged }: {
  items: ClubArchiveItem[]; groups: Array<{ id: number; name: string }>;
  onAdd: () => void; onChanged: () => void | Promise<void>;
}) {
  const { notify } = useToast();
  const [editing, setEditing] = useState<ClubArchiveItem | null>(null);
  const [deleting, setDeleting] = useState<ClubArchiveItem | null>(null);
  const [sharedDelete, setSharedDelete] = useState(false);
  const [editError, setEditError] = useState("");
  const [previewing, setPreviewing] = useState<ClubArchiveItem | null>(null);
  // One change at a time: a second press that lands before the buttons are disabled sends nothing.
  const { pending: busy, run } = useAsyncAction(notify, { exclusive: true });

  // The file is shown in a preview over this page (PreviewDialog; the signed link is made when it opens). A recording or a video plays,
  // a PDF or an image shows, any other file has a download link; "Open in a new tab" is in every preview. The type is read from the
  // file's extension (the archive row has no type of its own).
  const previewFile = async (item: ClubArchiveItem) => {
    const url = await createClubArchiveUrl(item.storage_path);
    if (!url) throw new Error("");
    return { url, mime: "", name: item.storage_path.split("/").pop()?.replace(/^[0-9a-f-]{36}-/, "") || item.title };
  };

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    const form = new FormData(event.currentTarget);
    void run(async () => {
      const text = (name: string) => String(form.get(name) || "").trim();
      const access = text("access") as ArchiveAccess;
      setEditError("");
      // A group's recording room plays this file with the access set here, so
      // lowering it to Executives only would break that copy. Checked only when it matters.
      if (loweringToExecutivesOnly(archiveAccess(editing), access)) {
        const room = await attempt(() => isInRecordingRoom(editing.storage_path));
        if (room.error) { setEditError(friendlyError(room.error, "The recording could not be checked.")); return; }
        if (accessChangeBreaksPlayback(archiveAccess(editing), access, room.data)) { setEditError(SHARED_ACCESS_NOTICE); return; }
      }
      const { data, error } = await attempt(() => updateClubArchiveItem(editing.id, {
        title: text("title"), description: text("description"), raga: text("raga") || null, tala: text("tala") || null,
        event_date: text("event_date") || null, ...accessColumns(access),
      }));
      if (error || !data?.length) { notify(friendlyError(error, "You do not have permission to edit this recording."), "error"); return; }
      setEditing(null); notify("Recording updated"); await onChanged();
    });
  }

  function remove() {
    if (!deleting) return Promise.resolve();
    return run(async () => {
      // A group recording copied into the recording room shares this file.
      const room = await attempt(() => isInRecordingRoom(deleting.storage_path));
      if (room.error) { notify(friendlyError(room.error, "The recording could not be checked."), "error"); return; }
      if (room.data) { setDeleting(null); setSharedDelete(true); return; }
      // File first: storage only allows the delete while the row exists. An empty answer from
      // storage is a refused delete, not a success (see lib/storage-remove.ts).
      const problem = await removeClubArchiveFile(deleting.storage_path, { confirmGone: true });
      if (problem) { notify(problem, "error"); return; }
      const { data, error } = await attempt(() => deleteClubArchiveItem(deleting.id));
      if (error || !data?.length) { notify(friendlyError(error, "The recording could not be deleted."), "error"); return; }
      setDeleting(null); notify("Recording deleted"); await onChanged();
    });
  }

  return <section className="section-shell page-section" aria-labelledby="club-archive-heading">
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div><p className="eyebrow">EXECUTIVE TOOL</p><h2 id="club-archive-heading" className="m-0">Club and concert recordings</h2><p className="m-0 mt-1 text-sm text-[#4c5f6b]">Recordings marked public appear on the public concert page.</p></div>
      <Button onClick={onAdd}>＋ Add club recording</Button>
    </div>
    {items.length ? <div className="grid gap-2">{items.map((item) => {
      const access = archiveAccess(item);
      const group = item.subgroup_id ? groups.find((entry) => entry.id === item.subgroup_id) : null;
      return <article key={item.id} className="flex flex-wrap items-center gap-3 border border-[var(--line)] bg-[var(--paper)] px-4 py-3">
        <div className="min-w-0 flex-1">
          <b className="block break-words">{item.title}</b>
          <small className="text-[#4c5f6b]">{[item.raga, item.tala, item.event_date, group?.name].filter(Boolean).join(" · ") || item.description || "No details added"}</small>
        </div>
        <Badge variant={access === "public" ? undefined : "muted"}>{accessLabel[access]}</Badge>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={() => setPreviewing(item)}>Open</Button>
          <Button variant="secondary" size="sm" onClick={() => { setEditError(""); setEditing(item); }}>Edit</Button>
          <Button variant="danger" size="sm" onClick={() => setDeleting(item)}>Delete</Button>
        </div>
      </article>;
    })}</div> : <p className="workspace-empty">No club recordings yet.</p>}

    {/* A form: a click beside it keeps what was typed, and nothing closes it while the change is saved. */}
    <Dialog open={Boolean(editing)} onClose={() => setEditing(null)} dismissible={!busy} closeOnBackdrop={false} className="max-w-[560px]">
      {editing && <>
        <h2 className="m-0 text-2xl">Edit club recording</h2>
        <form key={editing.id} className="mt-4 grid gap-3" onSubmit={save}>
          <label className="grid gap-1 text-sm font-semibold" htmlFor="archive-edit-title">Title<Input id="archive-edit-title" name="title" defaultValue={editing.title} required maxLength={160} /></label>
          <label className="grid gap-1 text-sm font-semibold" htmlFor="archive-edit-description">Description<Textarea id="archive-edit-description" name="description" defaultValue={editing.description} rows={3} /></label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-sm font-semibold" htmlFor="archive-edit-raga">Raga / raag<Input id="archive-edit-raga" name="raga" defaultValue={editing.raga || ""} /></label>
            <label className="grid gap-1 text-sm font-semibold" htmlFor="archive-edit-tala">Tala / taal<Input id="archive-edit-tala" name="tala" defaultValue={editing.tala || ""} /></label>
            <label className="grid gap-1 text-sm font-semibold" htmlFor="archive-edit-date">Concert date<Input id="archive-edit-date" name="event_date" type="date" defaultValue={editing.event_date || ""} /></label>
            <label className="grid gap-1 text-sm font-semibold" htmlFor="archive-edit-access">Who can access this?<select id="archive-edit-access" name="access" defaultValue={archiveAccess(editing)}><option value="members">All club members</option><option value="executives">Executives only</option><option value="public">Everyone (public concert)</option></select></label>
          </div>
          {editError && <p className="action-feedback error m-0" role="alert">{editError}</p>}
          <div className="mt-3 flex flex-wrap justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setEditing(null)} disabled={busy}>Cancel</Button>
            <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save changes"}</Button>
          </div>
        </form>
      </>}
    </Dialog>

    <Dialog open={sharedDelete} onClose={() => setSharedDelete(false)} className="max-w-[460px]">
      <h2 className="m-0 text-2xl">{SHARED_DELETE_NOTICE.title}</h2>
      <p className="mt-3 text-sm leading-relaxed text-[#4c5f6b]">{SHARED_DELETE_NOTICE.body}</p>
      <div className="mt-6 flex justify-end"><Button variant="secondary" onClick={() => setSharedDelete(false)}>Close</Button></div>
    </Dialog>

    <PreviewDialog open={previewing !== null} onClose={() => setPreviewing(null)} title={previewing?.title ?? ""} load={() => (previewing ? previewFile(previewing) : Promise.reject(new Error("")))} />

    <ConfirmDialog open={Boolean(deleting)} title="Delete this club recording?" confirmLabel="Delete recording" danger busy={busy} onConfirm={remove} onCancel={() => setDeleting(null)}>
      &ldquo;{deleting?.title}&rdquo; and its file will be permanently deleted{deleting?.is_public ? " and it will disappear from the public concert page" : ""}. This cannot be undone.
    </ConfirmDialog>
  </section>;
}
