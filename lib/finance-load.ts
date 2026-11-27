// Which answers a finance refresh needs before it may replace what is on screen.
//
// The screen reads eleven things at once. A refresh is only applied when every
// one of them came back. The totals RPC is one of them: if it alone failed, the
// cards would quietly switch from the database totals to sums of the loaded
// lists (the latest 500 rows), and the person would see different money with no
// warning. A failed refresh keeps the last good figures and shows the banner.

type Answer = { error?: unknown } | null | undefined;

export const FINANCE_ANSWERS = [
  "expenses", "reimbursements", "payments", "documents", "expenseDocuments", "reimbursementDocuments",
  "summary", "claims", "claimExpenses", "claimDocuments", "profiles",
] as const;

export type FinanceAnswers = Record<(typeof FINANCE_ANSWERS)[number], Answer>;

export function financeRefreshFailed(answers: FinanceAnswers): boolean {
  return FINANCE_ANSWERS.some((name) => Boolean(answers[name]?.error));
}
