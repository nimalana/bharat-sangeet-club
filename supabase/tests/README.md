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
