# Known gaps

Things the portal does today that are weaker than they should be, that were looked at on purpose and not changed yet. Each entry says what is open, what it allows, why it was left, and where it is scheduled. Nothing here is a surprise to the code: where a test pins the current behaviour it is named.

Last reviewed 28 Nov 2026 on branch `phase-4-finance`. Findings marked "verified" were reproduced on the local replay (`scripts/db-replay.sh`, plain PostgreSQL 16 with the Supabase shims, not hosted Supabase).

The gap that stood here before (finance documents and their links written straight to the tables, plan item P0-05 and P1-05) is closed: `register_finance_document` registers a document and `20261128029000_finance_documents_revoke_direct_writes.sql` takes the direct writes away. See `docs/RELEASE_ORDER.md` for the order in which they reach the database.

## 1. One executive can do every step of some money movements alone

Scheduled: not scheduled. The plan names self-review and self-payment of a reimbursement only (decision D4, closed in `20261128028000_finance_self_payment_block.sql`); the rest was looked at while closing that and left as it is. It needs a decision about how many executives the club has and whether a second signature is wanted.

### What is open

Verified on the local replay, as one executive with no second person:

| Step | Result |
|---|---|
| Void the payment of their own reimbursement (`void_finance_payment`) | allowed: the request goes back to approved and the outflow leaves the ledger. Another executive has to pay it again, but the cash that really left the account is no longer shown as spent in between. |
| Void their own request (`void_finance_expense`) | allowed (the screen hides the button for an own request, the function does not refuse it) |
| Record a club purchase (`record_club_expense`) | allowed, and it is settled at once: there is no approval step and no second person |
| Record income (`record_finance_income`) | allowed |
| Build a funding claim, mark it approved and record the funder's payments (`create_funding_claim`, `set_funding_claim_status`, `record_funding_claim_payment`) | allowed for one executive from start to end; the payment is an inflow with no document behind it |

Every one of them is audited (`finance_audit_log` names the actor), so it is visible afterwards, but nothing stops it.

### Why it is left alone

Which of these steps should need a second person is a decision for the club, and the plan has not made it. Self-payment was chosen because it is the one where the person who gains is the person who acts.

## 2. The membership gate: what it does not do (P0-01, Phase 4.1)

Added with `20261128010000_membership_gate_schema.sql` and `20261128010100_membership_gate_signup_default.sql` (order of release in `docs/RELEASE_ORDER.md`). A new sign-up is `pending` until an active executive or administrator approves it in the Sign-up requests queue; a declined one is `rejected` and stays out until an executive approves it. Tests: `supabase/tests/76_membership_gate*.test.sql`, `supabase/tests/concurrency/76_membership_gate_*.sh`, `tests/component/signup-requests.test.tsx`, `tests/component/shell-membership-gate.test.tsx`. What the gate leaves open on purpose:

- **Anyone with a Google account can create a pending profile.** Decision D1 is "needs an executive's approval", not "restricted to a domain". Each stranger costs one `profiles` and one `auth.users` row and an entry in the queue (the queue lists the 500 oldest waiting; the count in the menu is exact). There is no rate limit and no clean-up of old pending accounts. Fix when it matters: an allowed-domain list checked in `private.handle_new_user`, or a scheduled delete of sign-ups pending for more than N days (`admin_delete_member` already removes one).
- **The first administrator's address is written in `private.handle_new_user` too** (as an exemption from `pending`), next to the place `20260812000000_admin_console.sql` promotes it. Both go with the bootstrap handover of Phase 4.4 (P3-04).
- **Nobody is told.** An executive learns of a sign-up from the count in the menu only (no email); the person learns of an approval by pressing Check again or signing in again. A declined person is not told why: the reason is for executives and is never in any answer a pending or rejected account can read.
- **The queue shows the 50 most recently declined.** An older declined sign-up stays rejected and cannot be approved from the screen (the function still takes it: `review_pending_member(id, true)`), and the person cannot sign up again with the same Google account. An administrator can delete the account so that they start over.
- **The name typed on the sign-up form** (the `sessionStorage` flow) is saved when the portal first opens, which for a new sign-up is after the approval, and only if it is the same browser tab. Otherwise the name from the Google account stays; the person can change it on their profile.
- **The finance functions say "Your access to the portal has been deactivated" to a pending or rejected caller.** They had their own explicit `is_active_member` check before this change. Every table write and every other function says the right thing ("waiting for approval", "not approved"). Cosmetic: the account is refused either way.
- **Approve has no confirmation.** It is one click and an executive can undo a mistake only by deactivating the account (an administrator). Declining is the one that asks (for a reason) and is undone by Approve.
