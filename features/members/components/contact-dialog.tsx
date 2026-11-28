"use client";

import { useRef, type FormEvent, type ReactNode, type Ref } from "react";
import { Dialog } from "../../../components/ui/dialog";
import { IconButton } from "../../../components/ui/icon-button";
import type { MemberProfile } from "../../../lib/db";
import { ProfileFields } from "./profile-fields";

export const CONTACT_TITLE_ID = "contact-dialog-title";

/** What every state of the contact dialog has: the Close button, the label above the heading, and the heading that names the dialog. */
export function ContactFrame({ onClose, closeDisabled = false, children }: { onClose: () => void; closeDisabled?: boolean; children: ReactNode }) {
  return <>
    <IconButton aria-label="Close" className="modal-close" onClick={onClose} disabled={closeDisabled}>×</IconButton>
    <p className="eyebrow">MY MEMBER PROFILE</p>
    <h2 id={CONTACT_TITLE_ID}>Contact information</h2>
    {children}
  </>;
}

/** The form itself: the fields and the Save profile button, which is off and says Saving… while the save runs. */
export function ContactForm({ ownProfile, email, saving, onClose, onSubmit, nameRef }: { ownProfile: MemberProfile | undefined; email: string; saving: boolean; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void; nameRef?: Ref<HTMLInputElement> }) {
  return <form onSubmit={onSubmit}>
    <ContactFrame onClose={onClose} closeDisabled={saving}>
      <ProfileFields profile={ownProfile} email={email} nameRef={nameRef} />
      <button className="primary" disabled={saving} aria-busy={saving || undefined}>{saving ? "Saving…" : "Save profile"}</button>
    </ContactFrame>
  </form>;
}

/**
 * The form where a member edits their own contact details (name, phone, class year, voice or instrument), in the portal's Dialog: named by its
 * heading, focus on the first field, Escape and Close close it, and while it saves nothing closes it (a failed save keeps it open and as typed).
 */
export function ContactDialog({ ownProfile, email, saving, onClose, onSubmit }: { ownProfile: MemberProfile | undefined; email: string; saving: boolean; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  const firstField = useRef<HTMLInputElement>(null);
  return <Dialog open onClose={onClose} labelledBy={CONTACT_TITLE_ID} dismissible={!saving} closeOnBackdrop={false} initialFocus={firstField} className="modal">
    <ContactForm ownProfile={ownProfile} email={email} saving={saving} onClose={onClose} onSubmit={onSubmit} nameRef={firstField} />
  </Dialog>;
}
