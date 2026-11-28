// What the Phase 3 finance tests share: rows as the database sends them, a script for the screen's eleven reads, and a render of the screen.
// (finance.test.tsx and finance-flows.test.tsx, written before Phase 3, carry their own copies and are left as they were.)
import type { User } from "@supabase/supabase-js";
import { expect } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { FinancePage } from "../../features/finance/components/finance-page";
import { setCacheOwner } from "../../lib/cache";
import { notifySpy, userOf } from "../support/helpers";
import { fake, ok } from "../support/fake-supabase";

export const expense = (over: Record<string, unknown> = {}) => ({
  id: 1, description: "Tabla repair", vendor: "Raj Music", amount: 80, purchase_date: "2026-10-01", category: "Instruments", paid_by: "member", paid_by_member_id: "member-9",
  payment_card_last4: "1234", subgroup_id: null, club_event_id: null, event_related: false, event_name: "", event_starts_at: null, event_attendee_count: null,
  event_schedule: "", status: "approved", created_by: "member-9", created_at: "2026-10-01T15:00:00Z", approved_by: "exec-2", approved_at: "2026-10-03T15:00:00Z",
  rejected_by: null, rejected_at: null, voided_by: null, voided_at: null, void_reason: null, ...over,
});
export const reimbursement = (over: Record<string, unknown> = {}) => ({
  id: 5, expense_id: 1, member_id: "member-9", requested_amount: 80, approved_amount: 80, status: "approved", member_note: "", review_note: "",
  created_at: "2026-10-02T15:00:00Z", reviewed_by: "exec-2", reviewed_at: "2026-10-03T15:00:00Z", paid_at: null, voided_by: null, voided_at: null, void_reason: null, ...over,
});
export const payment = (over: Record<string, unknown> = {}) => ({
  id: 7, direction: "outflow", purpose: "member_reimbursement", amount: 80, description: "Reimbursement: Tabla repair", category: "Instruments", account_name: "Club bank account",
  counterparty: "Meera Nair", payment_date: "2026-10-03", status: "posted", reimbursement_id: 5, funding_claim_id: null, expense_id: 1, created_at: "2026-10-03T16:00:00Z",
  created_by: "exec-2", cleared_date: null, voided_by: null, voided_at: null, void_reason: null, ...over,
});
export const claim = (over: Record<string, unknown> = {}) => ({
  id: 3, title: "Fall concert", funder_name: "GPSG Senate", award_reference: "", heellife_reference: "", requested_amount: 80, approved_amount: null, received_amount: 0,
  submission_deadline: null, status: "draft", notes: "", ...over,
});
export const SUMMARY = { available_cash: 1234, income: 2000, spending: 766, pending_reimbursement_total: 80, pending_reimbursement_count: 1, expected_funding: 0 };

export type Data = Record<"expenses" | "reimbursements" | "payments" | "documents" | "expenseDocuments" | "reimbursementDocuments" | "claims" | "claimExpenses" | "claimDocuments" | "profiles", unknown[]>;
const BASE: Data = {
  expenses: [expense()], reimbursements: [reimbursement({ status: "submitted" })], payments: [payment()], documents: [], expenseDocuments: [], reimbursementDocuments: [],
  claims: [], claimExpenses: [], claimDocuments: [],
  profiles: [{ id: "member-9", full_name: "Meera Nair", email: "meera@x.test" }, { id: "exec-1", full_name: "Esha Rao", email: "esha@x.test" }, { id: "exec-2", full_name: "Dev Menon", email: "dev@x.test" }],
};
const TABLES = {
  expenses: "finance_expenses", reimbursements: "personal_reimbursements", payments: "finance_payments", documents: "finance_documents", expenseDocuments: "finance_expense_documents",
  reimbursementDocuments: "finance_reimbursement_documents", claims: "funding_claims", claimExpenses: "funding_claim_expenses", claimDocuments: "finance_claim_documents", profiles: "profiles",
} as const;

export function scriptFinance(data: Partial<Data> = {}) {
  const all = { ...BASE, ...data };
  for (const name of Object.keys(TABLES) as Array<keyof Data>) fake.from(TABLES[name], "select").reply(ok(all[name]));
  fake.rpc("get_finance_summary").reply(ok(SUMMARY));
}

export type Who = { role?: "member" | "executive" | "admin"; userId?: string };
export function renderFinance({ role = "executive", userId = "exec-1", wrapper }: Who & { wrapper?: (node: ReactNode) => ReactNode } = {}) {
  const notify = notifySpy();
  setCacheOwner(userId);
  const user: User = userOf(userId);
  const screenNode = <FinancePage user={user} role={role} groups={[{ id: 4, name: "Vocal" }]} events={[{ id: 9, title: "Fall concert", starts_at: "2026-10-05T23:30:00Z" }]} />;
  const view = render(wrapper ? wrapper(screenNode) : screenNode);
  return { notify, view };
}

export const waitForLoad = () => waitFor(() => expect(screen.getByText("Available cash")).toBeInTheDocument());
export const waitForMemberLoad = () => waitFor(() => expect(screen.getByText("Requested")).toBeInTheDocument());
/** Opens a tab by clicking it (the tab is kept in the address, which updates a moment later). */
export async function openTab(name: string) {
  fireEvent.click(screen.getByRole("tab", { name }));
  await waitFor(() => expect(screen.getByRole("tab", { name })).toHaveAttribute("aria-selected", "true"));
}
export const dialog = () => screen.getByRole("dialog");
export const field = (label: string | RegExp) => within(dialog()).getByLabelText(label);
export const type = (label: string | RegExp, value: string) => fireEvent.change(field(label), { target: { value } });
export const pdf = (name = "receipt.pdf") => new File(["%PDF-1.4 receipt"], name, { type: "application/pdf" });
export const attach = (name: string, file: File = pdf()) => fireEvent.change(dialog().querySelector(`input[name="${name}"]`)!, { target: { files: [file] } });
