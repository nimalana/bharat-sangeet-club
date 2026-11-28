import { formatMoney } from "../../../lib/format";
import type { FinanceDerived } from "../model";
import type { FinanceAction, FinanceConfirm } from "../types";
import { ConfirmDialog } from "../../../components/ui/confirm-dialog";
import { FormDialog } from "../../../components/ui/form-dialog";

// The dialogs of the changes that ask first: paying out money and sending a claim to the funder (a yes), and the corrections (a small form).
export function FinanceChangeDialogs({ confirming, setConfirming, pendingKey, confirmChange, profileById, expenseById, action, setAction, actionBusy, runAction }: {
  confirming: FinanceConfirm; setConfirming: (confirm: FinanceConfirm) => void; pendingKey: string | null; confirmChange: () => Promise<void>;
  profileById: FinanceDerived["profileById"]; expenseById: FinanceDerived["expenseById"];
  action: FinanceAction | null; setAction: (action: FinanceAction | null) => void; actionBusy: boolean; runAction: (values: Record<string, string>) => Promise<void>;
}) {
  return <>
    <ConfirmDialog open={confirming?.kind === "pay"} title="Mark this reimbursement as paid?" confirmLabel="Mark paid" busy={Boolean(pendingKey)} onConfirm={() => void confirmChange()} onCancel={() => setConfirming(null)}>
      {confirming?.kind === "pay" && <p className="m-0">Record a payment of {formatMoney(Number(confirming.request.approved_amount || confirming.request.requested_amount))} to {profileById.get(confirming.request.member_id)?.full_name || "the member"} for &ldquo;{expenseById.get(confirming.request.expense_id)?.description || "this purchase"}&rdquo;. It leaves the club bank account today and lowers available cash. If it was a mistake, void the payment afterwards.</p>}
    </ConfirmDialog>
    <ConfirmDialog open={confirming?.kind === "submit"} title="Mark this claim as submitted?" confirmLabel="Mark submitted" busy={Boolean(pendingKey)} onConfirm={() => void confirmChange()} onCancel={() => setConfirming(null)}>
      {confirming?.kind === "submit" && <p className="m-0">&ldquo;{confirming.claim.title}&rdquo; goes to {confirming.claim.funder_name} as submitted. It cannot go back to editing; from here it can only be approved, sent back for changes, or denied.</p>}
    </ConfirmDialog>
    <FormDialog key={action?.title || "none"} open={Boolean(action)} title={action?.title || ""} description={action?.description} fields={action?.fields || []} submitLabel={action?.submitLabel || "Save"} danger={action?.danger} busy={actionBusy} onSubmit={runAction} onCancel={() => setAction(null)} />
  </>;
}
