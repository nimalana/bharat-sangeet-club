"use client";

import { useRef, type FormEvent, type ReactNode, type Ref } from "react";
import { Dialog } from "../../../components/ui/dialog";
import { IconButton } from "../../../components/ui/icon-button";
import type { MemberProfile } from "../../../lib/db";
import { ProfileFields } from "./profile-fields";

export const CONTACT_TITLE_ID = "contact-dialog-title";

/**
 * What every state of the contact dialog has: the Close button, the label above the heading, and the heading that names the dialog.
 * `eyebrow` and `title` are those two texts (the "Complete your profile" step says its own).
 */
export function ContactFrame({ onClose, closeDisabled = false, eyebrow = "MY MEMBER PROFILE", title = "Contact information", children }: { onClose: () => void; closeDisabled?: boolean; eyebrow?: string; title?: string; children: ReactNode }) {
  return <>
    <IconButton aria-label="Close" className="modal-close" onClick={onClose} disabled={closeDisabled}>×</IconButton>
    <p className="eyebrow">{eyebrow}</p>
    <h2 id={CONTACT_TITLE_ID}>{title}</h2>
    {children}
  </>;
}

type FormTexts = { eyebrow?: string; title?: string; /** A sentence under the heading. */ intro?: string; /** Buttons after Save profile (the step's Skip for now). */ actions?: ReactNode };

/** The form itself: the fields and the Save profile button, which is off and says Saving… while the save runs. */
export function ContactForm({ ownProfile, email, saving, onClose, onSubmit, nameRef, eyebrow, title, intro, actions }: { ownProfile: MemberProfile | undefined; email: string; saving: boolean; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void; nameRef?: Ref<HTMLInputElement> } & FormTexts) {
  return <form onSubmit={onSubmit}>
    <ContactFrame onClose={onClose} closeDisabled={saving} eyebrow={eyebrow} title={title}>
      {intro && <p className="profile-intro">{intro}</p>}
      <ProfileFields profile={ownProfile} email={email} nameRef={nameRef} />
      <button className="primary" disabled={saving} aria-busy={saving || undefined}>{saving ? "Saving…" : "Save profile"}</button>
      {actions}
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
