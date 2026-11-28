# Release order

The deployed frontend and the database are released separately, and for a while they run side by side: the new database under the old frontend, and open browser tabs on the old frontend after the new one is live. A migration that only ADDS (a function, a table, a stricter rule that the old frontend never trips) can go first. A migration that REMOVES something the old frontend uses (a privilege, a policy, a function it calls) or REFUSES something a deployed screen still lets a person do must wait until the frontend that no longer does it is live. A migration of the second kind carries a header that says so, in capitals, and is listed here.

The three steps, always in this order:

1. **Apply before the new frontend.** Everything not listed under "Apply after the frontend is live", in filename order.
2. **Deploy the frontend** and check it (the checks below).
3. **Apply after the frontend is live.** The files listed below, in filename order.

`scripts/db-replay.sh` applies every file in filename order, which is also a valid production order for the whole list (the late files sort after the files they depend on). The point of this file is only that production does steps 1 to 3 with the deploy in the middle.

A new migration that removes or tightens something the deployed frontend relies on goes into the last section, with its header, in the same commit.

## Apply before the new frontend

Everything that is not in the last section. Phase 4.3 and 4.4 (access rules, audit trail): all of these only hide rows from a read the deployed screens do not need, or refuse a write the deployed screens never make (the production frontend, `main`, sends the signed-in person's own id in every actor column it writes: `created_by`, `uploaded_by`, `updated_by`), or add a table:

- `20261128030000_access_executive_only_files.sql` (P0-02): an archive item marked `executives` is no longer readable by the ordinary members of its group, in the table policy, the public (anon) policy and the `club-archive` storage policy; a person's own upload folder in `club-archive` stays readable by its uploader only while they are a current executive; a recording file path must sit in its uploader's own folder (`bind_recording_file_to_uploader`). Adds the check `archive_items_public_not_executives` (NOT VALID, see "Manual steps").
- `20261128030100_attendance_former_member_access.sql` (P1-01): a person who left a group no longer reads that group's sessions, records, excuses, remediations and proof images, and `check_in_attendance` / `submit_attendance_excuse` refuse them. Their own history for groups they belong to is unchanged.
- `20261128030200_actor_columns_guard.sql` (P3-05): the who-columns (`created_by`, `uploaded_by`, `marked_by`, `reviewed_by`, ... 39 columns on 29 tables, listed in `supabase/tests/77_actor_columns.test.sql`) are set from `auth.uid()` by a trigger; a value that names someone else is refused, a write with no signed-in person (migrations, the service role) is left alone.
- `20261128030500_content_audit_log.sql` (4.4): adds `public.content_audit_log`, the statement-level audit triggers on groups, memberships, events, announcements, resources, imports, recordings, notation notes and archive items, and `list_content_audit(p_limit, p_before, p_entity_type)`. No screen reads it yet. One extra insert per audited statement that changed a tracked column (measured in the phase report).

## Deploy the frontend

This phase changes no screen. Deploy the frontend of the release and check it against the database of step 1, signed in as the person named:

- an ordinary member of a group does not see a group file marked "Executives only" in the group's list, and cannot open it by its path;
- an executive still sees and opens it;
- a person who left a group no longer sees that group's attendance history and can still see the groups they are in;
- every save still works: an announcement, an event, an archive upload, a recording (draft and publish), a resource folder and a resource upload, a funding claim (the screens send the person's own id; a refusal here says "... must be the signed-in member");
- an executive who changes a group, event or announcement can then find the change with `select * from list_content_audit(20)` (SQL editor or REST rpc as an executive).

## Apply after the frontend is live

Each of these takes something away that the previous frontend used, or refuses text or a file the previous screens still offer. Applied earlier, the old screens answer with a refusal. Apply them in filename order:

- `20261127075000_least_privilege_grants.sql`: removes INSERT, UPDATE, DELETE and TRUNCATE on the ledger, attendance, audit and group tables from `anon` and `authenticated`. The frontend deployed before this phase still writes some of those tables straight through the REST API.
- `20261127090000_attendance_eligibility_definer.sql`: makes `set_attendance_eligibility` a `SECURITY DEFINER` function and removes the direct INSERT and UPDATE on `attendance_eligibility`.
- `20261128030300_text_length_limits.sql` (4.3/4.4): 56 upper bounds on free-text columns (NOT VALID, see "Manual steps"). A few deployed textareas have no `maxLength` (a recording or event description, the treasurer's note, a notation text); a pasted wall of text is refused with an error toast. Every limit is above what a screen's own `maxLength` allows.
- `20261128030400_close_legacy_transactions.sql` (4.3): revokes the last privilege (SELECT) on the legacy `transactions` ledger from `anon` and `authenticated`. Nothing in this repository reads it; the deployed frontend is not this repository, so this waits for the deploy. The rows stay (owner and service role keep them).
- `20261128030600_storage_bucket_limits.sql` (4.4, P3-01): file size and type lists on `club-archive`, `recordings`, `recording-notations` and `club-resources` (and `public = false`). Refuses an upload over 500 MiB (media), 25 MiB (notation files) or 100 MiB (library), and a type that is not on the list (a web page, an SVG, a script, an executable). Nothing already stored is touched.

## Manual steps that are not migrations

1. **Validate the NOT VALID constraints**, some days after step 3, when no old row is over a limit. They are enforced on every new and every changed row from the moment they exist; an OLD row that is over a limit cannot be edited until it is shortened. Run the query in the header of `20261128030300_text_length_limits.sql` (it counts the rows over each `*_max_length` limit), shorten what it finds, then `alter table public.<table> validate constraint <name>;` (a SHARE UPDATE EXCLUSIVE lock: reads and writes continue). Same for `archive_items_public_not_executives` (rows that are public and executives-only at once: `select id, title from public.archive_items where is_public and visibility = 'executives';`; make them members-only or public deliberately, then validate).
2. **Retention of the audit trail.** `content_audit_log` is append-only, also for the owner (a trigger that fires ALWAYS refuses UPDATE, DELETE and TRUNCATE). To purge old rows, the database owner does it deliberately: `alter table public.content_audit_log disable trigger refuse_content_audit_change;`, delete, `enable trigger` again. Nothing purges it automatically.
3. **Dashboard upload limit.** Supabase has a project-wide upload limit (Storage settings). It applies on top of the bucket limits and the smaller one wins; raise it to at least 500 MiB if recordings of that size are expected.

## Checks after step 3

- Upload a score from a notation program (a `.mscz`, the browser sends `application/octet-stream`) to the library: accepted.
- Upload a `.html` or `.svg` file to the library: refused by the bucket, with a message from the Storage service.
- Record a take in the studio and save it: accepted (`audio/webm;codecs=opus` passes the `audio/*` entry).
- Type 2,500 characters into an event description: refused with an error toast; 1,900 characters is saved.
- As an executive, `select * from public.transactions` answers "permission denied".
