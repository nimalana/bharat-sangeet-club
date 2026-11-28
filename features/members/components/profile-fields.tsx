"use client";

import type { Ref } from "react";
import type { MemberProfile } from "../../../lib/db";

/**
 * The fields of a member's own contact details: preferred name, email (shown, never changed here), phone, class year, voice or
 * instrument. They are uncontrolled (`defaultValue`), so what was typed stays through a failed save as long as the form stays mounted.
 * The form's owner reads them with FormData (names: full_name, phone, class_year, specialty) and saves with useProfileSave.
 * `nameRef` is the first field, for the dialog that wants the focus there when it opens.
 */
export function ProfileFields({ profile, email, nameRef }: { profile: MemberProfile | null | undefined; email: string; nameRef?: Ref<HTMLInputElement> }) {
  return <>
    <label>Preferred name<input ref={nameRef} name="full_name" required autoComplete="name" defaultValue={profile?.full_name || ""} /></label>
    <label>Email<input value={profile?.email || email} disabled autoComplete="email" /></label>
    <label>Phone number<input name="phone" type="tel" autoComplete="tel" defaultValue={profile?.phone || ""} placeholder="Optional" /></label>
    <div className="form-pair"><label>Class year<input name="class_year" defaultValue={profile?.class_year || ""} placeholder="2028" /></label><label>Voice / instrument<input name="specialty" defaultValue={profile?.specialty || ""} placeholder="Vocal, violin, mridangam…" /></label></div>
  </>;
}
