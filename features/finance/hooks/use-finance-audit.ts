"use client";

// The audit history of one record, for an executive's detail dialog (finance_audit_log is readable only by executives). Reads when the dialog
// opens and again on Try again; nothing is read for anybody else (`entity` is null).
import { useCallback, useEffect, useState } from "react";
import { friendlyError } from "../../../lib/errors";
import { listFinanceAudit, type FinanceAuditEntity, type FinanceAuditRow } from "../../../lib/api/finance";

export type AuditState = { status: "loading" } | { status: "ready"; rows: FinanceAuditRow[] } | { status: "failed"; message: string };

export function useFinanceAudit(record: { entity: FinanceAuditEntity; id: number } | null) {
  const [state, setState] = useState<AuditState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const entity = record?.entity;
  const id = record?.id;
  useEffect(() => {
    if (!entity || id === undefined) return;
    let current = true; // false once this read was replaced or the dialog closed: its answer is not shown
    listFinanceAudit(entity, [id]).then(
      (rows) => { if (current) setState({ status: "ready", rows }); },
      (error: unknown) => { if (current) setState({ status: "failed", message: friendlyError(error as { message?: string } | null, "The history could not be loaded.") }); },
    );
    return () => { current = false; };
  }, [entity, id, attempt]);
  const retry = useCallback(() => { setState({ status: "loading" }); setAttempt((n) => n + 1); }, []);
  return { state, retry };
}
