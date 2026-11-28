# Release order

The order in which the migrations of this repository reach the live database and the frontend reaches the live site. It exists because the site and the database are released separately, so for some time the old frontend runs against the new database and the new frontend against the old one.

The rule: a migration that **only adds** things (a function, a nullable column, a table, an enum value, an extra key in an answer) is applied **before** the frontend that uses it is deployed; the deployed frontend does not notice. A migration that **removes a privilege** or **refuses something the deployed frontend still does** is applied only **after** the new frontend is live. Each such file says so in a header ("RELEASE ORDER") and is listed here with one line on why. Add yours to the right section when you write it.

Every section is in the order the steps are done. The step that is easy to forget is the third: nothing in the repository applies it for you.

## 1. Apply before the new frontend

Everything that only adds. The deployed frontend keeps working against all of it.

- Every migration that is not named in section 3 (`docs/PHASE_1_MANUAL_CHECKS.md`: "the others are additive; the current production frontend keeps working against them"). A migration that is not additive does not belong here: move it to section 3.
- `20261128010000_membership_gate_schema.sql` (membership gate, part 1): adds the account states `pending` and `rejected`, the table `signup_reviews`, the functions `review_pending_member` and `list_pending_members`, the guard trigger on `profiles.status`, the narrower directory policy, and an extra key `pending_signups` in `get_portal_bootstrap` for executives. Nobody is pending until part 2, so nothing observable changes for the deployed frontend. It goes first so that the functions the new frontend calls exist the moment it is live.
- `20261128020000_finance_register_document.sql` (finance integrity 4.2): adds `register_finance_document(...)`. The new frontend calls it once per upload instead of writing four tables.
- `20261128020100_finance_rejection_audit.sql`: adds `finance_expenses.rejected_by` and `rejected_at`, moves the approval fields of old declined purchases into them, and makes a decision write its own audit row. The deployed frontend never reads `approved_by` or `approved_at`.
- `20261128020200_finance_event_evidence_at_entry.sql`: an event purchase needs its event name, date and time, attendees and schedule when it is recorded (the purchase forms already require them once "This purchase was for an event" is ticked).
- `20261128020300_finance_claim_link_claim_lock.sql`: the claim row is locked when a claim link is written. No single caller sees a change.

## 2. Deploy the frontend

The branch that carries the shell's Pending and Rejected screens and the Sign-up requests page (`features/shell/components/membership-screens.tsx`, `features/admin/components/signup-requests-panel.tsx`). Check it against the database of step 1: sign in as an executive, open Sign-up requests (it reads `list_pending_members`, which only exists after `20261128010000`); an executive's menu shows the count of people waiting.

Finance (4.2), signed in as a member and as an executive:

- a request with a receipt is saved and its receipt appears on it (one call to `register_finance_document`);
- a club purchase for an event, with its event details, is accepted;
- an executive's own approved request shows "Another executive must pay your own request." and no "Mark paid" button.

Do not apply anything of section 3 before this is live and checked.

## 3. Apply after the frontend is live

Each of these breaks the frontend deployed before this one, or changes what a person sees.

- `20261127075000_least_privilege_grants.sql`: takes write privileges away from `authenticated` (and almost everything from `anon`) on every table the new frontend does not write directly. The old frontend still writes `funding_claims` and `funding_claim_expenses` through the REST API; applied first, "Build a funding claim" answers 42501 until the new frontend is out. The undo for a single table is in `docs/PHASE_1_MANUAL_CHECKS.md` ("Release order").
- `20261127090000_attendance_eligibility_definer.sql`: makes `set_attendance_eligibility` run as its owner and removes `INSERT` and `UPDATE` on `attendance_eligibility` from signed-in users, so that nobody can forge who decided and when. A client that wrote the table directly instead of calling the function is refused from this file on; the new frontend only calls the function.
- `20261128010100_membership_gate_signup_default.sql` (membership gate, part 2): from this moment everyone who signs in with Google for the first time is created as `pending`, not `active`. No existing profile changes: members, executives, administrators and deactivated accounts keep their status and role, and the club's first administrator is active even if that account is created again. **What an older frontend does with a pending account:**
  - the frontend of this branch's base (`lib/bootstrap.ts` before this change) asks `get_portal_bootstrap`, gets a profile whose status it does not know, and shows "We could not load your club profile" with Try again (which can never succeed) and Sign out. No portal, no data, nothing written: unhelpful, but safe;
  - the production `main` frontend does not read the status at all. It reads its own profile row (allowed for a pending account), shows the member portal with the member menu, and every other read answers empty (the restrictive "Active members only" policies) and every write is refused with "Your sign-up is waiting for approval by a club executive". It looks like an empty portal, no data leaks.

  So deploy the new frontend first; with it live a pending account sees "Your sign-up is waiting for approval by a club executive." and executives get the queue.

  The undo is two statements: `create or replace function private.handle_new_user()` as part 2 defines it but with `'active'` in place of the `case` (the original, without a status, is in `20260810000000_bharat_sangeet_foundation.sql`), and `alter table public.profiles alter column status set default 'active'`. Sign-ups already made stay pending until an executive approves them.
- `20261128028000_finance_self_payment_block.sql` (finance integrity 4.2): `pay_personal_reimbursement` refuses a request the caller made themselves. The old screen still shows "Mark paid" on an executive's own approved request and would answer with the sentence "You cannot pay your own reimbursement. Ask another executive."
- `20261128029000_finance_documents_revoke_direct_writes.sql`: removes INSERT (and any UPDATE, DELETE, TRUNCATE) on `finance_documents` and its three link tables, and the policies that only existed for those inserts. The old frontend registers an upload with direct inserts; after this file the only way is `register_finance_document`. Needs `20261128020000` applied and the new frontend live.

## Checks after step 3

- Sign in with a Google account that has never signed in: the portal says "Your sign-up is waiting for approval by a club executive." and nothing else.
- Sign in as an executive: Sign-up requests shows that person, with the count in the menu; Approve them; the other browser's Check again opens the portal.
- Sign in as an existing member, executive and administrator: nothing changed.
- With the pending account's token against the REST API, `GET /rest/v1/profiles` returns only its own row, any other table returns no rows, and any write answers 42501 with "Your sign-up is waiting for approval by a club executive".
