# API-level end-to-end suite

Plain Node (ESM) and `@supabase/supabase-js`. It signs in as real (synthetic) accounts on a Supabase **test** project and
makes the same calls the app makes: PostgREST queries, RPCs, Storage uploads, signed URLs and deletes. No browser, no mocks.

It creates and deletes rows. `lib/config.mjs` refuses to run against the production project refs, and every row it creates is
marked `[e2e]` (or belongs to an `e2e-*@example.com` account) so it can be found and removed again.

## One-time setup

1. Generate the accounts (12 synthetic users: admin, two executives, a group manager, a leader, two members, one to deactivate,
   one with finance history, one with none, plus two disposable ones: a fresh sign-up that section 03 approves and deletes, and one
   that the last section deletes):

   ```
   node scripts/e2e/gen-setup-sql.mjs > /tmp/e2e-setup.sql
   ```

   Passwords are generated into `/tmp/claude-0/e2e/secrets.json` (override with `E2E_SECRETS`). They are never written into the
   repository. The SQL is idempotent: accounts that exist are skipped (except the applicant, below).
2. Run `/tmp/e2e-setup.sql` on the **test** project (SQL editor). It inserts `auth.users` and `auth.identities`; the signup trigger
   creates the profiles. Since the membership gate (20261128010100) that trigger creates every profile `pending`, so the SQL makes
   each account `active` itself, in the same update as its role (a pending profile can only be a plain member); only
   `e2e-applicant@example.com` is left `pending`, as a real first sign-in would leave it. Run the SQL again whenever
   `tests/03-membership-gate.mjs` or `tests/90-admin-delete.mjs` has used up its disposable account (the section then skips that
   test and says so); for the applicant it also puts an account that a stopped run left half used back to `pending`.
   The SQL needs `20261128010000_membership_gate_schema.sql` applied to leave the applicant pending; without it the applicant stays
   active and section 03 skips itself.

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
  too when you run one of the later sections alone: `--only "10 groups,60 finance"`. Section 03 needs the two executives that section 00 promotes: `--only "00 accounts,03 membership"`.
* Exit code 1 means at least one test failed. `NOTE` lines are observations (known or suspected issues recorded without failing).
* Optional: `SUPABASE_LEGACY_ANON_KEY` (never commit it) adds a comparison of the public concert request with the legacy JWT.

| Section | What it covers |
|---|---|
| 00 accounts | sign-in, profile trigger, role escalation refused, admin promotes executives, directory |
| 03 membership gate | the setup SQL's fresh sign-up is pending and reads nothing (every table of `inventory.json`, every bucket), its writes and the queue are refused in words, executives see it in the queue and the menu count, decline it, another executive undoes that, a second decision is refused, it reads and writes like a member afterwards, and it is deleted at the end |
| 10 groups | join requests approved by a non-executive manager (member sees the workspace in the same session), waitlist, decline, removal, a removed member cannot rejoin an open group |
| 20 calendar | event and announcement create, edit (`updated_at`), pin, delete, visibility, cross-executive edit |
| 30 recordings | upload via Storage, draft, publish, notation file, delete in the app's order, non-uploader refused, legacy club-archive copy plays and is archive-only |
| 40 resources | folders, import batch, upload, the app's own list query, rename, visibility, archive, restore, delete, discard a failed upload, group manager rights, links |
| 50 attendance | draft edit/delete, open, rotate code, check in, mark, clear, absence forms, close, void and totals, thresholds |
| 60 finance | reimbursement lifecycle with receipts in `finance-private`, club expense, income, funding claims, the five summary cards against a hand-computed ledger, the `create_funding_claim` race |
| 70 deactivation | a deactivated member with a valid session is refused everywhere; reactivation |
| 80 anonymous | public concert archive works for a visitor; every table, RPC and bucket in `inventory.json` refuses a visitor |
| 85 least privilege | an executive, the administrator and a member cannot write the money, attendance, audit and group tables directly (permission denied); the documented gap (finance documents and link tables still insertable) is recorded as a NOTE |
| 90 admin delete | `admin_delete_member` message for an account with history; clean delete without |

Storage deletes are proven gone three ways: the object is no longer listed, no new signed URL can be made, and a signed URL made
**before** the delete but never fetched no longer downloads. (A URL that was fetched before the delete can still be served by the
CDN cache; the suite does not treat that as proof either way, and lists such cases in section 90.)

## Cleaning up

Money is never hard-deleted by the app, so a run leaves finance rows behind. In this order:

1. `node scripts/e2e/cleanup.mjs` removes leftover storage objects through the Storage API (a SQL delete would leave the file
   in object storage). Run it **before** the SQL: the recordings, notations and resources policies only allow a delete while the row
   still exists. The exception is `finance-private`: a file that still has a `finance_documents` record can only be removed through
   `remove_finance_document`, which keeps the receipts of decided requests, so the script leaves those and says so (see step 2b).
2. `cleanup.sql` deletes every `[e2e]` row, in foreign-key order, in one transaction. It keeps the accounts (and the roles the suite gave them:
   section 00 demotes the two executives before it promotes them again, so a second run still observes a real promotion).
   2b. Run `node scripts/e2e/cleanup.mjs` again: the `finance-private` files are now unregistered, and an executive can see and delete them.
3. `cleanup-check.sql` lists what is left (all zero apart from the accounts).
4. `cleanup-accounts.sql` removes the accounts themselves when you retire the fixtures.

## Other files

* `latency.mjs`: 10 timed runs per screen call, as a member and as an executive, each paired with `GET auth/v1/health` as the network
  floor; also records the gateway's `x-envoy-upstream-service-time` (server-side share). `node scripts/e2e/latency.mjs --json out.json`.
* `inventory.sql` / `inventory.json`: the table, function and bucket list the anonymous sweep (and section 85) covers. Regenerate after a
  migration adds a table or function, or changes who holds a grant.
* `lib/`: config, a request log attached to failures (no auth headers), assertions, fixtures, storage helpers.
* The harness imports `lib/resources-query.ts` and `lib/public-concerts.ts` from the app, so the list and public-archive requests are
  the app's own (Node strips the types).

## Not covered

Google sign-in, the browser UI and everything rendered by it, real email delivery, Realtime, edge functions, and anything that needs
the production project or its data volume. Authentication here is email and password on a test project.
