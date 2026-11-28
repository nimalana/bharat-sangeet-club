"use client";

import { useState } from "react";
import { Button } from "../../../components/ui/button";
import { FormDialog } from "../../../components/ui/form-dialog";
import { LoadingBlock } from "../../../components/ui/loading-block";
import { useToast } from "../../../components/ui/toast";
import { reviewPendingMember, type SignupRequest } from "../../../lib/api/admin";
import { formatDate } from "../../../lib/format";
import { useAsyncAction } from "../../../lib/hooks/use-async-action";
import { useSignupRequests } from "../hooks/use-signup-requests";

const nameOf = (request: SignupRequest) => request.full_name || request.email;

/**
 * The people who signed in for the first time and wait for a club executive, with Approve and Decline, and under them the sign-ups
 * declined recently with an Approve that undoes the decline. Nobody listed here can open anything in the portal until approved.
 * The database decides who may review (an active executive or administrator, never one's own sign-up) and says so in words when a
 * review is refused, for example because another executive got there first; the list is read again after every attempt.
 */
export function SignupRequestsPanel({ onCount }: { onCount?: (waiting: number) => void }) {
  const { notify } = useToast();
  const { waiting, declined, state, load } = useSignupRequests(onCount);
  const { pending: busy, run } = useAsyncAction(notify);
  const [declining, setDeclining] = useState<SignupRequest | null>(null);

  async function review(request: SignupRequest, approved: boolean, reason = "") {
    const outcome = await run(() => reviewPendingMember(request.member_id, approved, reason), { fallback: "That sign-up could not be reviewed." });
    // Whatever the answer, read the queue again: it may have changed under us (another executive decided first).
    await load();
    if (!outcome.ok) return;
    notify(approved ? `${nameOf(request)} was approved and can use the portal now` : `${nameOf(request)}'s sign-up was declined`);
  }
  async function decline(reason: string) {
    const request = declining;
    if (!request) return;
    setDeclining(null);
    await review(request, false, reason);
  }

  return <section className="admin-panel signup-panel">
    <div className="admin-panel-heading"><div><p className="eyebrow">NEW SIGN-UPS</p><h2>Sign-up requests</h2><p className="panel-note">People who sign in for the first time wait here. Until an executive approves them they cannot see anything in the portal.</p></div>{state === "ready" && <span>{waiting.length} waiting</span>}</div>

    {state === "loading" && <LoadingBlock>Loading sign-up requests…</LoadingBlock>}
    {state === "failed" && <div><p className="workspace-empty">The sign-up requests could not be loaded.</p><Button variant="secondary" size="sm" onClick={() => void load()}>Try again</Button></div>}
    {state === "ready" && (waiting.length
      ? waiting.map((request) => <div className="signup-row" key={request.member_id}>
        <div className="min-w-0"><b className="break-words">{nameOf(request)}</b><small className="break-all">{request.email}</small><small>Signed up {formatDate(request.requested_at)}</small></div>
        <div className="signup-actions">
          <Button size="sm" disabled={busy} aria-label={`Approve ${nameOf(request)}`} onClick={() => void review(request, true)}>Approve</Button>
          <Button variant="secondary" size="sm" disabled={busy} aria-label={`Decline ${nameOf(request)}`} onClick={() => setDeclining(request)}>Decline</Button>
        </div>
      </div>)
      : <p className="workspace-empty">No sign-ups are waiting for approval.</p>)}

    {state === "ready" && declined.length > 0 && <>
      <h3 className="signup-subheading">Recently declined</h3>
      <p className="panel-note">They see that their sign-up was not approved and nothing else. Approve one to undo the decline.</p>
      {declined.map((request) => <div className="signup-row" key={request.member_id}>
        <div className="min-w-0">
          <b className="break-words">{nameOf(request)}</b><small className="break-all">{request.email}</small>
          <small>Declined{request.decided_by_name ? ` by ${request.decided_by_name}` : ""}{request.decided_at ? ` · ${formatDate(request.decided_at)}` : ""}{request.reason ? ` · ${request.reason}` : ""}</small>
        </div>
        <div className="signup-actions"><Button variant="secondary" size="sm" disabled={busy} aria-label={`Approve ${nameOf(request)}`} onClick={() => void review(request, true)}>Approve</Button></div>
      </div>)}
    </>}

    <FormDialog open={declining !== null} title={declining ? `Decline ${nameOf(declining)}?` : "Decline this sign-up?"}
      description="They will not be able to open the portal and will see that their sign-up was not approved. The reason is only for executives. You can still approve them later from Recently declined."
      fields={[{ name: "reason", label: "Reason (optional, visible to executives)", type: "textarea", maxLength: 500, placeholder: "Not a member of the club…" }]}
      submitLabel="Decline sign-up" danger busy={busy} onSubmit={(values) => void decline(values.reason)} onCancel={() => setDeclining(null)} />
  </section>;
}
