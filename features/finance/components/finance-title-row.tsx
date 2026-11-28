import { Button } from "../../../components/ui/button";
import type { FinanceModal } from "../types";

// The heading of the screen and the buttons that open its forms.
export function FinanceTitleRow({ canManage, setModal }: { canManage: boolean; setModal: (modal: FinanceModal) => void }) {
  return <div className="finance-title-row"><div className="page-title"><p className="eyebrow">{canManage ? "FINANCE WORKSPACE" : "MEMBER FINANCES"}</p><h1>{canManage ? "Club finances" : "My reimbursements"}</h1><p>{canManage ? "Purchases, payments, member reimbursements, and funding claims—connected without double-counting." : "Submit purchases you made for the club and follow each request through review and payment."}</p></div><div className="finance-actions">{canManage && <><Button variant="secondary" onClick={() => setModal("income")}>＋ Record income</Button><Button variant="secondary" onClick={() => setModal("expense")}>＋ Club expense</Button></>}<Button onClick={() => setModal("reimbursement")}>＋ Request reimbursement</Button></div></div>;
}
