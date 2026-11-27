# Phase 1 manual checks

The SQL tests cannot exercise Supabase Storage or Auth. Run these on a test
Supabase project (never production) before merging Phase 1. Sign in as three
accounts: an admin, a group manager who is not an executive, and a plain member.

## Before anything else

- [ ] Apply the new migrations (`20261126230000` onward) to the test project in order. They are additive; the current production frontend keeps working against them.
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

After Phase 1 is live in production (not before, because the current production frontend still writes these tables directly), run:

```sql
revoke insert, update on public.funding_claims from authenticated;
revoke insert, update, delete on public.funding_claim_expenses from authenticated;
```

The third revoke of the original list, `review_subgroup_enrollment`, is no longer manual: migration `20261127040000` does it, because the removed status made the old function a way to re-admit a removed member. The deployed main frontend never calls it.

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
