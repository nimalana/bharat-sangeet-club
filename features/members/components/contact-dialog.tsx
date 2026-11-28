"use client";

import type { FormEvent } from "react";
import type { MemberProfile } from "../../../lib/db";

/** The form where a member edits their own contact details (name, phone, class year, voice or instrument). */
export function ContactDialog({ ownProfile, email, saving, onClose, onSubmit }: { ownProfile: MemberProfile | undefined; email: string; saving: boolean; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  return <div className="modal-backdrop" onMouseDown={onClose}><form className="modal" onSubmit={onSubmit} onMouseDown={(event) => event.stopPropagation()}><button type="button" className="modal-close" onClick={onClose}>×</button><p className="eyebrow">MY MEMBER PROFILE</p><h2>Contact information</h2><label>Preferred name<input name="full_name" required defaultValue={ownProfile?.full_name || ""} /></label><label>Email<input value={ownProfile?.email || email} disabled /></label><label>Phone number<input name="phone" type="tel" defaultValue={ownProfile?.phone || ""} placeholder="Optional" /></label><div className="form-pair"><label>Class year<input name="class_year" defaultValue={ownProfile?.class_year || ""} placeholder="2028" /></label><label>Voice / instrument<input name="specialty" defaultValue={ownProfile?.specialty || ""} placeholder="Vocal, violin, mridangam…" /></label></div><button className="primary" disabled={saving}>{saving ? "Saving…" : "Save profile"}</button></form></div>;
}
