import { ErrorBlock } from "../../../components/ui/error-block";
import { LoadingBlock } from "../../../components/ui/loading-block";
import { FINANCE_AUDIT_LIMIT } from "../../../lib/api/finance";
import type { FinanceDocument } from "../../../lib/api/finance";
import { auditLines, when, type Detail, type Who } from "../detail";
import { useFinanceAudit } from "../hooks/use-finance-audit";
import { DocumentChip, StatusBadge } from "./finance-parts";
import { ModalShell } from "./modal-shell";

// The detail of a request, an expense or a payment: its facts, what happened to it and who did it, its documents (each opens in a preview),
// and, for an executive, the audit history. A member's dialog is built from their own request's row (detail.ts) and never asks for the audit.
export function FinanceDetailDialog({ detail, canManage, who, documentById, onPreview, onClose }: {
  detail: Detail; canManage: boolean; who: Who; documentById: Map<number, FinanceDocument>; onPreview: (documentId: number) => void; onClose: () => void;
}) {
  return <ModalShell eyebrow={detail.eyebrow} title={detail.title} onClose={onClose}>
    <div className="finance-detail-head"><StatusBadge status={detail.status} /><strong>{detail.amount}</strong></div>
    <dl className="finance-facts">{detail.facts.map((fact) => <div key={fact.label}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}</dl>
    <h3 className="finance-detail-heading">What happened</h3>
    <ol className="finance-timeline" aria-label="What happened">
      {detail.steps.map((step) => <li key={step.id} className={step.pending ? "pending" : undefined}>
        <b>{step.label}</b>
        {(step.who || step.at) && <span>{[step.who, when(step.at)].filter(Boolean).join(" · ")}</span>}
        {step.note && <q>{step.note}</q>}
      </li>)}
    </ol>
    <h3 className="finance-detail-heading">Documents</h3>
    {detail.documentIds.length
      ? <div className="finance-detail-documents">{detail.documentIds.map((id) => <DocumentChip key={id} title={documentById.get(id)?.title || "Document"} onOpen={() => onPreview(id)} />)}</div>
      : <p className="finance-detail-none">No documents are attached.</p>}
    {canManage && <AuditHistory record={detail.audit} who={who} />}
  </ModalShell>;
}

// Executives only: what the audit log kept about this record, newest first.
function AuditHistory({ record, who }: { record: Detail["audit"]; who: Who }) {
  const { state, retry } = useFinanceAudit(record);
  return <>
    <h3 className="finance-detail-heading">Audit history</h3>
    {state.status === "loading" && <LoadingBlock role="status">Loading the history…</LoadingBlock>}
    {state.status === "failed" && <ErrorBlock role="alert" message={state.message} onRetry={retry} />}
    {state.status === "ready" && (state.rows.length === 0
      ? <p className="finance-detail-none">Nothing has been recorded yet.</p>
      : <>
        <ol className="finance-timeline finance-audit" aria-label="Audit history">
          {auditLines(state.rows, who).map((line) => <li key={line.id}>
            <b>{line.label}</b>
            <span>{[line.who, when(line.at)].filter(Boolean).join(" · ")}</span>
            {line.changes.map((change) => <small key={change}>{change}</small>)}
          </li>)}
        </ol>
        {state.rows.length >= FINANCE_AUDIT_LIMIT && <p className="finance-detail-none">Showing the latest {FINANCE_AUDIT_LIMIT} entries.</p>}
      </>)}
  </>;
}
