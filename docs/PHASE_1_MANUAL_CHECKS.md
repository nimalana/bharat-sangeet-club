# Phase 1 manual checks

The SQL tests cannot exercise Supabase Storage or Auth. Run these on a test
Supabase project (never production) before merging Phase 1. Sign in as three
accounts: an admin, a group manager who is not an executive, and a plain member.

## Before anything else

- [ ] Apply the new migrations (`20261126230000` onward) to the test project in order, **except `20261127075000_least_privilege_grants.sql`, which waits for the new frontend (see Release order below)**. The others are additive; the current production frontend keeps working against them.
- [ ] Compare the test project's schema with production (`supabase db dump --schema public,private,storage`) so drift in production is known before the migrations are applied there.

## Storage deletes (file must go before its row)

- [ ] Recording room: upload a take with a notation file, publish, then Delete. The objects are gone from `recordings` and `recording-notations`, and the rows are gone.
- [ ] Recording room: as a member who is not the uploader, the manage bar is not shown.
- [ ] Recording copied from the legacy archive (bucket `club-archive`): it plays, and it offers Archive but not Delete.
- [ ] Club and concert recordings (executive): edit one, flip it to public and confirm it appears on the signed-out concert page; delete one that has no recording-room copy and confirm the object is gone from `club-archive`.
- [ ] Resources: upload a file, then Delete it as an executive. The object is gone from `club-resources`.
- [ ] Resources: as a group manager who is not an executive, a finished file has no Delete button. Discard a failed upload still works for the manager (migration `20261127043000`: only executives delete finished items).
- [ ] Notation: delete a file note as its author.
- [ ] Notation: member B attaches a notation file to member A's published recording (needs the API; the portal has no control for it). A, who is not an executive, deletes the recording: B's notation file, the take and the row are all gone (migration `20261127044000`).
- [ ] Resources, with the API (the portal has no control for this), as a group manager who is not an executive: `update resources set status = 'failed'` on a ready file is refused ("Only executives can mark a finished resource as failed..."), as is changing its `storage_path`, and a Storage `move` of the file onto the path of one of your own pending uploads returns no row (migration `20261127070000`). Failing and then discarding your own pending upload still works.
- [ ] Abandoned upload (migration `20261127070100`): as a member, upload a file to `recordings/<your user id>/...` through the Storage API without creating the recording row (or make the row insert fail), then `remove([path])`. The object is gone. The same for `recording-notations/<your user id>/...`. Another member, and an executive, cannot see or remove that object; neither can you remove one in someone else's folder. This depends on real Storage: the SQL tests run the same `delete from storage.objects where bucket_id = ... and name = any(...)` statement but cannot prove the Storage service issues exactly that.

## Deactivation

- [ ] Deactivate the plain member while they have the portal open. Their next page load shows the "access has been deactivated" screen, and no data loads.
- [ ] With the deactivated member's still-valid session, try to open a signed URL for a recording and a resource. Both are refused.
- [ ] Reactivate; they can sign in and see club-wide content. Their groups are empty: they can ask to join an open group again (active at once) or an approval group (pending), and an invitation-only group needs an executive. A group they were deliberately removed from still needs an executive (migration `20261127041100`).
- [ ] As a plain member, `select * from member_deactivations` returns no rows and profiles has no reason column. An admin sees the reason (migration `20261127041000`).
- [ ] Delete an account with no history succeeds; an account with a reimbursement shows the "Deactivate it instead" message.
- [ ] The public concert page still works when signed out.

## Groups, calendar, attendance

- [ ] As the group manager: approve, waitlist and decline a join request; rename the group; remove a plain member. Cannot remove another manager.
- [ ] Edit a calendar date and an announcement; pin and unpin.
- [ ] Attendance: edit and delete a draft meeting; clear a mark; void a closed meeting and confirm the member's unexcused total drops; change thresholds; as a member, withdraw a pending absence form.

## Finance (branch `phase-1b-finance`)

Use two executives and one member. Note the Available cash figure before each step.

