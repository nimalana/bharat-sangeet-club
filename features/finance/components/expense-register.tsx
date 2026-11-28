import { formatDay } from "../../../lib/dates";
import { formatMoney } from "../../../lib/format";
import type { Expense } from "../../../lib/api/finance";
import { FINANCE_LIST_LIMIT as LIST_LIMIT } from "../../../lib/api/finance";
import type { DetailTarget } from "../detail";
import type { FinanceDerived } from "../model";
import { FinanceEmpty, PanelHeading, StatusBadge } from "./finance-parts";

// A manager's list of every purchase (the club's and the members'), with Edit and Void on the ones that can still change.
export function ExpenseRegister({ expenses, profileById, lockedExpenseIds, changing, openDetail, askEditExpense, askVoidExpense }: {
  expenses: Expense[]; profileById: FinanceDerived["profileById"]; lockedExpenseIds: Set<number>; changing: boolean; openDetail: (target: DetailTarget) => void;
  askEditExpense: (expense: Expense) => void; askVoidExpense: (expense: Expense) => void;
}) {
  return <section className="finance-panel"><PanelHeading title="Expense register" meta={expenses.length >= LIST_LIMIT ? `Latest ${LIST_LIMIT} purchases` : `${expenses.length} purchases`} />{expenses.length ? <div className="finance-table"><div className="finance-table-head"><span>Purchase</span><span>Paid by</span><span>Status</span><span>Amount</span></div>{expenses.map((expense) => <div className="finance-table-row" key={expense.id}><div><b>{expense.description}</b><small>{expense.vendor || expense.category} · {formatDay(expense.purchase_date)}{expense.payment_card_last4 ? ` · •••• ${expense.payment_card_last4}` : ""}</small></div><span>{expense.paid_by === "member" ? profileById.get(expense.paid_by_member_id || "")?.full_name || "Member" : "Club account"}</span><StatusBadge status={expense.status} /><strong>{formatMoney(Number(expense.amount))}<span className="finance-row-actions"><button type="button" className="finance-row-action" aria-label={`Details of ${expense.description}`} onClick={() => openDetail({ kind: "expense", id: expense.id })}>Details</button>{expense.status !== "voided" && <>{!lockedExpenseIds.has(expense.id) && <button type="button" className="finance-row-action" disabled={changing} onClick={() => askEditExpense(expense)}>Edit</button>}<button type="button" className="finance-row-action" disabled={changing} onClick={() => askVoidExpense(expense)}>Void</button></>}</span></strong></div>)}</div> : <FinanceEmpty title="No expenses yet" text="Record a club purchase or approve a member reimbursement." />}</section>;
}
