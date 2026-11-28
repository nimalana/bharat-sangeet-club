# Release order

The deployed frontend and the database are released separately, and for a while they run side by side: the new database under the old frontend, and open browser tabs on the old frontend after the new one is live. A migration that only ADDS (a function, a column, a stricter check that the old frontend never trips) can go first. A migration that REMOVES something the old frontend uses (a privilege, a policy, a function it calls) must wait until the frontend that no longer uses it is live. A migration of the second kind carries a header that says so, in capitals, and is listed here.

The three steps, always in this order:

1. **Apply before the new frontend.** Everything not listed under "Apply after the frontend is live", in filename order.
2. **Deploy the frontend** and check it (the checks below).
3. **Apply after the frontend is live.** The files listed below, in filename order.

`scripts/db-replay.sh` applies every file in filename order, which is also a valid production order for the whole list (the late files sort after the files they depend on). The point of this file is only that production does steps 1 to 3 with the deploy in the middle.

A new migration that removes or tightens something the deployed frontend relies on goes into the last section, with its header, in the same commit.

## Apply before the new frontend

Everything that is not in the last section. In this phase (4.2, finance integrity), all of these only add or replace a function, or add nullable columns; nothing the deployed frontend does is refused by them:

- `20261128020000_finance_register_document.sql`: adds `register_finance_document(...)`. The new frontend calls it once per upload instead of writing four tables.
- `20261128020100_finance_rejection_audit.sql`: adds `finance_expenses.rejected_by` and `rejected_at`, moves the approval fields of old declined purchases into them, and makes a decision write its own audit row. The deployed frontend never reads `approved_by` or `approved_at`.
- `20261128020200_finance_event_evidence_at_entry.sql`: an event purchase needs its event name, date and time, attendees and schedule when it is recorded (the purchase forms already require them once "This purchase was for an event" is ticked).
- `20261128020300_finance_claim_link_claim_lock.sql`: the claim row is locked when a claim link is written. No single caller sees a change.

## Deploy the frontend

Deploy the frontend of this release. Check, signed in as a member and as an executive:

- a request with a receipt is saved and its receipt appears on it (one call to `register_finance_document`);
- a club purchase for an event, with its event details, is accepted;
- an executive's own approved request shows "Another executive must pay your own request." and no "Mark paid" button.

## Apply after the frontend is live

Each of these takes something away that the previous frontend used. Applied earlier, the old screens answer with a refusal. Apply them in filename order:

- `20261127075000_least_privilege_grants.sql`: removes INSERT, UPDATE, DELETE and TRUNCATE on the ledger, attendance, audit and group tables from `anon` and `authenticated`. The frontend deployed before this phase still writes some of those tables straight through the REST API.
- `20261127090000_attendance_eligibility_definer.sql`: makes `set_attendance_eligibility` a `SECURITY DEFINER` function and removes the direct INSERT and UPDATE on `attendance_eligibility`.
- `20261128028000_finance_self_payment_block.sql`: `pay_personal_reimbursement` refuses a request the caller made themselves. The old screen still shows "Mark paid" on an executive's own approved request and would answer with the sentence "You cannot pay your own reimbursement. Ask another executive."
- `20261128029000_finance_documents_revoke_direct_writes.sql`: removes INSERT (and any UPDATE, DELETE, TRUNCATE) on `finance_documents` and its three link tables, and the policies that only existed for those inserts. The old frontend registers an upload with direct inserts; after this file the only way is `register_finance_document`. Needs `20261128020000` applied and the new frontend live.
