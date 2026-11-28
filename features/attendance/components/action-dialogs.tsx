"use client";

import { ConfirmDialog } from "../../../components/ui/confirm-dialog";
import { FormDialog } from "../../../components/ui/form-dialog";
import { formConfig, type ActionDialog } from "../action-dialog";

// The question behind a button that changes something: a form (a mark, a decision, a follow-up, an eligibility change) or a
// confirmation (close check-in, cancel a meeting). Cancelling sends nothing; the caller sends the request on submit.
export function ActionDialogs({ dialog, saving, onSubmit, onConfirm, onCancel }: {
  dialog: ActionDialog | null;
  saving: boolean;
  onSubmit: (values: Record<string, string>) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const form = dialog && dialog.kind !== "session" ? formConfig(dialog) : null;
  return <>
    {form && <FormDialog open title={form.title} description={form.description} fields={form.fields} submitLabel={form.submitLabel} danger={form.danger} busy={saving} onSubmit={onSubmit} onCancel={onCancel} />}
    <ConfirmDialog
      open={dialog?.kind === "session"}
      title={dialog?.kind === "session" && dialog.action === "cancel" ? "Cancel this meeting?" : "Close check-in?"}
      confirmLabel={dialog?.kind === "session" && dialog.action === "cancel" ? "Cancel meeting" : "Close attendance"}
      danger={dialog?.kind === "session" && dialog.action === "cancel"}
      busy={saving}
      onConfirm={onConfirm}
      onCancel={onCancel}
    >
      {dialog?.kind === "session" && dialog.action === "cancel" ? "It will not count toward attendance." : "Everyone still missing is marked absent."}
    </ConfirmDialog>
  </>;
}
