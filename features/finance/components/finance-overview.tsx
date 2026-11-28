import { formatMoney } from "../../../lib/format";
import type { FundingClaim, Payment, Reimbursement } from "../../../lib/api/finance";
import { FINANCE_LIST_LIMIT as LIST_LIMIT } from "../../../lib/api/finance";
import type { ClaimChecklist, FinanceDerived } from "../model";
import { parseFlow } from "../address";
import type { FinanceFlow, FinanceView } from "../types";
import { PanelHeading } from "./finance-parts";
import { PaymentLedger } from "./payment-ledger";

// The first tab of a manager: the cash ledger (searchable, with a Void on every payment) and the queue of what needs attention.
export function FinanceOverview({ payments, filteredPayments, query, setQuery, flowFilter, setFlowFilter, askVoidPayment, changing, pendingReimbursements, expenseById, claims, claimChecklist, setView }: {
  payments: Payment[]; filteredPayments: Payment[]; query: string; setQuery: (query: string) => void; flowFilter: FinanceFlow; setFlowFilter: (filter: FinanceFlow) => void;
  askVoidPayment: (payment: Payment) => void; changing: boolean; pendingReimbursements: Reimbursement[]; expenseById: FinanceDerived["expenseById"];
  claims: FundingClaim[]; claimChecklist: (claim: FundingClaim) => ClaimChecklist; setView: (view: FinanceView) => void;
}) {
  return <div className="finance-overview-grid"><section className="finance-panel"><PanelHeading title="Cash ledger" meta={payments.length >= LIST_LIMIT ? `Latest ${LIST_LIMIT} payments` : `${filteredPayments.length} payments`} /><div className="finance-ledger-tools"><label className="search">⌕<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search payments" aria-label="Search payments" /></label><select aria-label="Filter cash ledger" value={flowFilter} onChange={(event) => setFlowFilter(parseFlow(event.target.value) ?? "all")}><option value="all">All activity</option><option value="inflow">Money in</option><option value="outflow">Money out</option><option value="member_reimbursement">Member reimbursements</option><option value="external_reimbursement">Funding received</option></select></div><PaymentLedger payments={filteredPayments} onVoid={askVoidPayment} disabled={changing} /></section><aside className="finance-panel"><PanelHeading title="Action queue" meta="Needs attention" />{pendingReimbursements.length ? pendingReimbursements.slice(0, 4).map((request) => <button className="finance-queue-item" key={request.id} onClick={() => setView("reimbursements")}><span>Member reimbursement</span><b>{expenseById.get(request.expense_id)?.description || "Purchase"}</b><small>{formatMoney(Number(request.requested_amount))} · {request.status}</small></button>) : <p className="finance-empty-copy">No reimbursements need attention.</p>}{claims.filter((claim) => !["paid", "denied", "voided"].includes(claim.status)).slice(0, 3).map((claim) => <button className="finance-queue-item" key={claim.id} onClick={() => setView("claims")}><span>Funding claim</span><b>{claim.title}</b><small>{claimChecklist(claim).checks.filter((check) => check.done).length}/6 requirements · {claim.status}</small></button>)}</aside></div>;
}
