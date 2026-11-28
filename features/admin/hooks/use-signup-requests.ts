"use client";

// The sign-up queue as the Admin page and the Sign-up requests page show it: the people waiting for approval and the ones declined
// recently (so a decline can be undone). One read; a reload after a decision can overlap the one before it, so only the newest answer
// may change the list. A read that fails keeps what is shown and says so; before anything was ever read it is a failure state with
// Try again, never "nobody is waiting".
import { useCallback, useEffect, useState } from "react";
import { listPendingMembers, type SignupRequest } from "../../../lib/api/admin";
import { settle } from "../../../lib/api/settle";
import { friendlyError } from "../../../lib/errors";
import { createRequestGate } from "../../../lib/request-gate";
import { useToast } from "../../../components/ui/toast";

export type SignupQueueState = "loading" | "ready" | "failed";

/** `onCount` hears how many sign-ups are waiting every time the list is read (the shell shows it next to the menu entry). */
export function useSignupRequests(onCount?: (waiting: number) => void) {
  const { notify } = useToast();
  const [requests, setRequests] = useState<SignupRequest[]>([]);
  const [state, setState] = useState<SignupQueueState>("loading");
  const [gate] = useState(createRequestGate);

  const load = useCallback(async () => {
    const isCurrent = gate.begin();
    const { data, error } = await settle(listPendingMembers());
    if (!isCurrent()) return;
    if (error || !data) {
      notify(friendlyError(error, "The sign-up requests could not be loaded."), "error");
      setState((current) => (current === "ready" ? "ready" : "failed"));
      return;
    }
    setRequests(data);
    setState("ready");
    onCount?.(data.filter((request) => request.status === "pending").length);
  }, [gate, notify, onCount]);
  // This effect synchronizes the list with the database when the screen opens.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  const waiting = requests.filter((request) => request.status === "pending");
  const declined = requests.filter((request) => request.status === "rejected");
  return { waiting, declined, state, load };
}
