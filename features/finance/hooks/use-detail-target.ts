"use client";

// Which record's detail is open: in the address (?request=5, ?expense=3 or ?payment=7), so a link opens it, Back closes it and a reload keeps it.
// One at a time: opening one clears the others (in the same tick, so it is one history entry). An id that is not a plain positive number is
// ignored; an id the screen has no record for shows nothing (the dialog is only drawn for a record that is here).
import { useCallback, useMemo } from "react";
import { positiveInteger, useUrlState } from "../../../lib/hooks/use-url-state";
import type { DetailTarget } from "../detail";

export function useDetailTarget() {
  const [requestId, setRequestId] = useUrlState<number | null>("request", { parse: positiveInteger, defaultValue: null, history: "push" });
  const [expenseId, setExpenseId] = useUrlState<number | null>("expense", { parse: positiveInteger, defaultValue: null, history: "push" });
  const [paymentId, setPaymentId] = useUrlState<number | null>("payment", { parse: positiveInteger, defaultValue: null, history: "push" });
  // If a link names more than one, the request wins, then the expense.
  const target = useMemo<DetailTarget | null>(
    () => (requestId !== null ? { kind: "request", id: requestId } : expenseId !== null ? { kind: "expense", id: expenseId } : paymentId !== null ? { kind: "payment", id: paymentId } : null),
    [requestId, expenseId, paymentId],
  );
  const open = useCallback((next: DetailTarget) => {
    setRequestId(next.kind === "request" ? next.id : null);
    setExpenseId(next.kind === "expense" ? next.id : null);
    setPaymentId(next.kind === "payment" ? next.id : null);
  }, [setRequestId, setExpenseId, setPaymentId]);
  const close = useCallback(() => { setRequestId(null); setExpenseId(null); setPaymentId(null); }, [setRequestId, setExpenseId, setPaymentId]);
  return { target, open, close };
}
