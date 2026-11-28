"use client";

import type { User } from "@supabase/supabase-js";
import { useRef, type FormEvent } from "react";
import { Button } from "../../../components/ui/button";
import { Dialog } from "../../../components/ui/dialog";
import type { MemberProfile } from "../../../lib/db";
import { useProfileSave } from "../hooks/use-profile-save";
import { CONTACT_TITLE_ID, ContactForm } from "./contact-dialog";

/**
 * "Complete your profile": the step a new member sees once, after the first sign-in that opens the portal. The same fields and the same save as
 * "My profile" and the Members page; Skip for now (and Close, and Escape) close it without saving, and a failed save keeps it open and as typed.
 * `onSkip` records that the person has answered (the shell keeps it in this browser), `onSaved` gets the name that was saved.
 */
export function CompleteProfileDialog({ user, profile, onSkip, onSaved }: { user: User; profile: MemberProfile; onSkip: () => void; onSaved: (fullName: string) => void }) {
  const { saving, save } = useProfileSave(user);
  const firstField = useRef<HTMLInputElement>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const outcome = await save(form);
    if (outcome.ok) onSaved(outcome.fullName.trim());
  }

  return <Dialog open onClose={onSkip} labelledBy={CONTACT_TITLE_ID} dismissible={!saving} closeOnBackdrop={false} initialFocus={firstField} className="modal">
    <ContactForm ownProfile={profile} email={user.email || ""} saving={saving} onClose={onSkip} onSubmit={submit} nameRef={firstField}
      eyebrow="WELCOME TO THE CLUB" title="Complete your profile" intro="Tell the club how to reach you and what you sing or play. Only your name is needed, and you can change all of it later from your name in the top bar."
      actions={<Button variant="ghost" className="mt-2 w-full" onClick={onSkip} disabled={saving}>Skip for now</Button>} />
  </Dialog>;
}
