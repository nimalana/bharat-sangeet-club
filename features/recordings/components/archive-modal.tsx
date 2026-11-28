"use client";

import type { User } from "@supabase/supabase-js";
import { useRef, useState, type FormEvent } from "react";
import { attempt } from "../../../lib/api/attempt";
import { insertClubArchiveItem, removeClubArchiveFile, uploadClubArchiveFile } from "../../../lib/api/recordings";
import type { ArchiveVisibility } from "../../../lib/db";
import { friendlyError } from "../../../lib/errors";
import { useAsyncAction } from "../../../lib/hooks/use-async-action";
import { Dialog } from "../../../components/ui/dialog";
import { IconButton } from "../../../components/ui/icon-button";
import { useToast } from "../../../components/ui/toast";
import { UploadProgress, type UploadItem } from "../../../components/ui/upload-progress";

// Add a club recording: the details, the file and who may open it. The dialog stays open while the file goes up (nothing closes it
// then), shows how far it got, and keeps what was typed when the upload or the save fails, so Save again (or Retry) sends the same form.
export function ArchiveModal({ user, onClose, onSaved }: { user: User; onClose: () => void; onSaved: () => void }) {
  const { notify } = useToast();
  // exclusive: a second press that lands before the button has re-rendered as disabled sends nothing.
  const { pending: saving, run } = useAsyncAction(notify, { exclusive: true });
  const formRef = useRef<HTMLFormElement>(null);
  const [upload, setUpload] = useState<UploadItem | null>(null);

  async function store(form: FormData, file: File) {
    const title = String(form.get("title") || "");
    setUpload({ id: "archive-file", name: file.name, status: "uploading", loaded: 0, total: file.size });
    const uploaded = await attempt(() => uploadClubArchiveFile(user.id, file, ({ loaded, total }) => setUpload((row) => (row ? { ...row, status: "uploading", loaded, total } : row))));
    if (uploaded.error) {
      // The row says "Failed" with Retry; the sentence is the toast's (it stays until it is closed), so it is not on the screen twice.
      setUpload((row) => (row ? { ...row, status: "failed" } : row));
      notify(friendlyError(uploaded.error, "The file could not be uploaded."), "error");
      return;
    }
    const storagePath = uploaded.data;
    setUpload((row) => (row ? { ...row, status: "done" } : row));
    const access = String(form.get("visibility") || "members");
    const saved = await attempt(() => insertClubArchiveItem({ title, description: String(form.get("description") || ""), storagePath, visibility: (access === "public" ? "members" : access) as ArchiveVisibility, isPublic: access === "public", raga: String(form.get("raga") || "") || null, tala: String(form.get("tala") || "") || null, uploadedBy: user.id }));
    if (saved.error) {
      // The row was not saved, so the file just uploaded is an orphan: remove it, and say so if it stays.
      const leftover = await removeClubArchiveFile(storagePath, { refusedMessage: "The recording could not be saved, and its uploaded file could not be removed. Ask an administrator to delete it." });
      setUpload((row) => (row ? { ...row, status: "failed" } : row));
      notify(leftover ?? friendlyError(saved.error, "The recording could not be saved."), "error");
      return;
    }
    onSaved();
  }

  function send(element: HTMLFormElement) {
    const form = new FormData(element);
    const file = form.get("file") as File;
    if (!file?.size) { notify("Choose a file to upload"); return; }
    void run(() => store(form, file), { fallback: "The recording could not be saved." });
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    send(event.currentTarget);
  }

  // The form is still there with its values: Retry sends it again.
  const retry = () => { if (formRef.current) send(formRef.current); };

  // A form: a click beside it must not lose what was typed, and nothing closes it while the file is on its way.
  return <Dialog open onClose={onClose} className="modal" dismissible={!saving} closeOnBackdrop={false}>
    <form ref={formRef} onSubmit={submit}>
      <IconButton aria-label="Close" className="modal-close" onClick={onClose} disabled={saving}>×</IconButton>
      <p className="eyebrow">EXECUTIVE TOOL</p>
      <h2>Add a club recording</h2>
      <label>Title<input name="title" required placeholder="Give this recording a clear name" /></label>
      <label>Description<input name="description" placeholder="Optional context for members" /></label>
      <div className="form-pair"><label>Raga / raag<input name="raga" /></label><label>Tala / taal<input name="tala" /></label></div>
      <label>Choose file<input name="file" type="file" required accept="audio/*,video/*" /></label>
      <label>Who can access this?<select name="visibility"><option value="members">All club members</option><option value="executives">Executives only</option><option value="public">Everyone (public concert)</option></select></label>
      <UploadProgress items={upload ? [upload] : []} label="File being uploaded" onRetry={saving ? undefined : retry} />
      <button className="primary" type="submit" disabled={saving} aria-busy={saving || undefined}>{saving ? "Saving…" : "Save recording"}</button>
    </form>
  </Dialog>;
}
