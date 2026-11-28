"use client";

import type { FormEvent } from "react";
import { Button } from "../../../components/ui/button";

/** The form where an executive creates a group: name, description and how people join. */
export function CreateGroupDialog({ onClose, onSubmit }: { onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  return <div className="modal-backdrop" onMouseDown={onClose}><form className="modal" onSubmit={onSubmit} onMouseDown={(event) => event.stopPropagation()}><button type="button" className="modal-close" onClick={onClose}>×</button><p className="eyebrow">NEW GROUP</p><h2>Create a group</h2><label>Name<input name="name" required maxLength={80} placeholder="Hindustani Ensemble" /></label><label>Description<textarea name="description" rows={4} placeholder="What this group rehearses or performs" /></label><label>Enrollment<select name="enrollment_mode" defaultValue="approval"><option value="open">Open — anyone can join</option><option value="approval">Request approval</option><option value="invite">Invitation only</option></select></label><Button type="submit">Create group</Button></form></div>;
}
