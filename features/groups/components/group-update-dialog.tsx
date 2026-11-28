"use client";

import type { FormEvent } from "react";
import { Button } from "../../../components/ui/button";

/** The form where a group's announcement is written: title, message and whether to pin it. */
export function GroupUpdateDialog({ groupName, onClose, onSubmit }: { groupName: string; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  return <div className="modal-backdrop" onMouseDown={onClose}><form className="modal" onSubmit={onSubmit} onMouseDown={(event) => event.stopPropagation()}><button type="button" className="modal-close" onClick={onClose}>×</button><p className="eyebrow">{groupName.toUpperCase()}</p><h2>Post a group update</h2><label>Title<input name="title" required maxLength={140} /></label><label>Message<textarea name="body" required rows={5} /></label><label className="check-label"><input name="is_pinned" type="checkbox" /> Pin this update</label><Button type="submit">Publish to {groupName}</Button></form></div>;
}
