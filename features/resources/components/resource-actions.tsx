"use client";

import { useState, type FormEvent } from "react";
import { deleteResource, removeResourceFile, resourcesAvailable, setResourceArchived, setResourcePinned, setResourceVisibility, updateResourceDetails } from "../../../lib/api/resources";
import type { Tables } from "../../../lib/db";
import { ApiError } from "../../../lib/errors";
import { useAsyncAction } from "../../../lib/hooks/use-async-action";
import type { Notify } from "../../../lib/toast";
import { Button } from "../../../components/ui/button";
import { ConfirmDialog } from "../../../components/ui/confirm-dialog";
import { Dialog } from "../../../components/ui/dialog";
import { Input } from "../../../components/ui/input";
import { Textarea } from "../../../components/ui/textarea";

export type ManagedResource = Pick<Tables<"resources">, "id" | "node_kind" | "title" | "description" | "parent_id" | "visibility"
  | "storage_bucket" | "storage_path" | "external_url" | "status" | "is_pinned">;

type Pending = "edit" | "visibility" | "archive" | "restore" | "delete" | null;

// A write that matched no row is not an error for the database, but nothing was written: it is shown as a refusal. The empty
// message makes friendlyError answer with the action's own fallback sentence.
function requireRows(rows: unknown[]) {
  if (!rows.length) throw new ApiError("");
}

