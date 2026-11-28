# Known gaps

Things the portal does today that are weaker than they should be, that were looked at on purpose and not changed yet. Each entry says what is open, what it allows, why it was left, and where it is scheduled. Nothing here is a surprise to the code: where a test pins the current behaviour it is named.

Last reviewed 27 Nov 2026 on branch `phase-2-fix-core`. Findings marked "verified" were reproduced on the local replay (`scripts/db-replay.sh`, plain PostgreSQL 16 with the Supabase shims, not hosted Supabase).

## 1. Finance documents and their links are written straight to the tables

Scheduled: Phase 4.2, item **register_finance_document function that creates document row and links atomically with audit and status checks (P0-05)**. Also in `IMPLEMENTATION_PLAN.md` section 4.2.

### What is open

The frontend registers an upload in several separate client calls (`uploadFinanceDocument` in `lib/api/finance.ts`, called by `uploadDocument` in `features/finance/hooks/use-finance-documents.ts`):

1. upload the file to the `finance-private` bucket under `<user id>/<uuid>-<name>`;
2. `insert` into `public.finance_documents` (`uploaded_by` is set by the client);
3. `insert` into `finance_expense_documents`, `finance_reimbursement_documents` and `finance_claim_documents`, one row per link, in parallel.

So `authenticated` holds `INSERT` (and `SELECT`) on all four tables (`20261127075000_least_privilege_grants.sql`, matrix in `supabase/tests/72_grants_matrix.test.sql`), and only row level security decides which rows go in. The only trigger on them is the one that refuses a deactivated user; there are no status conditions in their policies and no audit writes on insert. Removing a document is different: `remove_finance_document` is a checked, audited, `SECURITY DEFINER` function, and direct delete is refused.

### What that allows

Verified on the local replay:

| Who | Direct write | Result |
|---|---|---|
| Executive | `insert into finance_documents` with `uploaded_by` set to another person, a made-up `storage_path` (not in that person's folder, no object behind it) | allowed |
| Executive | `insert into finance_claim_documents`, `finance_reimbursement_documents`, `finance_expense_documents` linking that document to any claim, any member's reimbursement or any member's expense | allowed, whatever the parent's status (the policies have no status condition) |
| Member | `insert into finance_documents` with `uploaded_by` = themselves and a `storage_path` in another member's folder, or with no object behind it | allowed (the policy checks `uploaded_by` only) |
| Member | `insert into finance_reimbursement_documents` linking a new document to their own reimbursement after it was approved and paid | allowed (the policy checks that the reimbursement and the document are theirs, not the status) |
| Anyone | any of the above | no row in `finance_audit_log` (removal logs, registration does not) |

What it means in practice:

- An executive can attach a file to a claim or a reimbursement after the decision, or name someone else as the uploader. The author of a document is therefore not trustworthy, and a decided request can gain evidence after the fact.
- A registered row is what the storage policy trusts to let a member read an object of the bucket (the `finance-private` select policy looks for a `finance_documents` row with the member as `uploaded_by`). A member who knows another member's object path (it contains a random UUID, so it cannot be guessed) can register it and read it. This is plan item P1-05.
- A failed step in the middle of the client sequence leaves a file with no record, or a record with no link. The client does not clean up.

### Why it is left alone now

The upload flow is in production use and the frontend depends on the direct inserts. Changing the grants or policies first would break uploads for everyone; the fix is a new function plus a frontend change in one release, which belongs to Phase 4.2 and not to a database-only fix round.

### What the fix is

One `SECURITY DEFINER` function, `register_finance_document(...)`, with the parent (expense, reimbursement or claim), the storage path, type, title, size and MIME type as arguments. In one transaction it:

- checks the caller is an active member and, for a member, that the parent is theirs and still editable (not decided, not on a submitted or paid claim); for an executive, that the parent is in a status that accepts evidence;
- sets `uploaded_by` to `auth.uid()` and requires `storage_path` to start with the caller's id and the object to exist in `storage.objects` (P1-05);
- inserts the document row and every link, and writes one `finance_audit_log` row;
- then `INSERT` is revoked on the four tables for `authenticated`, the matrix test and `permissions.snapshot` are updated, and `uploadFinanceDocument` in `lib/api/finance.ts` calls the function once (the hook in `features/finance/hooks/use-finance-documents.ts` stays as it is) and removes the uploaded file if it fails.

A test per row of the table above (each must be refused) belongs with that change.

## 2. The membership gate: what it does not do (P0-01, Phase 4.1)

Added with `20261128010000_membership_gate_schema.sql` and `20261128010100_membership_gate_signup_default.sql` (order of release in `docs/RELEASE_ORDER.md`). A new sign-up is `pending` until an active executive or administrator approves it in the Sign-up requests queue; a declined one is `rejected` and stays out until an executive approves it. Tests: `supabase/tests/76_membership_gate*.test.sql`, `supabase/tests/concurrency/76_membership_gate_*.sh`, `tests/component/signup-requests.test.tsx`, `tests/component/shell-membership-gate.test.tsx`. What the gate leaves open on purpose:

- **Anyone with a Google account can create a pending profile.** Decision D1 is "needs an executive's approval", not "restricted to a domain". Each stranger costs one `profiles` and one `auth.users` row and an entry in the queue (the queue lists the 500 oldest waiting; the count in the menu is exact). There is no rate limit and no clean-up of old pending accounts. Fix when it matters: an allowed-domain list checked in `private.handle_new_user`, or a scheduled delete of sign-ups pending for more than N days (`admin_delete_member` already removes one).
- **The first administrator's address is written in `private.handle_new_user` too** (as an exemption from `pending`), next to the place `20260812000000_admin_console.sql` promotes it. Both go with the bootstrap handover of Phase 4.4 (P3-04).
- **Nobody is told.** An executive learns of a sign-up from the count in the menu only (no email); the person learns of an approval by pressing Check again or signing in again. A declined person is not told why: the reason is for executives and is never in any answer a pending or rejected account can read.
- **The queue shows the 50 most recently declined.** An older declined sign-up stays rejected and cannot be approved from the screen (the function still takes it: `review_pending_member(id, true)`), and the person cannot sign up again with the same Google account. An administrator can delete the account so that they start over.
- **The name typed on the sign-up form** (the `sessionStorage` flow) is saved when the portal first opens, which for a new sign-up is after the approval, and only if it is the same browser tab. Otherwise the name from the Google account stays; the person can change it on their profile.
- **The finance functions say "Your access to the portal has been deactivated" to a pending or rejected caller.** They had their own explicit `is_active_member` check before this change. Every table write and every other function says the right thing ("waiting for approval", "not approved"). Cosmetic: the account is refused either way.
- **Approve has no confirmation.** It is one click and an executive can undo a mistake only by deactivating the account (an administrator). Declining is the one that asks (for a reason) and is undone by Approve.
