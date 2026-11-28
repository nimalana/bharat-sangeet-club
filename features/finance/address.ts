// What the finance screen keeps in the address (plan 3.2): the open tab (`?tab=`) and the cash ledger's activity filter (`?flow=`), read with
// lib/hooks/use-url-state.ts, so a reload or a link opens the same tab and Back returns to the previous one. A value the screen does not know is
// the usual one, never an error. Nothing typed is kept in the address: a search text can be a person's name and addresses are logged.
import type { FinanceFlow, FinanceView } from "./types";

const VIEWS: readonly FinanceView[] = ["overview", "expenses", "reimbursements", "claims"];
/** `?tab=requests` is read as the reimbursements tab (the requests); the address is written with the tab's own name. */
export const parseView = (raw: string): FinanceView | undefined => (raw === "requests" ? "reimbursements" : VIEWS.find((view) => view === raw));

const FLOWS: readonly FinanceFlow[] = ["all", "inflow", "outflow", "member_reimbursement", "external_reimbursement"];
export const parseFlow = (raw: string): FinanceFlow | undefined => FLOWS.find((flow) => flow === raw);
