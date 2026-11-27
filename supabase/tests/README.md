# Database tests

`scripts/db-replay.sh` starts a throwaway PostgreSQL 16 cluster, replays every
file in `supabase/migrations/` from empty, then runs each `*.test.sql` here.
Each test file runs inside `begin; … rollback;` and fails on the first
`assert` that does not hold.

```bash
scripts/db-replay.sh          # replay and test
KEEP=1 scripts/db-replay.sh   # leave the cluster up to poke at it
```

## What this does and does not cover

It covers SQL logic: constraints, triggers, functions and row-level security on
tables, exercised as different signed-in users via `test.login(...)`.

It runs on plain PostgreSQL with small stand-ins for Supabase (`shims.sql`), so
it does **not** cover real Storage behaviour (uploads, deletes, signed URLs),
real Auth (sign-in, sessions, tokens), or anything that differs between these
migration files and the hosted project. Verify those on a separate Supabase
test project before merging changes that depend on them.

## Why there is a bootstrap step

`20260812000000_admin_console.sql` fails unless one specific profile already
exists and revokes a function only hosted Supabase creates. `bootstrap.sql`
provides both just before that migration runs. It is never applied to a real
project.

## The access snapshot

After the tests, the harness prints every table grant, policy and callable
function (`permissions.sql`) and compares it with `permissions.snapshot`. Any
change to who can do what therefore shows up as a diff in review. After a
deliberate change, regenerate it with `UPDATE_SNAPSHOT=1 scripts/db-replay.sh`
and commit the result.

## The grants matrix and new tables

Migration `20261127075000_least_privilege_grants.sql` took the hosted default
grants away. From there on anon and authenticated hold only what is listed in
`72_grants_matrix.test.sql`, and tables and sequences that postgres creates later
start with nothing for those two roles (service_role keeps its default). Two
consequences for anyone adding a migration after it:

- A new table needs its own `grant` lines (`grant select, insert on public.t to authenticated;`
  and nothing broader than the frontend uses) and a row in the matrix of
  `72_grants_matrix.test.sql`. The test fails, naming the table, until it has one,
  and it fails again if a grant is later widened.
- A column default that calls `nextval()` (a `serial` column) needs
  `grant usage on sequence ... to authenticated`. Identity columns need nothing.

`shims.sql` still starts from the hosted defaults, so migrations that run before
the lockdown see what they saw on the hosted project at the time. Function
defaults (EXECUTE for anon and authenticated) are unchanged and are covered by
`70_default_privileges.test.sql`.

Direct writes that a test needs to make on a table the API no longer lets
signed-in users write (to set up a row, or to exercise a trigger) are made as the
table owner: call `test.logout()` first, or run the statement without
`test.login(...)`.
