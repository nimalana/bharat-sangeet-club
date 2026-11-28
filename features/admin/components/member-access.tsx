"use client";

import { useState } from "react";
import { Button } from "../../../components/ui/button";
import { ConfirmDialog } from "../../../components/ui/confirm-dialog";
import { Dialog } from "../../../components/ui/dialog";
import { Textarea } from "../../../components/ui/textarea";
import { useToast } from "../../../components/ui/toast";
import { deactivateMember, deleteMember, reactivateMember } from "../../../lib/api/admin";
import { useAsyncAction } from "../../../lib/hooks/use-async-action";
import type { Notify } from "../../../lib/toast";

export type AccessMember = { id: string; full_name: string; email: string; status?: "active" | "deactivated" };

export const adminActionLabels: Record<string, string> = {
  role_changed: "Permission changed",
  member_updated: "Member updated",
  member_deleted: "Member deleted",
  member_deactivated: "Member deactivated",
  member_reactivated: "Member reactivated",
};

// Deactivate is the normal way to remove someone: it keeps their finance,
// attendance and recording history. Delete is only offered for a deactivated
// account and only succeeds when the account has no such history.
// `notify` is kept until the cleanup step removes it from every caller; the buttons read the toast from useToast().
export function MemberAccessActions({ member, isSelf, onChanged }: {
  member: AccessMember; isSelf: boolean; onChanged: () => void | Promise<void>; notify?: Notify;
}) {
  const { notify } = useToast();
  const [dialog, setDialog] = useState<"deactivate" | "reactivate" | "delete" | null>(null);
  const [reason, setReason] = useState("");
  const { pending: busy, run: track } = useAsyncAction(notify);
  const label = member.full_name || member.email;
  const deactivated = member.status === "deactivated";

  async function run(action: "deactivate" | "reactivate" | "delete") {
    const done = await track(() => action === "deactivate"
      ? deactivateMember(member.id, reason.trim())
      : action === "reactivate"
        ? reactivateMember(member.id)
        : deleteMember(member.id), { fallback: "That change could not be saved." });
    if (!done.ok) return;
    setDialog(null); setReason("");
    notify(action === "deactivate" ? `${label} was deactivated` : action === "reactivate" ? `${label} was reactivated` : `${label} was deleted`);
    await onChanged();
  }

  return <>
    {deactivated
      ? <><Button variant="secondary" size="sm" onClick={() => setDialog("reactivate")}>Reactivate</Button><Button variant="danger" size="sm" onClick={() => setDialog("delete")}>Delete</Button></>
      : <Button variant="danger" size="sm" disabled={isSelf} title={isSelf ? "You cannot deactivate your own account" : undefined} onClick={() => setDialog("deactivate")}>Deactivate</Button>}

    <Dialog open={dialog === "deactivate"} onClose={busy ? () => {} : () => setDialog(null)} className="max-w-[480px]">
      <h2 className="m-0 text-2xl">Deactivate {label}?</h2>
      <p className="mt-3 text-sm leading-relaxed text-[#4c5f6b]">They lose access to the portal right away and are removed from their groups. Their reimbursements, attendance and recordings are kept, and you can reactivate the account later.</p>
      <label htmlFor="deactivate-reason" className="mt-4 block text-sm font-semibold">Reason (optional, visible to administrators)</label>
      <Textarea id="deactivate-reason" className="mt-1" rows={3} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Graduated, left the club…" />
      <div className="mt-6 flex flex-wrap justify-end gap-2">
        <Button variant="secondary" onClick={() => setDialog(null)} disabled={busy}>Cancel</Button>
        <Button variant="danger" onClick={() => run("deactivate")} disabled={busy}>{busy ? "Working…" : "Deactivate"}</Button>
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
