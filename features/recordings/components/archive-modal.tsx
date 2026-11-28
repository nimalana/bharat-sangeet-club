"use client";

import type { User } from "@supabase/supabase-js";
import { FormEvent, useState } from "react";
import { attempt } from "../../../lib/api/attempt";
import { insertClubArchiveItem, removeClubArchiveFile, uploadClubArchiveFile } from "../../../lib/api/recordings";
import type { ArchiveVisibility } from "../../../lib/db";
import { friendlyError } from "../../../lib/errors";
import { useToast } from "../../../components/ui/toast";

export function ArchiveModal({ user, onClose, onSaved }: { user: User; onClose: () => void; onSaved: () => void }) {
  const { notify } = useToast();
  const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true);
    const form = new FormData(event.currentTarget); const title = String(form.get("title") || "");
    const file = form.get("file") as File; if (!file?.size) { setSaving(false); notify("Choose a file to upload"); return; }
    const upload = await attempt(() => uploadClubArchiveFile(user.id, file));
    if (upload.error) { setSaving(false); notify(friendlyError(upload.error, "The file could not be uploaded."), "error"); return; }
    const storagePath = upload.data;
    const access = String(form.get("visibility") || "members");
    const saved = await attempt(() => insertClubArchiveItem({ title, description: String(form.get("description") || ""), storagePath, visibility: (access === "public" ? "members" : access) as ArchiveVisibility, isPublic: access === "public", raga: String(form.get("raga") || "") || null, tala: String(form.get("tala") || "") || null, uploadedBy: user.id }));
    if (saved.error) {
      // The row was not saved, so the file just uploaded is an orphan: remove it, and say so if it stays.
      const leftover = await removeClubArchiveFile(storagePath, { refusedMessage: "The recording could not be saved, and its uploaded file could not be removed. Ask an administrator to delete it." });
      setSaving(false); notify(leftover ?? friendlyError(saved.error, "The recording could not be saved."), "error"); return;
    }
    setSaving(false); onSaved();
  }
  return <div className="modal-backdrop" onMouseDown={onClose}><form className="modal" onMouseDown={(e) => e.stopPropagation()} onSubmit={submit}><button type="button" className="modal-close" onClick={onClose}>×</button><p className="eyebrow">EXECUTIVE TOOL</p><h2>Add a club recording</h2><label>Title<input name="title" required placeholder="Give this recording a clear name" /></label><label>Description<input name="description" placeholder="Optional context for members" /></label><div className="form-pair"><label>Raga / raag<input name="raga" /></label><label>Tala / taal<input name="tala" /></label></div><label>Choose file<input name="file" type="file" required accept="audio/*,video/*" /></label><label>Who can access this?<select name="visibility"><option value="members">All club members</option><option value="executives">Executives only</option><option value="public">Everyone (public concert)</option></select></label><button className="primary" disabled={saving}>{saving ? "Saving…" : "Save recording"}</button></form></div>;
}