- [ ] Member submits a request with a receipt, edits the amount, then withdraws a second request. The withdrawn one shows as voided.
- [ ] Executive A requests changes with a note. The member sees the note, adds a new receipt, removes the old one (the file is gone from `finance-private`), and resubmits.
- [ ] Executive A approves a lower amount with a note, marks it paid, then voids the payment. Available cash returns to the earlier figure and the request is back to approved. Pay it again.
- [ ] Executive A submits their own request and cannot approve it; Executive B can.
- [ ] Record a club expense, edit its description, then void it. Its ledger line disappears and Available cash goes back up.
- [ ] Record income, then void it.
- [ ] Build a funding claim from two expenses. Mark ready is refused until the documents are there. Remove and re-add an expense. Submit, mark approved for less than requested, record the payment, void the payment, then void the claim. The expenses can go on a new claim.
- [ ] The five summary cards match a hand total of the ledger.

## Phase 2: load times (branch `phase-2-latency`)

Run the app locally against the test project (`npm run dev`). In the browser console, `__supabaseRequests(true)` prints and clears a table of every Supabase request with its duration.

- [ ] Record the request count and slowest request for Overview, Groups, Recordings, Resources, Attendance, Finance and Members on `main`, then on this branch. Expected on this branch: sign-in to Overview is 1 data request; Attendance is 1 (and 1 per 10 second poll while check-in is open); Finance is 11 in a single parallel wave; Resources is 1 plus 1 per bucket that holds images.
- [ ] Leave the tab open for over an hour (a token refresh). No screen reloads its data on its own.
- [ ] Open Finance, go to Calendar, come back to Finance: the previous data shows at once, with no loading state.
- [ ] Sign out and sign in as a different account: nothing from the first account appears.
- [ ] Recordings: with more than 24 published recordings, "Show more" loads the next 24; search and the group filter narrow the list on the server.
- [ ] Resources: open a PDF and a link in Safari and Chrome; each opens in a new tab without a pop-up warning.
- [ ] Check the Supabase project's region. If it is far from North Carolina, moving it will save more than any change here.

The two revokes that used to be listed here (`funding_claims` insert and update, `funding_claim_expenses` insert, update and delete) are now part of `20261127075000_least_privilege_grants.sql`; see Release order. The third revoke of the original list, `review_subgroup_enrollment`, is not manual either: migration `20261127040000` does it, because the removed status made the old function a way to re-admit a removed member. The deployed main frontend never calls it.

## Release order

`20261127075000_least_privilege_grants.sql` is the migration that breaks the old frontend (the order for every file, with the few that only refuse something with a readable sentence, is in `docs/RELEASE_ORDER.md`, which supersedes this paragraph). It takes write privileges away from `authenticated` (and everything from `anon` except the public concert list) on every table the new frontend does not write directly. The frontend deployed from `main` today still writes `funding_claims` (insert, update) and `funding_claim_expenses` (insert) straight through the REST API, so the order matters:

1. Apply every other migration, including the ones from the finance and attendance branches that sort before `20261127075000`. The production frontend keeps working against them.
2. Deploy the new frontend (the branch with this file) and run the checks above on it.
3. Only then apply `20261127075000`. Applied before step 2, "Build a funding claim" and the claim status buttons in the live site answer "permission denied for table funding_claims" (SQLSTATE 42501) until the new frontend is out.
4. Run the checks under "After the lockdown" below.

If a screen turns out to need a privilege the list missed, give back exactly that one, for example `grant insert on public.some_table to authenticated;`, rather than undoing the file; the row-level policies still decide which rows. Applied migrations are immutable, so make the permanent change as a new migration and add it to the matrix in `supabase/tests/72_grants_matrix.test.sql` (the test fails until both agree).

Undoing it completely means re-granting what the hosted defaults gave: `grant all on all tables in schema public to anon, authenticated;`, `grant all on all sequences in schema public to anon, authenticated;` and `alter default privileges for role postgres in schema public grant all on tables to anon, authenticated;` (and the same for sequences). That reopens the ledger to direct writes; do it only to get a broken release working again.

Adding tables later: with the defaults gone, a migration that creates a table in `public` has to say who may use it (`grant select, insert on public.new_table to authenticated;`, never `grant all`), and the new table needs a row in the matrix of `72_grants_matrix.test.sql`, which fails until it has one. A table with a `serial` column also needs `grant usage on sequence ... to authenticated`; `generated always as identity` columns need nothing.

## After the lockdown (test project, then production)

Run these after applying `20261127075000`, signed in as an executive, a group manager and a plain member. The SQL tests cover the same ground on a scratch database; these confirm it on the real API.

