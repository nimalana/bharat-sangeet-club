"use client";

import { useState } from "react";
import { Button } from "../../../components/ui/button";
import { ConfirmDialog } from "../../../components/ui/confirm-dialog";
import { Dialog } from "../../../components/ui/dialog";
import { Textarea } from "../../../components/ui/textarea";
import { useToast } from "../../../components/ui/toast";
import { deactivateMember, deleteMember, reactivateMember } from "../../../lib/api/admin";
import { useAsyncAction } from "../../../lib/hooks/use-async-action";

export type AccessMember = { id: string; full_name: string; email: string; status?: "active" | "deactivated" };

export const adminActionLabels: Record<string, string> = {
  role_changed: "Permission changed",
  member_updated: "Member updated",
  member_deleted: "Member deleted",
  member_deactivated: "Member deactivated",
  member_reactivated: "Member reactivated",
  signup_approved: "Sign-up approved",
  signup_declined: "Sign-up declined",
};

// Deactivate is the normal way to remove someone: it keeps their finance,
// attendance and recording history. Delete is only offered for a deactivated
// account and only succeeds when the account has no such history.
export function MemberAccessActions({ member, isSelf, onChanged }: {
  member: AccessMember; isSelf: boolean; onChanged: () => void | Promise<void>;
}) {
  const { notify } = useToast();
  const [dialog, setDialog] = useState<"deactivate" | "reactivate" | "delete" | null>(null);
  const [reason, setReason] = useState("");
  // One change at a time: a second press before the buttons have re-rendered sends nothing.
  const { pending: busy, run: track } = useAsyncAction(notify, { exclusive: true });
  const label = member.full_name || member.email;
  const deactivated = member.status === "deactivated";

  async function run(action: "deactivate" | "reactivate" | "delete") {
    const done = await track(() => action === "deactivate"
      ? deactivateMember(member.id, reason.trim())
      : action === "reactivate"
        ? reactivateMember(member.id)
        : deleteMember(member.id), { fallback: "That change could not be saved." });
    // A failure leaves the question open, with the reason as typed; the toast says why. A press that was skipped (one is running) does nothing.
    if (!done.ok) return;
    setDialog(null); setReason("");
    notify(action === "deactivate" ? `${label} was deactivated` : action === "reactivate" ? `${label} was reactivated` : `${label} was deleted`);
    await onChanged();
  }

  return <>
    {deactivated
      ? <><Button variant="secondary" size="sm" onClick={() => setDialog("reactivate")}>Reactivate</Button><Button variant="danger" size="sm" onClick={() => setDialog("delete")}>Delete</Button></>
      : <Button variant="danger" size="sm" disabled={isSelf} title={isSelf ? "You cannot deactivate your own account" : undefined} onClick={() => setDialog("deactivate")}>Deactivate</Button>}

    <Dialog open={dialog === "deactivate"} onClose={() => setDialog(null)} dismissible={!busy} closeOnBackdrop={false} className="max-w-[480px]">
      <h2 className="m-0 text-2xl">Deactivate {label}?</h2>
      <p className="mt-3 text-sm leading-relaxed text-[#4c5f6b]">They lose access to the portal right away and are removed from their groups. Their reimbursements, attendance and recordings are kept, and you can reactivate the account later.</p>
      <label htmlFor="deactivate-reason" className="mt-4 block text-sm font-semibold">Reason (optional, visible to administrators)</label>
      <Textarea id="deactivate-reason" className="mt-1" rows={3} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Graduated, left the club…" />
      <div className="mt-6 flex flex-wrap justify-end gap-2">
        <Button variant="secondary" onClick={() => setDialog(null)} disabled={busy}>Cancel</Button>
        <Button variant="danger" onClick={() => run("deactivate")} pending={busy}>{busy ? "Working…" : "Deactivate"}</Button>
      </div>
    </Dialog>

    <ConfirmDialog open={dialog === "reactivate"} title={`Reactivate ${label}?`} confirmLabel="Reactivate" busy={busy} onConfirm={() => run("reactivate")} onCancel={() => setDialog(null)}>
      They can sign in and use the portal again. Group memberships are not restored automatically, so add them back to their groups afterwards.
    </ConfirmDialog>

    <ConfirmDialog open={dialog === "delete"} title={`Permanently delete ${label}?`} confirmLabel="Delete account" danger busy={busy} onConfirm={() => run("delete")} onCancel={() => setDialog(null)}>
      This removes the login, group memberships and attendance for good and cannot be undone. Accounts with finance or recording history cannot be deleted and stay deactivated instead.
    </ConfirmDialog>
  </>;
}

export function DeactivatedScreen({ onSignOut }: { onSignOut: () => void }) {
  return <main className="loading-screen">
    <img className="brand-mark" src="/unc-bharat-sangeet-logo.jpg" alt="Bharat Sangeet" />
    <h2>Your access has been deactivated</h2>
    <p>This account can no longer open the member portal. If you think this is a mistake, contact a club administrator.</p>
    <Button variant="secondary" onClick={onSignOut}>Sign out</Button>
  </main>;
}
