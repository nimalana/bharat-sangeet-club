"use client";

import { useState } from "react";
import { Button } from "../../../components/ui/button";
import { ErrorBlock } from "../../../components/ui/error-block";
import { FormDialog } from "../../../components/ui/form-dialog";
import { LoadErrorBanner } from "../../../components/ui/load-error";
import { SkeletonRows } from "../../../components/ui/skeleton";
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
 * While one review is sent every button waits (the pressed one says so, and a second press sends nothing); a decline that is refused
 * leaves its question open with the reason as typed, and the toast says why.
 */
export function SignupRequestsPanel({ onCount }: { onCount?: (waiting: number) => void }) {
  const { notify } = useToast();
  const { waiting, declined, state, stale, load, retry } = useSignupRequests(onCount);
  const { pending: busy, run } = useAsyncAction(notify, { exclusive: true });
  const [declining, setDeclining] = useState<SignupRequest | null>(null);
  // Which request, and which decision, is being sent (the pressed button says so).
  const [sending, setSending] = useState<{ id: string; approved: boolean } | null>(null);
  const [retrying, setRetrying] = useState(false);
  const isSending = (request: SignupRequest, approved: boolean) => sending?.id === request.member_id && sending.approved === approved;

  /** True when the review was made. A review that was refused, or skipped because another is running, is false. */
  async function review(request: SignupRequest, approved: boolean, reason = ""): Promise<boolean> {
    // `sending` is set when the review really starts: a press that is skipped (one is running) must not touch the pressed button's state.
    const outcome = await run(() => { setSending({ id: request.member_id, approved }); return reviewPendingMember(request.member_id, approved, reason); }, { fallback: "That sign-up could not be reviewed." });
    if (!outcome.ok && outcome.skipped) return false;
    setSending(null);
    // Whatever the answer, read the queue again: it may have changed under us (another executive decided first).
    await load();
    if (!outcome.ok) return false;
    notify(approved ? `${nameOf(request)} was approved and can use the portal now` : `${nameOf(request)}'s sign-up was declined`);
    return true;
  }
  async function decline(reason: string) {
    const request = declining;
    if (!request) return;
    if (await review(request, false, reason)) setDeclining(null);
  }
  async function tryAgain() {
    setRetrying(true);
    try { await retry(); } finally { setRetrying(false); }
  }

  return <section className="admin-panel signup-panel">
    <div className="admin-panel-heading"><div><p className="eyebrow">NEW SIGN-UPS</p><h2>Sign-up requests</h2><p className="panel-note">People who sign in for the first time wait here. Until an executive approves them they cannot see anything in the portal.</p></div>{state === "ready" && <span>{waiting.length} waiting</span>}</div>

    {state === "loading" && <SkeletonRows rows={3} label="Loading sign-up requests" />}
    {state === "failed" && <ErrorBlock message="The sign-up requests could not be loaded." onRetry={() => void tryAgain()} role="alert" busy={retrying} />}
    {state === "ready" && stale && <LoadErrorBanner message="The sign-up requests could not be refreshed, so they may be out of date." onRetry={() => void tryAgain()} busy={retrying} />}
    {state === "ready" && (waiting.length
      ? waiting.map((request) => <div className="signup-row" key={request.member_id}>
        <div className="min-w-0"><b className="break-words">{nameOf(request)}</b><small className="break-all">{request.email}</small><small>Signed up {formatDate(request.requested_at)}</small></div>
        <div className="signup-actions">
          <Button size="sm" disabled={busy} pending={isSending(request, true)} aria-label={`Approve ${nameOf(request)}`} onClick={() => void review(request, true)}>Approve</Button>
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
        <div className="signup-actions"><Button variant="secondary" size="sm" disabled={busy} pending={isSending(request, true)} aria-label={`Approve ${nameOf(request)}`} onClick={() => void review(request, true)}>Approve</Button></div>
      </div>)}
    </>}

    <FormDialog open={declining !== null} title={declining ? `Decline ${nameOf(declining)}?` : "Decline this sign-up?"}
      description="They will not be able to open the portal and will see that their sign-up was not approved. The reason is only for executives. You can still approve them later from Recently declined."
      fields={[{ name: "reason", label: "Reason (optional, visible to executives)", type: "textarea", maxLength: 500, placeholder: "Not a member of the club…" }]}
      submitLabel="Decline sign-up" danger busy={busy} onSubmit={(values) => void decline(values.reason)} onCancel={() => setDeclining(null)} />
  </section>;
}
