"use client";

import type { GroupRole } from "../../../lib/db";
import { ConfirmDialog } from "../../../components/ui/confirm-dialog";
import { roleLabels, type ManagedGroup, type Pending } from "../model";

/** The four questions a group's people screen asks before it acts: decline a request, remove a member, leave, archive or restore. */
export function GroupConfirmDialogs({ group, myRole, pending, busyKey, onConfirm, onCancel }: {
  group: ManagedGroup; myRole: GroupRole | null; pending: Pending; busyKey: string; onConfirm: () => void | Promise<void>; onCancel: () => void;
}) {
  return <>
    <ConfirmDialog open={pending?.kind === "decline"} title="Decline this request?" confirmLabel="Decline request" danger busy={busyKey.startsWith("decline-")} onConfirm={onConfirm} onCancel={onCancel}>
      {pending?.kind === "decline" && <p className="m-0">{pending.row.full_name || pending.row.email} will not be added to {group.name}. They can ask to join again later.</p>}
    </ConfirmDialog>
    <ConfirmDialog open={pending?.kind === "remove"} title={pending?.kind === "remove" ? `Remove ${pending.row.full_name || pending.row.email}?` : "Remove this member?"} confirmLabel="Remove member" danger busy={busyKey === "confirm"} onConfirm={onConfirm} onCancel={onCancel}>
      {pending?.kind === "remove" && <p className="m-0">{pending.row.full_name || pending.row.email} will lose access to {group.name}. Their past attendance is kept. They cannot rejoin on their own; an executive can add them back.</p>}
    </ConfirmDialog>
    <ConfirmDialog open={pending?.kind === "leave"} title={`Leave ${group.name}?`} confirmLabel="Leave group" danger busy={busyKey === "confirm"} onConfirm={onConfirm} onCancel={onCancel}>
      <p className="m-0">You will lose access to this group&apos;s resources and recordings. Your past attendance is kept.{myRole && myRole !== "member" ? ` You will also give up your ${roleLabels[myRole].toLowerCase()} role.` : ""}</p>
    </ConfirmDialog>
    <ConfirmDialog open={pending?.kind === "archive"} title={group.archived_at ? `Restore ${group.name}?` : `Archive ${group.name}?`} confirmLabel={group.archived_at ? "Restore group" : "Archive group"} danger={!group.archived_at} busy={busyKey === "confirm"} onConfirm={onConfirm} onCancel={onCancel}>
      <p className="m-0">{group.archived_at ? "The group will appear in members' lists again." : "The group is hidden from members and stops accepting requests. Nothing is deleted: its members, resources, recordings and attendance are kept, and you can restore it later."}</p>
    </ConfirmDialog>
  </>;
}
