# Runbook

How to run, change and repair the Bharat Sangeet portal. It is written for the person who holds the keys (today, the project owner) and for whoever takes over from them. The things only the owner can do in the Supabase, Vercel and Google dashboards are in `docs/OWNER_CHECKLIST.md`; this file refers to it instead of repeating it.

Nothing in this repository holds a key, a password or the address of the production project, and this file does not either: wherever a project reference, a key or a connection string is needed it is written as `<...>` and comes from the dashboards (Supabase: Project Settings; Vercel: the project's Environment Variables).

Last written 28 Nov 2026 against the branch `phase-4-platform`. SQL given here was checked for syntax against the local replay database (`scripts/db-replay.sh`); statements that need a real Supabase project (Auth, Storage, backups) were not run and are marked as such.

## Contents

1. [What runs where](#1-what-runs-where)
2. [Deploy](#2-deploy)
3. [Roll back](#3-roll-back)
4. [Restore from a backup](#4-restore-from-a-backup)
5. [Administrator handover](#5-administrator-handover)
6. [Key rotation](#6-key-rotation)
7. [The SQL suites, the contract check and the other tests](#7-the-sql-suites-the-contract-check-and-the-other-tests)
8. [Reading the audit logs](#8-reading-the-audit-logs)
9. [Finding and removing a stuck user](#9-finding-and-removing-a-stuck-user)
10. [The project is paused](#10-the-project-is-paused)
11. [Something is wrong in production](#11-something-is-wrong-in-production)

## 1. What runs where

| Piece | Where | Notes |
|---|---|---|
| The website (Next.js, static landing page rebuilt every five minutes, the portal in the browser) | Vercel. `main` deploys to Production, every other branch to a Preview | Needs two environment variables, both public by design: `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. They are copied into the page at build time: changing one needs a new deployment |
| Database, sign-in, files | One Supabase project | Production is a different project from the test project (`bharat-sangeet-test`). The browser talks to Supabase directly; row-level security decides what a person may read and write |
| Sign-in | Google, through Supabase Auth | A new person is `pending` until an executive approves them (Sign-up requests) |
| The test project | A second Supabase project | The browser suite and the API suite run only against it. Never point a test at production |

Every Preview deployment of a branch uses whatever Supabase project its environment variables name. Check which, before anyone clicks through a Preview: with Production's variables it writes to the real data.

There is no server of our own to look after: no cron, no queue, no worker. When something is down it is Vercel, Supabase or Google.

## 2. Deploy

The rule behind the order is in `docs/RELEASE_ORDER.md`; read its introduction once. In short: the site and the database are released separately, so for a while the old site runs against the new database or the new site against the old one. A migration that only adds things goes first; one that removes or refuses something goes last.

Before anything:

1. The pull request is green in GitHub Actions: `app` (types, tests, build, bundle size, lint ratchet, import boundaries, knip), `contract` (frontend against the migrated database, types drift) and `database` (all migrations replayed, all SQL suites). If branch protection is on (OWNER_CHECKLIST, "Protect `main`") it cannot be merged otherwise.
2. `docs/RELEASE_ORDER.md` lists every new migration in one of its three sections. If a new migration file is not listed, stop and ask who wrote it.
3. A backup exists from today (see section 4) or the plan has no backup (then take a dump first: `docs/ops-templates/nightly-backup.yml` run by hand, or `pg_dump` from your machine).

### The three steps

**Step 1: apply the migrations of section 1 ("Apply before the new frontend").** They only add things; the live site does not notice.

- Open the Supabase dashboard of the production project, SQL Editor, paste ONE file, run it, read the result. Go in file-name order. Each file is one transaction: if it fails, nothing of it stays; fix the cause, never edit the file (a migration that has been applied anywhere is immutable): write a new migration with a later timestamp.
- The editor does not record which files ran. Keep your own list (the pull request description is a good place), and when in doubt look for the object the file creates (the table below).
- A file that has already been applied is written to be safe to run twice (`create or replace`, `if exists`); do not rely on that for a file that is not in the list.

| Migration | An object that exists only after it | Check |
|---|---|---|
| `20261128010000_membership_gate_schema.sql` | function `list_pending_members` | `select to_regprocedure('public.list_pending_members()') is not null;` |
| `20261128020000_finance_register_document.sql` | function `register_finance_document` | `select count(*) from pg_proc where proname = 'register_finance_document';` |
| `20261128030500_content_audit_log.sql` | table `content_audit_log` | `select to_regclass('public.content_audit_log') is not null;` |

(Any file of the repository can be checked the same way: find a table or function it creates with `grep -n "create" supabase/migrations/<file>`.)

**Step 2: deploy the frontend.** Merge the pull request into `main`; Vercel builds and promotes it (a minute or two). Then do the checks written under "2. Deploy the frontend" of `docs/RELEASE_ORDER.md`: sign in as an executive, open Sign-up requests, upload a receipt, and so on. Do not go on until they pass.

**Step 3: apply the migrations of section 3 ("Apply after the frontend is live").** Same way as step 1, one file at a time, then the "Checks after step 3" of `docs/RELEASE_ORDER.md`. These are the ones that refuse what the old site still did; applied earlier, the live site shows errors. After the last one, do the manual steps at the end of RELEASE_ORDER (validate the NOT VALID constraints a few days later).

Anything the deployment changes that is not code: environment variables (Vercel, Settings, Environment Variables; then redeploy), Auth settings (Supabase, Authentication). They have their own list in OWNER_CHECKLIST.

### After a deployment

Open the site signed out (the concert archive loads, "Watch or listen" opens a recording), sign in as yourself, open each menu entry once. In the browser's developer tools, Console, there should be no red lines. The site sends a Content-Security-Policy (`next.config.ts`): a blocked load shows up there as "Refused to ... because it violates the following Content Security Policy directive". If a new feature needs a new source, add it to `next.config.ts` with a reason, and the test `tests/security-headers.test.mjs` with it.

## 3. Roll back

**The frontend.** Vercel, the project, Deployments: open the last good Production deployment and choose "Promote to Production" (or Instant Rollback). The previous build is served again at once; the database is untouched. The branch `main` still holds the bad commit: revert it in Git afterwards, or the next push redeploys the bad code.

Whether the old frontend works against the current database depends on what has been applied:

- After step 1 only: always fine, nothing was removed.
- After step 3: an older frontend meets a database that refuses things it used to do. `docs/RELEASE_ORDER.md` says, for each file of section 3, what the old frontend shows. Read that file before promoting an old deployment. Usually it is better to fix forward than to roll back across step 3.

**The database.** An applied migration is never edited or deleted. The undo of a migration is another migration:

- the grants lockdown: give back exactly the privilege a screen needs (`docs/PHASE_1_MANUAL_CHECKS.md`, "Release order", has the statements, including the complete undo);
- the sign-up gate: two statements, written in `docs/RELEASE_ORDER.md` under `20261128010100`;
- a text length limit or a check constraint that refuses real data: `alter table public.<table> drop constraint <name>;`, then a new migration that restates the limit you want;
- anything else: write the reverse as a new migration, run it through the local replay (`scripts/db-replay.sh`) and the pull request checks first, then apply it.

If the data itself was damaged (a bad bulk update, a delete), it is a restore, section 4.

## 4. Restore from a backup

Know before you need it: **a database backup does not contain the files.** Receipts, recordings, library files and notation files live in Storage; a restore brings back the rows that point at them, not the files. A deleted file is gone unless somebody kept a copy. Deciding how the files are kept is an open decision (OWNER_CHECKLIST, "Backups and point-in-time recovery").

What the plan gives (check the billing page of the organisation; this was true when written):

| Plan | Backups |
|---|---|
| Free | No dashboard backups. Only what you dump yourself (`docs/ops-templates/nightly-backup.yml`) |
| Pro | A daily backup, kept for a week, restorable from the dashboard |
| Add-on | Point-in-time recovery: restore to any second of the last days |

**A. Restore from the dashboard (Pro and above).** Supabase dashboard, Database, Backups. Choose the backup or, with point-in-time recovery, the moment (the minute before the damage; read the time from `admin_audit_log` / `finance_audit_log` / `content_audit_log`, section 8). The restore replaces the whole database and takes the site offline while it runs; everything written after the chosen moment is lost, including sign-ups and uploads. Do it when nobody is using the portal; tell the executives first. Afterwards sign in, run the checks of section 2 and look for what was lost since the backup (finance entries made in between have to be entered again; their receipt files may still be in Storage).

**B. Restore from a dump you made (any plan).** Not tested against a real project when this was written: rehearse it once on a scratch project before you rely on it (OWNER_CHECKLIST lists it).

1. Create a NEW Supabase project (do not overwrite the damaged one until the new one is proved). Enable the same Auth providers and settings.
2. Apply the migrations in order (section 2, step 1 style), then restore the data of `auth.users`, `auth.identities` and the `public` tables from the dump with a data-only restore (`pg_restore --data-only --no-owner --no-privileges -d "<new project's connection string>" backup.dump`). The migration `20260812000000_admin_console.sql` stops with "Cannot bootstrap administrator" unless the profile of the first administrator already exists; on a project built from nothing, sign that person in once and promote them after, as `supabase/tests/bootstrap.sql` does for the replay.
3. Triggers: the audit and actor-guard triggers fire while data loads. Restore `content_audit_log` and the other audit tables last, after emptying what the load itself wrote.
4. Copy the Storage files over from wherever you keep them (they are not in the dump).
5. Point Vercel at the new project (the two environment variables), redeploy, run section 2's checks. Keep the old project until you are sure.

The dump itself: `pg_dump "<connection string>" --format=custom --no-owner --no-privileges --schema=public --schema=auth --file=backup.dump`. The connection string is in the dashboard, Project Settings, Database, "Connection string" (use the session pooler or the direct address; it holds the database password: never commit it, keep it in a repository secret).

## 5. Administrator handover

Why this is a procedure and not an edit. The address of the club's first administrator is written, as plain text, in two applied migrations: `20260812000000_admin_console.sql` (it promoted that profile to administrator once, in 2026) and `20261128010100_membership_gate_signup_default.sql` (inside `private.handle_new_user`: that address is never made `pending`). An applied migration cannot be edited, and the first one has already done its work. The handover is therefore: **make a second administrator, check, then change the first account.** Never the other way round.

**There must always be at least two active administrators.** The functions refuse to demote, delete or deactivate the last one ("The last administrator cannot be demoted"), but that only protects one account against itself: with exactly one administrator whose Google account is lost or locked, only the dashboard's SQL editor can repair it (the break-glass below). Keep two, and check this after every change:

```sql
-- SQL editor (runs as the database owner). Must return at least 2 rows.
select id, email, full_name, status, role from public.profiles where role = 'admin' and status = 'active' order by email;
```

### Step 1: the new person exists and is active

They sign in with Google once. They are `pending`; an executive or administrator opens Sign-up requests in the portal and presses Approve. Check:

```sql
select id, email, full_name, role, status from public.profiles where lower(email) = lower('<their address>');
-- status must be 'active'; role is 'member' for now
```

### Step 2: make them an administrator

Preferred, because it writes the audit row itself: the current administrator opens Admin, finds the member, sets the role to Administrator.

Fallback in the SQL editor, when nobody can use the portal (the editor has no signed-in user, so the guard that refuses role changes from outside the portal lets the statement through; the portal functions refuse the editor, which is why the audit row is written by hand):

```sql
begin;
update public.profiles set role = 'admin' where id = '<new person id>' and status = 'active' returning id, email, role;
insert into public.admin_audit_log (action, actor_id, actor_email, target_id, target_email, details)
select 'role_changed', null, 'sql editor (handover)', id, email, jsonb_build_object('previous_role', 'member', 'new_role', 'admin')
from public.profiles where id = '<new person id>';
commit;
```

Run the check query above: two or more rows.

### Step 3: the new administrator proves it

They sign in on their own device, open Admin, and see the member list and "Recent admin activity". An executive does not see Admin; if they do not, the role did not take.

### Step 4: change the first account

Now the first administrator may stop being one: Admin, their row, role Executive or Member (or Deactivate, or remove the account if they have no history: "Remove" refuses an account with finance or recording history and says to deactivate it). The functions refuse this while they are the last active administrator, which is why step 2 comes first.

### Step 5: take the address out of the next sign-up path (a database change: not made here)

After step 4 the old address still has one effect: if anyone signs up with it, `private.handle_new_user` makes the profile `active` at once instead of `pending`, as a plain member. If that mailbox is ever reused or taken over, it skips the approval queue. Closing this takes a NEW migration; this repository does not contain it yet. Its content is exactly the current function without the exemption:

```sql
create or replace function private.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, full_name, status)
  values (new.id, coalesce(new.email, ''), coalesce(new.raw_user_meta_data ->> 'full_name', ''), 'pending');
  return new;
end;
$$;
revoke all on function private.handle_new_user() from public;
```

Put it in a migration file with a header saying that it goes after the handover (RELEASE_ORDER, section 3), and run the SQL suites: `supabase/tests/76_membership_gate*.test.sql` pin the exemption today and will need the matching change. The coordinator of the database work schedules it; until then the exemption is harmless as long as the old mailbox is controlled by the club.

### Break-glass: the only administrator cannot sign in

The Supabase dashboard login of the project owner is independent of the portal. In the SQL editor, find any active person (the new owner, an executive), and promote them with the statement of step 2. If the person has not signed in yet, they are `pending`: after they sign in once, approve them with `update public.profiles set status = 'active' where id = '<id>' and status = 'pending';` (the editor has no signed-in user, so the sign-up guard lets it through), then promote. Write down who did it and why.

## 6. Key rotation

What is secret and what is not. The two values the website uses are public by design: `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` are inside every visitor's browser; the database's row-level security is what protects the data. Rotate them for hygiene or if the project's quota is being abused, not because someone saw them. The secrets are the secret ("service") key, the database password and the Google client secret.

| Secret | Where it lives | Rotate |
|---|---|---|
| Publishable key | Vercel env var `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (every environment); it is public | Supabase dashboard, Project Settings, API Keys: create a new publishable key. In Vercel replace the variable in Production, Preview and Development, and **redeploy** (the value is compiled into the page; changing the variable alone changes nothing). Check the site works; then delete the old key in Supabase. Until the old key is deleted both work, so there is no downtime |
| Secret ("service") key | Nowhere in this repository or in Vercel; the app never uses it. Held by the owner for maintenance scripts (the cleanup scripts of `scripts/e2e` use it only on the test project) | Dashboard, API Keys, secret keys: create a new one, update whoever uses it, delete the old one. If it ever appeared in a repository, a chat or a log, rotate at once: it bypasses every row-level security rule |
| Database password | The owner's password manager; the repository secret `SUPABASE_DB_URL` of the nightly backup (once enabled) | Dashboard, Project Settings, Database, reset the password; put the new connection string into the GitHub secret. The website does not use the database password |
| Google client secret | Google Cloud Console and the Supabase dashboard | Google Cloud Console, APIs and Services, Credentials, the OAuth client used for the portal: add a second secret (Google allows two at once). Supabase dashboard, Authentication, Sign In / Providers, Google: paste the new secret, save. Sign out and in again to prove it. Back in Google, disable the old secret. No redeploy |
| JWT signing key (signs every session) | Supabase | Dashboard, Authentication, JWT Keys: rotate. Everybody's session stops working when the old key is revoked, so everybody signs in again. This is the heavy tool for "someone stole a session"; deactivating one member (Admin) is the light one, and it blocks the account's data at once through row-level security though its token stays valid until it expires |
| Vercel and GitHub access | Their own settings | Remove people who left; keep two owners |

After any rotation: sign in, open the portal's menu, open a recording and a receipt (those use signed Storage links), and check the browser console for red lines.

## 7. The SQL suites, the contract check and the other tests

Everything below runs on a laptop or in CI, needs no network and no Supabase project, and none of it can touch production. `npm test` (types excluded) runs the unit and component tests; the others are separate.

| What | How | What it proves |
|---|---|---|
| Unit and component tests | `npm test` | Pure logic and every screen against a fake Supabase client. Includes `tests/security-headers.test.mjs`, the headers |
| Types | `npx tsc --noEmit` | |
| Lint, boundaries, dead code | `npm run lint:ratchet`, `npm run lint:boundaries:selftest`, `npm run knip` | Counts may only fall; which folder may import which; no unused file or export |
| All migrations and SQL suites | `scripts/db-replay.sh` | Builds a throwaway PostgreSQL 16 from empty, applies every migration, runs `supabase/tests/*.test.sql` (each in a transaction), compares `supabase/tests/permissions.snapshot` (every grant, policy and callable function), runs the two-session concurrency scripts. Needs the PostgreSQL 16 server binaries (`/usr/lib/postgresql/16/bin`). Several can run at once with `PGPORT=54331 scripts/db-replay.sh`. `KEEP=1` leaves the cluster running; `UPDATE_SNAPSHOT=1` rewrites the snapshot after an intended permission change, and the diff is what you review |
| Contract check | `npm run test:contract` (add `:selftest` to prove it still catches each kind of break) | Every table, column, RPC argument, bucket, grant and CHECK value the frontend uses exists in the migrated database and may be used by the role that uses it (`docs/CONTRACT_CHECK.md`). `PGPORT=54431 npm run test:contract` picks the port |
| Types against the database | `npm run test:types-drift` | `lib/database.types.ts` equals what the migrations produce |
| Bundle size | `npm run build` then `npm run report:bundle -- --compare docs/bundle-baseline.json` | No route grew by more than 5 kB (CI sets `NEXT_PUBLIC_SUPABASE_URL=https://example.supabase.co` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=ci-placeholder` for the build and this report) |
| API-level suite | `node scripts/e2e/run.mjs` against the TEST project | Real Auth and Storage: roles, uploads, deletes, the finance lifecycle (`scripts/e2e/README.md`) |
| Browser suite | `npm run test:browser` against the TEST project | A real Chromium walks the built portal as every role, including the security headers (`tests/browser/README.md`). Every run leaves rows marked `[e2e]` on the test project: clean up as `scripts/e2e/README.md` says. Do not run two at once: they share the project |

What none of the local checks can show: real Supabase Auth (sign-in, sessions), real Storage (uploads, signed links), real Google sign-in, behaviour on production's actual data and settings. Those are the test project's job and the owner's manual list.

## 8. Reading the audit logs

Three trails, three tables. In the dashboard's SQL editor you run as the database owner and see everything. An executive reads the same data through the portal's own screens and functions.

**Who changed a member** (`public.admin_audit_log`; written by the administrator functions): actions `role_changed`, `member_deleted`, `member_updated`, `member_deactivated`, `member_reactivated`, `signup_approved`, `signup_declined`.

```sql
select created_at, action, actor_email, target_email, details
from public.admin_audit_log order by id desc limit 50;
-- one person's history
select created_at, action, actor_email, details from public.admin_audit_log where lower(target_email) = lower('<address>') order by id;
```

The Admin page of the portal shows the last 20 as "Recent admin activity". Sign-up decisions with their reasons are also in `public.signup_reviews` (executives read it through the queue; the reason is never shown to the person).

**Who did what with money** (`public.finance_audit_log`; written by the finance functions): one row for every state change, with the row before and after.

```sql
select l.created_at, l.entity_type, l.entity_id, l.action, p.email as actor, l.before_data, l.after_data
from public.finance_audit_log l left join public.profiles p on p.id = l.actor_id
order by l.id desc limit 50;
-- everything that happened to one expense (entity_type is the table: finance_expenses, finance_payments, funding_claims, ...)
select * from public.finance_audit_log where entity_type = 'finance_expenses' and entity_id = <id> order by id;
```

**Who changed content** (`public.content_audit_log`; written by triggers on groups, memberships, events, announcements, resources, imports, recordings, notation notes and archive items). One row says when, who (`actor_id`, null for a migration or maintenance), which kind of thing and which one, what happened, and the changed columns (`details`). An update that changes nothing worth recording writes nothing, and a statement that touches more than ten rows writes one summary row.

```sql
-- as the owner in the SQL editor
select c.occurred_at, p.email as actor, c.entity_type, c.entity_id, c.label, c.action, c.row_count, c.details
from public.content_audit_log c left join public.profiles p on p.id = c.actor_id
order by c.id desc limit 50;
```

The function `list_content_audit(p_limit, p_before, p_entity_type)` is the same list for an executive's session (REST `rpc/list_content_audit`; it pages by `id` with `p_before`). It refuses a caller who is not signed in as an executive, and the SQL editor is not one: use the table in the editor, or run the function from the editor with its user impersonation switched to an executive. The log is append-only even for the owner: purging old rows is a deliberate act (`docs/RELEASE_ORDER.md`, "Manual steps": disable the trigger, delete, enable it again). Nothing deletes anything by itself.

**Platform logs** (what the database did, not what the portal recorded): Supabase dashboard, Logs: API (every request, with status), Auth (sign-ins and failures), Postgres, Storage. How long they are kept depends on the plan (a day on the free plan). Vercel: the project's Logs and Runtime Logs for the website itself.

## 9. Finding and removing a stuck user

"Stuck" is one of five things. Start with the first query.

```sql
-- Everyone who is not an ordinary active member, oldest first
select id, email, full_name, role, status, joined_at from public.profiles where status <> 'active' order by joined_at;
```

1. **Pending, waiting for an executive.** The normal case. Executives see them under Sign-up requests (the menu shows the count). Approve or Decline there. A declined person is `rejected`; the queue shows the last 50 of those and Approve undoes it.
2. **Pending for ever, nobody will approve (a stranger, a duplicate, a typo).** Remove the account so it stops being counted. In the portal an administrator can remove it (Admin, the member's row, Remove). In the SQL editor, only a sign-up that was never approved, so nothing can depend on it:
   ```sql
   delete from auth.users where id = '<id>' and id in (select id from public.profiles where status in ('pending', 'rejected'));
   ```
   This cascades to the profile. The person can sign up again with the same Google account.
3. **A member who cannot sign in or sees "We could not load your club profile".** Check their row: `status` `deactivated` shows the deactivation screen; `pending` shows the waiting screen; no row at all means the account exists in Authentication but has no profile (query below). A person who is `active` and still stuck: ask them to sign out, close the tab, sign in again; then look at Logs, Auth, for their address.
   ```sql
   -- accounts that exist in Authentication but have no profile
   select u.id, u.email, u.created_at from auth.users u left join public.profiles p on p.id = u.id where p.id is null;
   ```
   The sign-up trigger creates the profile in the same transaction as the account, so this list should always be empty. If it is not, say so in the incident notes before deleting anything; deleting such an account (Authentication, Users, Delete) lets the person sign up again cleanly.
4. **A member who left the club and has history.** "Remove" refuses an account with finance or recording history: "This member has finance or recording history, so the account cannot be deleted. Deactivate it instead." Deactivate (Admin, their row). Their data stays, their access stops at once, they lose their group memberships, and an administrator can reactivate them.
5. **Which rows block a delete.** If you must know why: the references to `public.profiles` and `auth.users` that are not `on delete cascade` or `set null` are the finance and recording records. In the editor: `select conrelid::regclass, conname from pg_constraint where confrelid = 'public.profiles'::regclass and confdeltype not in ('c', 'n');`.

Never delete the last administrator (the function refuses), and never delete from `profiles` directly: deleting the row in `auth.users` is what cascades.

## 10. The project is paused

On the free plan Supabase pauses a project after about a week without activity. While it is paused the portal shows its load-error screens, the sign-in does not complete, and the public landing page shows an empty concert archive (the server cannot read the list; the page itself still loads).

1. Sign in to the Supabase dashboard as the owner. The project shows "Paused" with a **Restore project** button. Press it; restoring takes a few minutes. Nothing is lost: a paused project keeps its data (for a limited time; check how long on the project page, and download a backup if the date is near).
2. Wait for the status "Healthy", then sign in to the portal and run the checks of section 2.
3. Stop it happening again: either upgrade to a plan that does not pause (OWNER_CHECKLIST, "Pausing") or switch on the keep-alive (`docs/ops-templates/keep-alive.yml`; it is a draft and not active). A keep-alive is a workaround for a plan limit; the owner decides.

## 11. Something is wrong in production

The first ten minutes. Write down what you saw and the time; every step below leaves a trail.

1. **Say what is broken.** Everyone or one person? The public page, the sign-in, one screen, a write? Open the site in a private window, signed out, then signed in as yourself.
2. **Is it a platform?** `status.supabase.com`, `www.vercel-status.com`, Google's status page. If it is theirs, you wait and tell the executives.
3. **Did it start with a deployment?** Vercel, Deployments: compare the time. If yes, roll back (section 3); it is the fastest repair and does not touch data.
4. **Did it start with a migration?** Compare with your list from section 2. Do not edit it. Decide: a small fix-forward migration, or the undo of section 3.
5. **Read the logs.** Supabase, Logs, API, filtered to status 400 and above; Postgres logs for errors; Auth logs for sign-in failures; the person's browser console (red lines) for the policy and network errors. Quote the exact text when you ask for help.
6. **Is somebody doing something they should not?** Read the audit logs (section 8). Deactivate the account (Admin, Deactivate): it blocks all their data through row-level security at once, though their sign-in token stays valid until it expires. If you think a session was stolen, rotate the JWT signing key (section 6). If a secret leaked, rotate that secret (section 6).
7. **Data lost or damaged?** Do not write anything more to the table; section 4. Know the time, and decide whether the files are affected.
8. **Tell people.** The executives, in the channel they use, what is known and when the next update is. After it is repaired, write down what happened, what fixed it and what would have prevented it, and add it to `docs/KNOWN_GAPS.md` if a gap is still open.

What is not monitored today: nobody is told when the site or the database fails, when a deployment breaks, or when a workflow fails in the browser (a failed upload shows a toast and nothing is recorded). The options are in `docs/ops-templates/error-reporting-options.md`; choosing one is the owner's decision.
