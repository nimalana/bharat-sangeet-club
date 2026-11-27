# API-level end-to-end suite

Plain Node (ESM) and `@supabase/supabase-js`. It signs in as real (synthetic) accounts on a Supabase **test** project and
makes the same calls the app makes: PostgREST queries, RPCs, Storage uploads, signed URLs and deletes. No browser, no mocks.

It creates and deletes rows. `lib/config.mjs` refuses to run against the production project refs, and every row it creates is
marked `[e2e]` (or belongs to an `e2e-*@example.com` account) so it can be found and removed again.

## One-time setup

1. Generate the accounts (10 synthetic users: admin, two executives, a group manager, a leader, two members, one to deactivate,
   one with finance history, one with none, plus a disposable one that the last section deletes):

   ```
   node scripts/e2e/gen-setup-sql.mjs > /tmp/e2e-setup.sql
   ```

   Passwords are generated into `/tmp/claude-0/e2e/secrets.json` (override with `E2E_SECRETS`). They are never written into the
   repository. The SQL is idempotent: accounts that exist are skipped.
2. Run `/tmp/e2e-setup.sql` on the **test** project (SQL editor). It inserts `auth.users` and `auth.identities`; the signup trigger
   creates the profiles. Run it again whenever `tests/90-admin-delete.mjs` has used up the disposable account (the section then
   skips that test and says so).

## Running

```
SUPABASE_URL=https://<test-ref>.supabase.co \
SUPABASE_KEY=sb_publishable_...            \
NODE_USE_ENV_PROXY=1 NODE_NO_WARNINGS=1    \
node scripts/e2e/run.mjs [--only groups,finance] [--json out.json]
```

* `NODE_USE_ENV_PROXY=1` is needed behind an HTTP proxy (Node's `fetch` ignores `HTTPS_PROXY` otherwise). Keep concurrency modest;
  some proxies answer 429 to many parallel connections.
* `--only` takes section-name fragments (`finance`, `60`, `anonymous`). Section 10 creates the groups that 30 to 90 use, so list it
  too when you run one of the later sections alone: `--only "10 groups,60 finance"`.
* Exit code 1 means at least one test failed. `NOTE` lines are observations (known or suspected issues recorded without failing).
* Optional: `SUPABASE_LEGACY_ANON_KEY` (never commit it) adds a comparison of the public concert request with the legacy JWT.

| Section | What it covers |
|---|---|
| 00 accounts | sign-in, profile trigger, role escalation refused, admin promotes executives, directory |
| 10 groups | join requests approved by a non-executive manager (member sees the workspace in the same session), waitlist, decline, removal, a removed member cannot rejoin an open group |
| 20 calendar | event and announcement create, edit (`updated_at`), pin, delete, visibility, cross-executive edit |
| 30 recordings | upload via Storage, draft, publish, notation file, delete in the app's order, non-uploader refused, legacy club-archive copy plays and is archive-only |
| 40 resources | folders, import batch, upload, the app's own list query, rename, visibility, archive, restore, delete, discard a failed upload, group manager rights, links |
| 50 attendance | draft edit/delete, open, rotate code, check in, mark, clear, absence forms, close, void and totals, thresholds |
| 60 finance | reimbursement lifecycle with receipts in `finance-private`, club expense, income, funding claims, the five summary cards against a hand-computed ledger, the `create_funding_claim` race |
| 70 deactivation | a deactivated member with a valid session is refused everywhere; reactivation |
| 80 anonymous | public concert archive works for a visitor; every table, RPC and bucket in `inventory.json` refuses a visitor |
| 90 admin delete | `admin_delete_member` message for an account with history; clean delete without |

Storage deletes are proven gone three ways: the object is no longer listed, no new signed URL can be made, and a signed URL made
**before** the delete but never fetched no longer downloads. (A URL that was fetched before the delete can still be served by the
CDN cache; the suite does not treat that as proof either way, and lists such cases in section 90.)

## Cleaning up

Money is never hard-deleted by the app, so a run leaves finance rows behind. In this order:

1. `node scripts/e2e/cleanup.mjs` removes leftover storage objects through the Storage API (a SQL delete would leave the file
   in object storage). Run it **before** the SQL: some bucket policies only allow a delete while the row still exists. Files that no
   row refers to any more (the finance-private file-delete defect leaves such files) cannot be listed; pass them with `--paths orphans.json`, produced by
   `select bucket_id as bucket, name as path from storage.objects where owner_id in (select id::text from auth.users where email like 'e2e-%@example.com')`.
2. `cleanup.sql` deletes every `[e2e]` row, in foreign-key order, in one transaction. It keeps the accounts.
3. `cleanup-check.sql` lists what is left (all zero apart from the accounts).
4. `cleanup-accounts.sql` removes the accounts themselves when you retire the fixtures.

## Other files

* `latency.mjs`: 10 timed runs per screen call, as a member and as an executive, each paired with `GET auth/v1/health` as the network
  floor; also records the gateway's `x-envoy-upstream-service-time` (server-side share). `node scripts/e2e/latency.mjs --json out.json`.
* `inventory.sql` / `inventory.json`: the table, function and bucket list the anonymous sweep covers. Regenerate after a migration
  adds a table or function.
* `lib/`: config, a request log attached to failures (no auth headers), assertions, fixtures, storage helpers.
* The harness imports `lib/resources-query.ts` and `lib/public-concerts.ts` from the app, so the list and public-archive requests are
  the app's own (Node strips the types).

## Not covered

Google sign-in, the browser UI and everything rendered by it, real email delivery, Realtime, edge functions, and anything that needs
the production project or its data volume. Authentication here is email and password on a test project.