- [ ] Everything the app does still works: post and edit an announcement, add and delete an event, edit your own profile (name, phone, class year, specialty), request to join a group, upload a recording with notation and publish, archive and delete it, add a resource folder, link and file, rename, pin and delete them, check in to a meeting and submit an excuse, record an expense and an income, submit a reimbursement with a receipt, build and update a funding claim, set an eligibility status.
- [ ] Signed out, the home page still lists the public concerts and **Watch or listen** still opens a recording.
- [ ] With an executive's token against the REST API, `PATCH /rest/v1/finance_expenses?id=eq.<id>` and `DELETE /rest/v1/finance_payments?id=eq.<id>` answer 401/403 with code `42501` (permission denied), no longer 200 or 204. The same for `POST /rest/v1/funding_claims` and `PATCH /rest/v1/attendance_sessions?id=eq.<id>`.
- [ ] `PATCH /rest/v1/profiles?id=eq.<own id>` with `{"role":"admin"}` answers `42501` for a plain member; with `{"phone":"1"}` it works.
- [ ] With the anon key only, `GET /rest/v1/archive_items?select=id,title&is_public=eq.true` returns the public concerts and `GET /rest/v1/profiles?select=id` answers `42501`; the OpenAPI document at `/rest/v1/` no longer lists the ledger tables for the anon key.
- [ ] On the hosted project (PostgreSQL 17; the SQL tests ran on 16 only) no table gives anon or authenticated `TRUNCATE`, `REFERENCES`, `TRIGGER` or `MAINTAIN`: `select c.relname, r from pg_class c cross join unnest(array['anon','authenticated']) r where c.relnamespace in ('public'::regnamespace, 'private'::regnamespace) and c.relkind in ('r','p','v','m','f') and (has_table_privilege(r, c.oid, 'truncate') or has_table_privilege(r, c.oid, 'references') or has_table_privilege(r, c.oid, 'trigger') or has_table_privilege(r, c.oid, 'maintain'));` returns no rows, and `select defaclnamespace::regnamespace, defaclobjtype, defaclacl from pg_default_acl;` shows no `anon=` or `authenticated=` entry for tables (`r`) or sequences (`S`).

## Phase 2 follow-up: Resources per folder and the public concert page

Not run against a real project when written (only read, type-checked, unit-tested and built). Use the test project, signed in as an executive, with a few folders three levels deep and, ideally, more than 100 items in one folder.

1. Open `/?page=documents`. Only the top level appears. In the browser network tab there is one `resources` request with `parent_id=is.null`, `limit=100` style range, `order=is_pinned.desc,updated_at.desc,id.desc`, and no request for the whole table.
2. Click a folder. The address bar becomes `?page=documents&folder=<id>`. The breadcrumb shows the path. Reload the page: the same folder opens. Press Back: the previous folder opens.
3. Open a folder with more than 100 items. Click **Show more**: the next rows are added with no repeats. Pinned items stay first.
4. Type in the search box. Nothing is requested while typing; about 250 ms after the last key one request with `ilike` on title, description and file name appears. It finds items in subfolders of the open folder. Clear search returns to the folder.
5. Click the Documents, Links and Photos tabs inside a folder: each one request, filtered on the server. The active tab shows a count; the other tabs show no count (they are not loaded).
6. Change the scope dropdown: the view returns to the top, filtered by that group or club-wide.
7. Image thumbnails: in a folder with photos there is one `createSignedUrls` request per bucket. Leave and come back within an hour: no new signing request, and the list shows at once.
8. Actions, each from the detail panel, on an item and on a folder you have never opened: Rename, Pin/Unpin (item moves to the top), Limit to executives / Share with members (top-level folder), Archive, Show archived, Restore, Delete (a folder with contents has no Delete; an empty one does), and Discard upload on a failed upload. After each, the list refreshes and the count and breadcrumb are correct. Archive the folder you are inside: you land in its parent.
9. Upload a file and a folder into an open folder: rows appear, finish as ready, and the list matches after a reload. Uploading into a third-level folder with a nested folder is refused with the existing message.
10. Open `?page=documents&folder=999999999`: "That folder could not be found" and the top level opens.
11. Signed out, open `/`. The page source (View Source, not the inspector) contains the concert titles. Reload twice within 5 minutes: no change. Make a recording public as an executive: it appears within about 5 minutes (a redeploy shows it at once). No signed URL appears in the page source. Click **Watch or listen**: a signed URL is requested then (network tab, `club-archive`, 600 seconds expiry) and the file opens.
12. Signed in as a member, reload `/`: the dashboard opens as before. A brief view of the public page before the scripts load is expected on a first visit.
