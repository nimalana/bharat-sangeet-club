"use client";

import type { User } from "@supabase/supabase-js";
import { useEffect, useRef, type FormEvent } from "react";
import { Dialog } from "../../../components/ui/dialog";
import { ErrorBlock } from "../../../components/ui/error-block";
import { SkeletonRows } from "../../../components/ui/skeleton";
import { useOwnProfile } from "../hooks/use-own-profile";
import { useProfileSave } from "../hooks/use-profile-save";
import { CONTACT_TITLE_ID, ContactForm, ContactFrame } from "./contact-dialog";

/**
 * "My profile" of the account menu: the same form as "Edit my contact info" on the Members page, opened from anywhere. It reads the person's own
 * row when it opens (a placeholder of the form's height until it answers, an error with Try again if it cannot), saves it, and tells the
 * shell the name that was saved so the top bar shows it. One Dialog for all three states, so focus returns to the account menu's button
 * when it closes whatever state it was in.
 */
export function OwnProfileDialog({ user, onClose, onSaved }: { user: User; onClose: () => void; onSaved?: (fullName: string) => void }) {
  const own = useOwnProfile(user);
  const { saving, save } = useProfileSave(user);
  const firstField = useRef<HTMLInputElement>(null);
  const ready = !own.loading && !own.failed;

  // The form appears after the dialog opened (focus is on Close by then): move it to the first field, as the same form does when it opens at once.
  useEffect(() => { if (ready) firstField.current?.focus(); }, [ready]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const outcome = await save(form);
    if (!outcome.ok) return;
    onSaved?.(outcome.fullName.trim());
    onClose();
  }

  return <Dialog open onClose={onClose} labelledBy={CONTACT_TITLE_ID} dismissible={!saving} closeOnBackdrop={false} className="modal">
    {ready
      ? <ContactForm ownProfile={own.profile ?? undefined} email={user.email || ""} saving={saving} onClose={onClose} onSubmit={submit} nameRef={firstField} />
      : <ContactFrame onClose={onClose}>
        {own.failed ? <ErrorBlock message="Your profile could not be loaded." onRetry={own.retry} role="alert" /> : <SkeletonRows rows={5} label="Loading your profile" />}
      </ContactFrame>}
  </Dialog>;
}
