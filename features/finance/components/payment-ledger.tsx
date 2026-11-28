import { formatDay } from "../../../lib/dates";
import { formatMoney } from "../../../lib/format";
import type { Payment } from "../../../lib/api/finance";
import { FinanceEmpty } from "./finance-parts";

export function PaymentLedger({ payments, onVoid, disabled }: { payments: Payment[]; onVoid: (payment: Payment) => void; disabled: boolean }) {
  return payments.length ? <div className="ledger finance-ledger"><div className="ledger-head"><b>Payment</b><span>Date</span><span>Account</span><span>Amount</span></div>{payments.map((payment) => <div className="ledger-row" key={payment.id}><span className={`money-mark ${payment.direction === "inflow" ? "income" : "expense"}`}>{payment.direction === "inflow" ? "+" : "−"}</span><div><b>{payment.description}</b><small>{payment.category}{payment.counterparty ? ` · ${payment.counterparty}` : ""}</small></div><span>{formatDay(payment.payment_date)}</span><span>{payment.account_name}</span><strong className={payment.direction === "inflow" ? "income" : "expense"}>{payment.direction === "inflow" ? "+" : "−"}{formatMoney(Number(payment.amount))} <button type="button" className="finance-row-action" disabled={disabled} onClick={() => onVoid(payment)} aria-label={`Void payment: ${payment.description}`}>Void</button></strong></div>)}</div> : <FinanceEmpty title="No payments yet" text="Income and paid expenses will appear in the cash ledger." />;
}
