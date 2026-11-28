# Contract check: frontend against the migrated database

`npm run test:contract` fails when the frontend uses something the database does not provide, or does something the
database will refuse. It exists because the frontend talks to Supabase through an untyped client, so a wrong column,
a wrong RPC argument name or a write to a table that became SELECT-only compiles fine and fails only in the browser.
R2 (generated types) removes part of this; until then, and as a check on the grants, this is the net under the refactor.

```bash
npm run test:contract            # about 10 s: replay the migrations, extract the calls, compare, scan
npm run test:contract:selftest   # the above plus ~35 s proving each kind of break is caught (see "Does it catch anything?")
scripts/contract-check/run.sh --probes   # also prints the role probes (informational, nothing asserted)
```

Needs Node 22, PostgreSQL 16 server binaries (the same as `npm run test:db`) and nothing else. No network, no Supabase
project, no secrets. The cluster lives in a temp directory and is stopped and deleted on exit, on failure and on Ctrl-C.
Several runs can go in parallel (the port only names a socket file inside each cluster's own directory).

## What it does

1. **Replay.** `scripts/db-replay.sh` with `REPLAY_ONLY=1` builds a throwaway PostgreSQL 16 cluster and applies every
   migration (schema only: no SQL suites, about 3 s).
2. **Extract** (`extract.mjs`). Reads the frontend with the TypeScript compiler API and writes every Supabase call as
   JSON: `.from(table)` with its select list, insert/update/upsert/delete payload columns, filters and order columns,
   `.rpc(name, args)` with argument names and TypeScript types, `.storage.from(bucket).method()`, raw `/rest/v1/<table>`
   URLs, and the TypeScript row types named in `config.json`.
3. **Compare** (`check.mjs`). Asks the replayed database (`pg_catalog`, `information_schema`, `has_*_privilege`,
   `pg_policies`, `storage.buckets`) and reports.
4. **Scan** (`event-target-scan.mjs`). The P1-08 scan kept from the review: `event.currentTarget` read after an `await`.

Nothing depends on a file name, a folder or a variable name. Every file the `tsconfig.json` compiles is scanned (except
`node_modules`, tests, `scripts`, `supabase`, `docs`, build output and `*.test.*`), a receiver counts as a client by its
**type** (`SupabaseClient`), and row types are found by their TypeScript name wherever they are declared. Moving a
component, splitting `app/page.tsx` or putting every call behind `lib/api/*.ts` keeps the check working.

## What fails the build (FAIL)

| Rule | Example |
|---|---|
| table, view, column, RPC, storage bucket does not exist | `select("id,titel")`, `.rpc("no_such_fn")`, `storage.from("nope")` |
| RPC argument name unknown, a required argument missing, no overload matches | `{ p_member_id }` when the function takes `p_target_id` (PostgREST: PGRST202) |
| enum or CHECK value that cannot exist | `.eq("status", "bogus")`, `p_status: "pending"` for `attendance_status` |
| **write to a table or column `authenticated` may not write** | `.update()` on a SELECT-only table, `profiles.role`, upsert (needs INSERT and UPDATE) |
| table with RLS and no permissive policy for the command | every insert is refused |
| **RPC `authenticated` may not EXECUTE** | revoked from `public`/`anon`/`authenticated` |
| filter on a column `authenticated` cannot SELECT | PostgREST needs it to filter |
| storage call with no permissive `storage.objects` policy for that bucket and command | upload to a bucket without an INSERT policy |
| embedded relation with no foreign key, or a hint that matches none | `select("id, profiles(name)")` |
| TS row type property that is not a column, or a literal union value the database never holds | `Excuse.status` |
| a raw `/rest/v1/<table>?select=...` URL (read with the anon key) naming a column or table `anon` cannot read | the public concerts list |
| fewer calls found than the floors in `config.json`, or more UNRESOLVED calls than `maxUnresolved` | the extractor has stopped seeing the code |

WARN is worth reading and does not fail (type mismatches such as a nullable value sent to a NOT NULL column, an `update`
without an `eq`, an insert omitting NOT NULL columns without a default, overloads that are ambiguous). INFO is context
(`VERBOSE=1`). Each finding has a stable key such as `table-priv:subgroups:update` that does not contain a file name.

**ACCEPTED** is a FAIL listed in `config.json` under `accepted` with a reason and a severity. On the current branch there
is one: `rpc-enum:set_attendance_status:p_status:pending`, minor. The TypeScript type `RecordStatus` includes the
client-only `pending`; the only code that builds the call is the attendance table, whose `pending` option is `disabled`,
so the value cannot be sent. R2 derives the type from the enum and the entry then reports itself as stale (WARN) and is
deleted. An accepted entry that no longer occurs is reported, so the list cannot rot.

## UNRESOLVED: what it could not read

A call that is built dynamically is never skipped silently. The report ends with `UNRESOLVED: n` and lists each one with
`file:line` and the reason. `maxUnresolved` in `config.json` is a ratchet: a new unresolved call fails the check, so a
refactor that hides calls behind a generic helper is noticed. Strings are resolved before giving up: through literal
unions, `const`, ternaries, `a || "literal"`, function return values, and function parameters through **all** call sites
(so `removeStoredFile(bucket)` is followed to the callers' literals).

On the current code, 6 are unresolved:

| Where | Why |
|---|---|
| `storage.from(bucket)` x5 (`lib/storage-remove`, `app/resources`, `components/recordings/recording-workspace`) | the bucket comes from data (`storage_bucket` column, a map key). Checked anyway against every value a `*bucket*` column may hold (`club-resources`, `club-archive`, `recordings`) plus the literals seen |
| `from("resources")` passed to `applyListPlan(query, plan)` | the resources list filters are applied by a generic helper from a plan object; the columns named in `lib/resources-query` are not checked |

## Known blind spots

These are limits of the method, not bugs; the check cannot warn about them.

- **Wrappers that assemble the call from descriptions** (`applyListPlan`, any "plan" or "filter spec" object turned into
  builder calls by a helper). Listed as UNRESOLVED only where the builder is handed over; the columns inside the plan
  are not checked.
- **Dynamic table, RPC, column or bucket names** that no call site resolves to a literal (value read from a variable of
  type `string`, a database row, `process.env`). Listed as UNRESOLVED.
- **Which role makes the call.** Every table and RPC call is checked as `authenticated`. A call made while signed out
  (`anon`) is not told apart; raw `/rest/v1` URLs are checked as `anon`.
- **Row-level security bodies.** It sees that a permissive policy exists for the command, not what the policy allows
  (that is the SQL suites and the end-to-end suite).
- **Values at runtime.** Only string literals the type checker can see are compared with enums and CHECK lists; a value
  typed as `string` is not.
- **Anything not made through a `SupabaseClient`-typed value**: a second HTTP client, GraphQL, edge functions
  (`functions.invoke` is listed as INFO, not checked), realtime channels, `auth.*`. A raw `fetch` to `/rest/v1` is read only
  when the URL and its query string are in one function.
- **`any`-typed clients.** Found by their name (`supabase`, `client`, `sb`, `db`, `admin`) and marked untyped. A client
  of type `any` with another name is invisible; a call on a non-Supabase receiver that looks like one is listed as
  UNRESOLVED.
- **Other schemas** (`.schema("x")`), computed relationships, views with INSTEAD OF triggers, RPCs that return a column list the
  UI then reads (only the shapes named in `config.json` `rpcShapes` are compared, by parsing the function source).
- **Types.** TypeScript row types are compared with the table they are named for in `config.json` (`rowTypes`); a type
  that is renamed is reported as WARN so the entry is updated.
- It reads `.eq("a", x)` etc. even when `x` is untyped, but cannot know the SQL type a JSON value will be cast to.

## Does it catch anything? (`--selftest`)

`selftest.mjs` works on temporary copies of the frontend and a replayed cluster. Every expectation is computed from the
replayed schema (it picks a SELECT-only table, a writable table, an enum column, an RPC with required arguments...), so it
follows the schema and names no source file.

1. **baseline** the copy as is: reference FAIL keys and unresolved count.
2. **control** adds a module of valid calls in every supported style (client passed as a parameter, query in a variable,
   query returned from a function, wrapper that takes the table name, array payloads, embedded relation, raw REST URL):
   nothing new may be reported.
3. **injected** adds a module in a new, deeply nested folder, using a client named `warehouse`, with one deliberate
   break per rule (wrong column in select / filter / order / `or()` / `match()` / insert / update payload, in a query kept in a
   variable, returned from a function, behind a wrapper, on a client passed as a parameter; missing table, RPC, bucket; wrong
   or missing RPC argument; bad enum value; RPC without EXECUTE; insert, update, delete, upsert on a SELECT-only table;
   a column without UPDATE; a storage call without a policy; embedded relation without a foreign key and with a wrong
   column; raw REST URL) and a dynamic table name and a destructured `from`, which must show up as UNRESOLVED.
4. **real code** four regex mutations of the real frontend files, found by content: a wrong column in a `select()`, a
   wrong RPC argument name, a missing RPC, an `insert` into a SELECT-only table.

It fails when a break is not reported under its key, or when the control reports anything new. If a refactor removes the
code pattern a real-code mutation looks for, the case says so instead of passing.

## Files

| File | Purpose |
|---|---|
| `scripts/contract-check/run.sh` | orchestration: cluster, extract, compare, scan, cleanup |
| `extract.mjs` | frontend facts with the TypeScript checker (header lists the blind spots) |
| `check.mjs` | facts against the database |
| `config.json` | row types and RPC shapes to compare, floors, `maxUnresolved`, accepted findings |
| `selftest.mjs` | proof that the check catches what it claims |
| `event-target-scan.mjs` | P1-08 scan |
| `types-drift.mjs`, `types-drift-selftest.mjs` | `lib/database.types.ts` against the replayed database, and the proof that it catches each kind of drift (`npm run test:types-drift`, `npm run test:types-drift:selftest`; see below) |
| `probe.sql` | role probes of what the UI does, as the real roles (informational, `--probes`) |

Environment: `REPO`, `FRONTEND` (check a copy of the source against the real migrations), `CONTRACT_OUT` (keep `facts.json`,
`report.json`, `report.txt`, `replay.log`), `CONTRACT_DB=existing` (use the `PGHOST`/`PGPORT` already set, for example to run
several mutations against one cluster), `VERBOSE=1`.

## Types drift (`npm run test:types-drift`)

`lib/database.types.ts` is generated from a real database (docs/ARCHITECTURE.md). `types-drift.mjs` reads it with the
TypeScript parser and compares it with the catalog of the replayed cluster, so a migration that adds a column, changes a
type or adds an RPC without regenerating the types fails CI (job `contract`, step "Types drift"). It compares the tables,
views, enums (values in order, and the runtime `Constants` copy), columns (type, nullable, optional in Insert, `never`
for identity ALWAYS and generated columns), foreign keys (columns, referenced table, `isOneToOne`) and functions
(arguments with their optional flags, return shape). A foreign key to another schema (`profiles.id` to `auth.users`) is
not in the generator's output and is not compared. `run.sh --types-drift --selftest` first breaks a temporary copy of the
types in 13 ways and a clone of the replayed database in 10 ways, and fails when one is not reported.

## After R2

The client is `createClient<AppDatabase>` (lib/supabase.ts, lib/db.ts), so a wrong column, argument name or enum value is
now a compile error and the first two rows of the table under "What it does" are largely redundant with `tsc`. The grants,
the missing RPC EXECUTE, CHECK values on text columns, buckets and policies are not in the types: this check stays for them.

`config.json` `rowTypes` used to list 30 hand-written row types. Row types are now written as `Pick<Tables<"x">, ...>`, which
the compiler keeps in step with the database, so only the 8 that narrow a text column with a CHECK constraint (or add the
UI-only attendance mark `pending`) remain: their literal unions are still compared with the constraint. `rpcShapes` stay,
because a function's JSON answer is `Json` in the generated types. The one accepted finding (`pending` sent to
`set_attendance_status`) is gone: the dialog's status type is now the enum. When `lib/api/*.ts` holds every call,
`maxUnresolved` should go to 0 or stay at the few bucket cases.
