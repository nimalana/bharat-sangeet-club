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
- `20261128030000_access_executive_only_files.sql` (P0-02): an archive item marked `executives` is no longer readable by the ordinary members of its group, in the table policy, the public (anon) policy and the `club-archive` storage policy; a person's own upload folder in `club-archive` stays readable by its uploader only while they are a current executive; a recording file path must sit in its uploader's own folder (`bind_recording_file_to_uploader`). Adds the check `archive_items_public_not_executives` (NOT VALID, see "Manual steps").
- `20261128030100_attendance_former_member_access.sql` (P1-01): a person who left a group no longer reads that group's sessions, records, excuses, remediations and proof images, and `check_in_attendance` / `submit_attendance_excuse` refuse them. Their own history for groups they belong to is unchanged.
- `20261128030200_actor_columns_guard.sql` (P3-05): the who-columns (`created_by`, `uploaded_by`, `marked_by`, `reviewed_by`, ... 39 columns on 29 tables, listed in `supabase/tests/77_actor_columns.test.sql`) are set from `auth.uid()` by a trigger; a value that names someone else is refused, a write with no signed-in person (migrations, the service role) is left alone.
- `20261128030500_content_audit_log.sql` (4.4): adds `public.content_audit_log`, the statement-level audit triggers on groups, memberships, events, announcements, resources, imports, recordings, notation notes and archive items, and `list_content_audit(p_limit, p_before, p_entity_type)`. No screen reads it yet. One extra insert per audited statement that changed a tracked column (measured in the phase report).
- `20261128031000_actor_columns_guard_new_columns.sql` (integration of 4.1, 4.2 and 4.3): the who-columns added by the membership gate (`signup_reviews.decided_by`) and by finance integrity (`finance_expenses.rejected_by`) are guarded like the other 39. Both are written only by definer functions from `auth.uid()`, so no screen notices.

## 2. Deploy the frontend

The branch that carries the shell's Pending and Rejected screens and the Sign-up requests page (`features/shell/components/membership-screens.tsx`, `features/admin/components/signup-requests-panel.tsx`). Check it against the database of step 1: sign in as an executive, open Sign-up requests (it reads `list_pending_members`, which only exists after `20261128010000`); an executive's menu shows the count of people waiting.

Finance (4.2), signed in as a member and as an executive:

- a request with a receipt is saved and its receipt appears on it (one call to `register_finance_document`);
- a club purchase for an event, with its event details, is accepted;
- an executive's own approved request shows "Another executive must pay your own request." and no "Mark paid" button.

Access rules and audit (4.3, 4.4), signed in as the person named:
- an ordinary member of a group does not see a group file marked "Executives only" in the group's list, and cannot open it by its path;
- an executive still sees and opens it;
- a person who left a group no longer sees that group's attendance history and can still see the groups they are in;
- every save still works: an announcement, an event, an archive upload, a recording (draft and publish), a resource folder and a resource upload, a funding claim (the screens send the person's own id; a refusal here says "... must be the signed-in member");
- an executive who changes a group, event or announcement can then find the change with `select * from list_content_audit(20)` (SQL editor or REST rpc as an executive).

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
- `20261128030300_text_length_limits.sql` (4.3/4.4): 56 upper bounds on free-text columns (NOT VALID, see "Manual steps"). A few deployed textareas have no `maxLength` (a recording or event description, the treasurer's note, a notation text); a pasted wall of text is refused with an error toast. Every limit is above what a screen's own `maxLength` allows.
- `20261128030400_close_legacy_transactions.sql` (4.3): revokes the last privilege (SELECT) on the legacy `transactions` ledger from `anon` and `authenticated`. Nothing in this repository reads it; the deployed frontend is not this repository, so this waits for the deploy. The rows stay (owner and service role keep them).
- `20261128030600_storage_bucket_limits.sql` (4.4, P3-01): file size and type lists on `club-archive`, `recordings`, `recording-notations` and `club-resources` (and `public = false`). Refuses an upload over 500 MiB (media), 25 MiB (notation files) or 100 MiB (library), and a type that is not on the list (a web page, an SVG, a script, an executable). Nothing already stored is touched.

## Checks after step 3

- Sign in with a Google account that has never signed in: the portal says "Your sign-up is waiting for approval by a club executive." and nothing else.
- Sign in as an executive: Sign-up requests shows that person, with the count in the menu; Approve them; the other browser's Check again opens the portal.
- Sign in as an existing member, executive and administrator: nothing changed.
- With the pending account's token against the REST API, `GET /rest/v1/profiles` returns only its own row, any other table returns no rows, and any write answers 42501 with "Your sign-up is waiting for approval by a club executive".


- Upload a score from a notation program (a `.mscz`, the browser sends `application/octet-stream`) to the library: accepted.
- Upload a `.html` or `.svg` file to the library: refused by the bucket, with a message from the Storage service.
- Record a take in the studio and save it: accepted (`audio/webm;codecs=opus` passes the `audio/*` entry).
- Type 2,500 characters into an event description: refused with an error toast; 1,900 characters is saved.
- As an executive, `select * from public.transactions` answers "permission denied".

## Manual steps that are not migrations

1. **Validate the NOT VALID constraints**, some days after step 3, when no old row is over a limit. They are enforced on every new and every changed row from the moment they exist; an OLD row that is over a limit cannot be edited until it is shortened. Run the query in the header of `20261128030300_text_length_limits.sql` (it counts the rows over each `*_max_length` limit), shorten what it finds, then `alter table public.<table> validate constraint <name>;` (a SHARE UPDATE EXCLUSIVE lock: reads and writes continue). Same for `archive_items_public_not_executives` (rows that are public and executives-only at once: `select id, title from public.archive_items where is_public and visibility = 'executives';`; make them members-only or public deliberately, then validate).
2. **Retention of the audit trail.** `content_audit_log` is append-only, also for the owner (a trigger that fires ALWAYS refuses UPDATE, DELETE and TRUNCATE). To purge old rows, the database owner does it deliberately: `alter table public.content_audit_log disable trigger refuse_content_audit_change;`, delete, `enable trigger` again. Nothing purges it automatically.
3. **Dashboard upload limit.** Supabase has a project-wide upload limit (Storage settings). It applies on top of the bucket limits and the smaller one wins; raise it to at least 500 MiB if recordings of that size are expected.
