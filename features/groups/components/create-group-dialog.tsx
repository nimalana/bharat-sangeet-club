"use client";

import type { FormEvent } from "react";
import { Button } from "../../../components/ui/button";
import { Dialog } from "../../../components/ui/dialog";
import { IconButton } from "../../../components/ui/icon-button";

/**
 * The form where an executive creates a group: name, description and how people join. A dialog (named by its heading, Escape and the
 * Close button close it, focus goes back to the button that opened it); `saving` is the request on its way: the button waits, nothing
 * closes the dialog, and what was typed stays when the request fails (the screen closes it only after the group was created).
 */
export function CreateGroupDialog({ onClose, onSubmit, saving = false }: { onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void; saving?: boolean }) {
  return <Dialog open onClose={onClose} dismissible={!saving} closeOnBackdrop={false} className="modal">
    <form onSubmit={onSubmit}><IconButton aria-label="Close" className="modal-close" onClick={onClose} disabled={saving}>×</IconButton><p className="eyebrow">NEW GROUP</p><h2>Create a group</h2><label>Name<input name="name" required maxLength={80} placeholder="Hindustani Ensemble" /></label><label>Description<textarea name="description" rows={4} placeholder="What this group rehearses or performs" /></label><label>Enrollment<select name="enrollment_mode" defaultValue="approval"><option value="open">Open — anyone can join</option><option value="approval">Request approval</option><option value="invite">Invitation only</option></select></label><Button type="submit" pending={saving}>Create group</Button></form>
  </Dialog>;
}
