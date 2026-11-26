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
- [ ] Resources: discard a failed upload.
- [ ] Notation: delete a file note as its author.

## Deactivation

- [ ] Deactivate the plain member while they have the portal open. Their next page load shows the "access has been deactivated" screen, and no data loads.
- [ ] With the deactivated member's still-valid session, try to open a signed URL for a recording and a resource. Both are refused.
- [ ] Reactivate; they can sign in and see club-wide content, and their groups are empty until re-added.
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
