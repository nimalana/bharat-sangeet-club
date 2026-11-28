"use client";

import type { User } from "@supabase/supabase-js";
import { useCallback } from "react";
import { useToast } from "../../../components/ui/toast";
import { updateOwnContact } from "../../../lib/api/members";
import { useAsyncAction } from "../../../lib/hooks/use-async-action";

export type ProfileSaved = { ok: boolean; fullName: string };

/**
 * Saving a member's own contact details from the form of ProfileFields (the Members page, "My profile" in the account menu and the
 * "Complete your profile" step all save the same four columns the same way).
 *
 * `save(form)` reads the fields at once (before anything is awaited: a form is gone once an event has been handled), sends them, and says
 * so. A save that starts while another is running does nothing, so a double press sends ONE request, and `saving` is up for the button.
 * A failure keeps the form as it is: the person fixes the field and presses Save again (the toast stays on screen).
 */
export function useProfileSave(user: User) {
  const { notify } = useToast();
  const action = useAsyncAction(notify, { exclusive: true });
  const { run } = action;
  const save = useCallback(async (form: HTMLFormElement): Promise<ProfileSaved> => {
    const values = new FormData(form);
    const fullName = String(values.get("full_name") || "");
    const outcome = await run(
      () => updateOwnContact(user.id, { fullName, phone: String(values.get("phone") || ""), classYear: String(values.get("class_year") || ""), specialty: String(values.get("specialty") || "") }),
      { fallback: "Your contact information could not be saved. Try again.", success: "Your contact information was updated" },
    );
    return { ok: outcome.ok, fullName };
  }, [run, user.id]);
  return { saving: action.pending, save };
}
