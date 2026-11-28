import { formatMoney } from "../../../lib/format";
import type { Reimbursement } from "../../../lib/api/finance";
import type { FinanceDerived } from "../model";
import type { FinanceSummary } from "../types";

function SummaryCard({ label, value, detail, tone }: { label: string; value: string; detail: string; tone?: "positive" | "warning" }) {
  return <div className={tone ? `finance-stat ${tone}` : "finance-stat"}><small>{label}</small><strong>{value}</strong><span>{detail}</span></div>;
}

// The cards above the tabs. A manager sees the club's totals: the database's own (get_finance_summary), or, when they did not arrive, sums
// of the loaded lists. A member sees their own requests.
export function FinanceSummaryCards({ canManage, summary, reimbursements, finance }: { canManage: boolean; summary: FinanceSummary | null; reimbursements: Reimbursement[]; finance: FinanceDerived }) {
  const { balance, income, spending, pendingTotal, pendingReimbursements, expectedFunding } = finance;
  return canManage ? <div className="finance-summary finance-summary-v2"><SummaryCard label="Available cash" value={formatMoney(summary?.available_cash ?? balance)} detail="Posted and cleared payments" /><SummaryCard label="Recorded income" value={formatMoney(summary?.income ?? income)} detail="All incoming payments" tone="positive" /><SummaryCard label="Club spending" value={formatMoney(summary?.spending ?? spending)} detail="Approved and settled purchases" /><SummaryCard label="Pending reimbursements" value={formatMoney(summary?.pending_reimbursement_total ?? pendingTotal)} detail={`${summary?.pending_reimbursement_count ?? pendingReimbursements.length} awaiting action`} tone={pendingReimbursements.length ? "warning" : undefined} /><SummaryCard label="Expected funding" value={formatMoney(summary?.expected_funding ?? expectedFunding)} detail="Approved, not yet received" tone="positive" /></div> : <div className="finance-summary finance-summary-v2 member"><SummaryCard label="Requested" value={formatMoney(reimbursements.reduce((sum, item) => sum + Number(item.requested_amount), 0))} detail="All my requests" /><SummaryCard label="Awaiting review" value={String(reimbursements.filter((item) => item.status === "submitted").length)} detail="Submitted requests" tone="warning" /><SummaryCard label="Paid" value={formatMoney(reimbursements.filter((item) => item.status === "paid").reduce((sum, item) => sum + Number(item.approved_amount || 0), 0))} detail="Completed reimbursements" tone="positive" /></div>;
}
