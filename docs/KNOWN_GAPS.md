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