// Everything a manager can do to one library item. `canManage` mirrors the
// database rule (executives, or a group's leaders and managers for that
// group's member-visible items); the database enforces it either way.
export function ResourceActions({ item, canManage, isExecutive, childCount, notify, onChanged, onRemoved }: {
  item: ManagedResource; canManage: boolean; isExecutive: boolean; childCount: number;
  notify: Notify; onChanged: () => void | Promise<void>; onRemoved: () => void | Promise<void>;
}) {
  const [pending, setPending] = useState<Pending>(null);
  const { pending: busy, run } = useAsyncAction(notify);
  if (!canManage) return null;
  const noun = item.node_kind === "folder" ? "folder" : item.node_kind === "link" ? "link" : "file";
  const unfinished = item.status === "failed" || item.status === "pending_upload";
  const nextVisibility = item.visibility === "members" ? "executives" : "members";

  async function saveEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!resourcesAvailable()) return;
    const form = new FormData(event.currentTarget);
    const details: { title: string; description: string; external_url?: string } = { title: String(form.get("title") || "").trim(), description: String(form.get("description") || "").trim() };
    if (item.node_kind === "link") {
      const raw = String(form.get("external_url") || "").trim();
      const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
      try { new URL(url); } catch { notify("Enter a complete web address."); return; }
      details.external_url = url;
    }
    const done = await run(async () => requireRows(await updateResourceDetails(item.id, details)), { fallback: "You do not have permission to edit this resource.", success: "Resource updated" });
    if (!done.ok) return;
    setPending(null); await onChanged();
  }

  async function togglePin() {
    if (!resourcesAvailable()) return;
    const done = await run(async () => requireRows(await setResourcePinned(item.id, !item.is_pinned)), { fallback: "You do not have permission to pin this resource.", success: item.is_pinned ? "Unpinned" : "Pinned to the top" });
    if (done.ok) await onChanged();
  }

  async function changeVisibility() {
    if (!resourcesAvailable()) return;
    const done = await run(() => setResourceVisibility(item.id, nextVisibility), { fallback: "Visibility could not be changed.", success: nextVisibility === "executives" ? "Now visible to executives only" : "Now visible to members" });
    if (!done.ok) return;
    setPending(null); await onChanged();
  }

  async function setArchived(archived: boolean) {
    if (!resourcesAvailable()) return;
    const done = await run(() => setResourceArchived(item.id, archived), { fallback: "That change could not be saved.", success: archived ? `The ${noun} was archived` : `The ${noun} was restored` });
    if (!done.ok) return;
    setPending(null); await onRemoved();
  }

  async function deleteForGood() {
    if (!resourcesAvailable()) return;
    const done = await run(async () => {
      if (item.node_kind === "file" && item.storage_path) {
        // File first: storage only allows the delete while the row exists.
        const bucket = item.storage_bucket || "club-resources";
        // An empty answer from storage is a refused delete, not a success (see lib/storage-remove.ts).
        const problem = await removeResourceFile(bucket, item.storage_path);
        if (problem) return problem;
      }
      requireRows(await deleteResource(item.id));
      return null;
    }, { fallback: `The ${noun} could not be deleted.` });
    if (!done.ok) return;
    if (done.value) { notify(done.value, "error"); return; }
    setPending(null); notify(unfinished ? "Upload discarded" : `The ${noun} was deleted`); await onRemoved();
  }

  const canDelete = unfinished || (isExecutive && (item.node_kind !== "folder" || childCount === 0));

  return <div className="mt-5 border-t border-[var(--line)] pt-4">
    <p className="m-0 mb-2 text-xs uppercase tracking-wide text-[#4c5f6b]">Manage this {noun}</p>
    <div className="flex flex-wrap gap-2">
      {unfinished ? <Button variant="danger" size="sm" disabled={busy} onClick={() => setPending("delete")}>Discard upload</Button> : <>
        <Button variant="secondary" size="sm" disabled={busy} onClick={() => setPending("edit")}>{item.node_kind === "folder" ? "Rename" : "Edit"}</Button>
        {item.status === "ready" && <Button variant="secondary" size="sm" disabled={busy} onClick={() => void togglePin()}>{item.is_pinned ? "Unpin" : "Pin"}</Button>}
        {isExecutive && item.parent_id === null && item.status === "ready" && <Button variant="secondary" size="sm" disabled={busy} onClick={() => setPending("visibility")}>{item.visibility === "members" ? "Limit to executives" : "Share with members"}</Button>}
        {item.status === "archived"
          ? <Button variant="secondary" size="sm" disabled={busy} onClick={() => setPending("restore")}>Restore</Button>
          : <Button variant="secondary" size="sm" disabled={busy} onClick={() => setPending("archive")}>Archive</Button>}
        {canDelete && <Button variant="danger" size="sm" disabled={busy} onClick={() => setPending("delete")}>Delete</Button>}
      </>}
    </div>
    {isExecutive && item.parent_id !== null && !unfinished && <p className="m-0 mt-2 text-xs text-[#4c5f6b]">Visibility follows the top-level folder this {noun} is in.</p>}
    {isExecutive && item.node_kind === "folder" && childCount > 0 && <p className="m-0 mt-2 text-xs text-[#4c5f6b]">Only empty folders can be deleted. Archive hides the folder and everything in it.</p>}

    <Dialog open={pending === "edit"} onClose={busy ? () => {} : () => setPending(null)} className="max-w-[520px]">
      <h2 className="m-0 text-2xl">{item.node_kind === "folder" ? "Rename folder" : `Edit ${noun}`}</h2>
      <form className="mt-4 grid gap-3" onSubmit={saveEdit}>
        <label className="grid gap-1 text-sm font-semibold" htmlFor="resource-edit-title">Name<Input id="resource-edit-title" name="title" defaultValue={item.title} required maxLength={160} /></label>
        {item.node_kind === "link" && <label className="grid gap-1 text-sm font-semibold" htmlFor="resource-edit-url">Web address<Input id="resource-edit-url" name="external_url" defaultValue={item.external_url || ""} required inputMode="url" maxLength={2048} /></label>}
        <label className="grid gap-1 text-sm font-semibold" htmlFor="resource-edit-description">Description<Textarea id="resource-edit-description" name="description" defaultValue={item.description || ""} rows={3} maxLength={1000} /></label>
        <div className="mt-3 flex flex-wrap justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => setPending(null)} disabled={busy}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save changes"}</Button>
        </div>
      </form>
    </Dialog>

    <ConfirmDialog open={pending === "visibility"} title={nextVisibility === "executives" ? "Limit to executives only?" : "Share with members?"} confirmLabel={nextVisibility === "executives" ? "Limit to executives" : "Share with members"} busy={busy} onConfirm={changeVisibility} onCancel={() => setPending(null)}>
      {nextVisibility === "executives" ? "Members will no longer see" : "Members will be able to see"} this {noun}{item.node_kind === "folder" && childCount > 0 ? " and everything inside it" : ""}.
    </ConfirmDialog>
    <ConfirmDialog open={pending === "archive"} title={`Archive this ${noun}?`} confirmLabel="Archive" busy={busy} onConfirm={() => setArchived(true)} onCancel={() => setPending(null)}>
      It is hidden from members{item.node_kind === "folder" && childCount > 0 ? ", along with everything inside it" : ""}. Nothing is deleted, and you can restore it from Show archived.
    </ConfirmDialog>
    <ConfirmDialog open={pending === "restore"} title={`Restore this ${noun}?`} confirmLabel="Restore" busy={busy} onConfirm={() => setArchived(false)} onCancel={() => setPending(null)}>
      It becomes visible again to everyone who could see it before.
    </ConfirmDialog>
    <ConfirmDialog open={pending === "delete"} title={unfinished ? "Discard this upload?" : `Delete this ${noun} for good?`} confirmLabel={unfinished ? "Discard" : "Delete"} danger busy={busy} onConfirm={deleteForGood} onCancel={() => setPending(null)}>
      {unfinished ? "The unfinished upload is removed from the library." : <>&ldquo;{item.title}&rdquo; will be permanently deleted. This cannot be undone. Archive it instead if you might want it back.</>}
    </ConfirmDialog>
  </div>;
}
