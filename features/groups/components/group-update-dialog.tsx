"use client";

import type { FormEvent } from "react";
import { Button } from "../../../components/ui/button";
import { Dialog } from "../../../components/ui/dialog";
import { IconButton } from "../../../components/ui/icon-button";

/**
 * The form where a group's announcement is written: title, message and whether to pin it. A dialog (named by its heading, Escape and the
 * Close button close it); `saving` is the request on its way: the button waits, nothing closes the dialog, and what was typed stays when
 * the request fails (the screen closes it only after the update was posted).
 */
export function GroupUpdateDialog({ groupName, onClose, onSubmit, saving = false }: { groupName: string; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void; saving?: boolean }) {
  return <Dialog open onClose={onClose} dismissible={!saving} closeOnBackdrop={false} className="modal">
    <form onSubmit={onSubmit}><IconButton aria-label="Close" className="modal-close" onClick={onClose} disabled={saving}>×</IconButton><p className="eyebrow">{groupName.toUpperCase()}</p><h2>Post a group update</h2><label>Title<input name="title" required maxLength={140} /></label><label>Message<textarea name="body" required rows={5} /></label><label className="check-label"><input name="is_pinned" type="checkbox" /> Pin this update</label><Button type="submit" pending={saving}>Publish to {groupName}</Button></form>
  </Dialog>;
}
