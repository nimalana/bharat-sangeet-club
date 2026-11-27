# Phase 2 database performance

Measured on a throwaway PostgreSQL 16 cluster (plain Postgres with the Supabase shims, not hosted Supabase), single connection, warm cache, JIT off, median of 5 runs after one warm-up. Absolute numbers will differ on hosted Supabase (network, pooler, smaller CPU); the ratios and the plan shapes are what carry over.

## Dataset

`supabase/tests/seed-load.sql` (not a migration; deterministic, no `random()` or `now()`; refuses to run on a database that already has data).

| Table | Rows |
|---|---|
| Members | 501 (3 admins, 12 executives, 486 members, 24 deactivated; each in 1-3 of 12 subgroups, one subgroup archived; leader, manager, pending, waitlisted, inactive and removed memberships) |
| Recordings | 5,000 (3,000 published, drafts, archived; club, subgroup and public audiences) + 1,500 notes |
| Resources | 2,000 (312 folders in three levels, 1,600 files, 88 links; members and executive-only visibility; some archived, pending, failed) |
| Attendance records | 20,000 (and as many participant rows) over four terms, one older than the 18-month window; excuses, remediations, eligibility |
| Finance | 1,500 ledger payments, 1,200 expenses, 300 reimbursements, 30 funding claims, 800 documents |
| Other | 300 events, 400 announcements, 300 archive items, 5,000 audit rows, 8,679 `storage.objects` rows |

## Method

`scripts/db-perf.sh` replays all migrations, loads the seed and `supabase/tests/perf/harness.sql`. `supabase/tests/perf/queries.sql` holds 66 queries; `bench.sql` runs each as every listed actor and stores `EXPLAIN (ANALYZE, BUFFERS)` medians in `perf.results`. Actors (chosen by what they are, see `perf.pick_actors()`): anon, member (two subgroups), leader, manager, executive, admin, deactivated. Each query runs as the `authenticated` or `anon` role with PostgREST-style JWT claims, so row-level security applies. `auth.uid()` is redefined as the hosted JSON-claims version so per-row helper cost is not understated. The queries are what the frontend sends (`range(`/`.limit(` in `app/` and `components/`, reproduced as SQL), the read functions `get_portal_bootstrap`, `get_attendance_workspace`, `get_finance_summary`, `private.can_view_resource`/`can_manage_resource` and the other policy helpers (2,000 calls each), and the storage-policy lookups (one object by name, 50 by name, and whole-bucket scans as an upper bound).

`UNTIL=20261127005000 scripts/db-perf.sh` builds the schema as it was before the Phase 2 database work (migrations 20261127010000 to 20261127012000 left out); that is the "Phase 1" column. "Head" is the branch before this change (those three migrations in). "Final" adds migrations 20261127020000 and 20261127021000.

## What changed (new migrations only)

1. `20261127020000_resources_select_policy.sql`. The resources SELECT policy called `private.can_view_resource()` per row; each call is a security-definer function doing a `profiles` lookup and a `subgroup_memberships` lookup (about 125 microseconds per call for a member, 45 for an executive). The executive flag and the caller's subgroup sets do not depend on the row, so the policy now reads them once per statement (InitPlans: `private.is_executive()`, new `private.my_active_subgroup_ids()`, `private.my_managed_subgroup_ids()`) and compares rows with `= any(...)`. The rule is unchanged. `can_view_resource()` stays for the storage policies and the resource functions.
2. `20261127021000_recordings_order_index.sql`: `recordings (created_at desc, id desc)`. Under the recordings policy `status = 'published'` cannot be an index condition (`enum_eq` is not leakproof), so `recordings_status_created_idx` is never used by a signed-in user; the plan was Seq Scan plus top-N sort.

`scripts/db-replay.sh` passes (6 SQL suites and the permissions snapshot). The snapshot diff is exactly the intended change: the one policy expression, and the two new `private.*` definer functions (execute for `authenticated` only). `UPDATE_SNAPSHOT=1` was run once for that.

## Before and after (milliseconds)

| Query | Role | Phase 1 | Head | Final |
|---|---|---|---|---|
| `get_portal_bootstrap()` | member / manager | n/a (function added in Phase 2) | 177 / 172 | 3.2 / 3.3 |
| | executive / admin | n/a | 94 / 93 | 4.9 / 4.8 |
| | deactivated | n/a | 1.6 | 1.7 |
| `select count(*) from resources where status <> 'archived'` | member / manager / executive | 165 / 164 / 88 | 171 / 171 / 92 | 0.7 / 0.8 / 0.4 |
| Whole resource tree, no limit | member / executive | 167 / 92 | 175 / 95 | 1.5 / 4.1 |
| Root folder children (100) | member / executive | 6.1 / 5.1 | 6.3 / 5.3 | 0.6 / 0.4 |
| 50 resource objects (signed URLs) | member / executive | 7.3 / 5.5 | 6.9 / 5.2 | 2.0 / 3.2 |
| Recordings page 1 (24) | member / manager / executive | 25.6 / 23.2 / 25.7 | 1.6 / 1.5 / 2.0 | 0.2 / 0.2 / 0.2 |
| Recordings 10 pages (240) | member / executive | 25.5 / 25.7 | 1.7 / 2.1 | 1.6 / 2.1 |
| Recordings search "kalyani" page 1 | member / executive | 25.1 / 24.9 | 1.3 / 1.4 | 1.2 / 1.3 |
| Recordings archived (member has none) | member | 24.9 | 0.9 | 2.1 (regression, see below) |
| Attendance records visible (count) | member / executive | 194 / 99 | 1.1 / 2.5 | 0.8 / 2.0 |
| `get_attendance_workspace('all')` | member / leader / manager | n/a | 5.6 / 6.6 / 6.5 | 5.2 to 9.1 (run to run) / 6.2 / 6.1 |
| | executive / admin | n/a | 138 / 136 | 133 to 150 / 132 |
| `get_attendance_workspace('club')` | member / executive | n/a | 4.6 / 66 | 4.1 / 57 |
| `get_finance_summary()` | member / executive / admin | 31 / 17 / 15 | 2.5 / 2.2 / 2.2 | 2.3 / 2.0 / 2.1 |
| Ledger payments (500) | member | 15.3 | 0.6 | 0.6 |
| Storage policy, one object (6 buckets) | member / executive | not measured | 0.5 to 0.8 | 0.6 to 0.8 |

Phase 1 to Head is the earlier Phase 2 work (migrations 20261127010000 to 20261127012000); Head to Final is this change. Every other query in `perf.results` (people directory, announcements, events, memberships, audit log, group lists, finance lists, roster) is under 3 ms for every role in all three phases. The full per-role numbers are reproducible with `bench.sql`.

Not remeasured per role: anon. It only reads public concert recordings (`archive_items`, 0.1 ms); it cannot call the read functions.

## Findings that did not justify a change

- **Policy helper cost per call** (`can_view_resource` 123 us, `can_manage_resource` 129 us, `is_subgroup_manager` 36 us, `is_executive` 4.5 us for a member). After fix 1 nothing user-facing calls them per row at a cost above 1 ms: the storage policies evaluate one object (0.6-0.8 ms) and the 50-object signed-URL batch is 2-3 ms. Making the functions cheaper (inlining, caching) would be speculative. The whole-bucket storage scans (`club-archive`, `club-resources`; about 4,500 and 3,500 objects) went from 199 ms to 30 ms for a member as a side effect; the frontend never scans a bucket.
- **Executive attendance workspace, 133-150 ms (all) and 57 ms (club).** Not policies or indexes: the plans are index scans over about 15,000 records and 15,000 participant rows, and the time is building the jsonb payload (about 42 ms for records alone). Members get 5-9 ms. Reducing it means shrinking the payload (a shorter window, or no participants for executives); that is a design change to the call, left for the app side. The window is already bounded to 18 months.
- **Splitting the overlapping `for all` executive policies** (`supabase/tests/perf/split_experiment.sql`, rolled back). Splitting into insert/update/delete on `attendance_records`, `attendance_session_participants`, `attendance_excuses`, `attendance_sessions` changed SELECT time by 0.00 to 0.10 ms (records, executive 1.904 to 1.900 ms; member 0.835 to 0.752 ms; participants 0.913 to 0.804 ms), because `is_executive()` is already an InitPlan evaluated once. There is no gain, so no split was made and no access change risked.
- **Access comparison for fix 1** (`supabase/tests/perf/access_resources.sql`). For all 501 accounts, the ids returned under the new policy are compared with the ids the old rule allows (`is_active_member()` and `can_view_resource()` per row, evaluated without row-level security). Run against the old policy first to validate the harness (0 mismatches), then against the new one: 501 accounts, 0 mismatches, 298,597 account-resource pairs visible in both. This covers executives, admins, leaders, managers, plain members, pending, waitlisted and removed memberships, and deactivated accounts. It does not test the write policies (unchanged) or real Supabase Auth.

## ORDER BY indexes at scale

`supabase/tests/perf/order_by_check.sql` prints the plan nodes for every ordered, limited list query as the table owner (no row-level security), member and executive.

- Used under row-level security: `attendance_sessions_starts_idx`, `announcements_feed_idx`, `finance_payments_date_idx`, `resources_parent_order_idx` (bitmap, then a sort of at most 100 rows), `recordings_subgroup_created_idx`, `archive_items_subgroup_created_idx`, `announcements_subgroup_feed_idx`.
- Not used under row-level security: `recordings_status_created_idx` (see change 2). `supabase/tests/perf/recordings_order_index.sql` measures page 1 (rolled back): 5,000 rows 1.4 ms member / 1.8 ms executive, 50,000 rows 12.6 / 17.0 ms; with the new index 0.2 / 0.1 ms at both sizes. The old index is still the best plan for owner-level queries and is left in place; dropping it is a separate decision.
- Seq Scan plus Sort, left alone: `finance_expenses` (0.35-0.5 ms) and `personal_reimbursements` (0.1-0.2 ms) as member/executive, `profiles` by name (0.3 ms). Rows are in the hundreds to low thousands and the policy filter keeps the index from helping; revisit above about 10,000 rows.
- Cost of the new index: a regression for a member's archived list, which matches zero rows and now walks the whole index in order (0.9 to 2.1 ms at 5,000 rows) instead of one sequential pass. Executives' archived list went from 1.0 to 0.2 ms.

## What remains

- Executive attendance workspace payload (above); needs a call-shape change (frontend and function together).
- `get_portal_bootstrap` for executives still returns the archive recordings list (300 rows); 5 ms, fine now.
- `can_manage_resource` is still evaluated per row on resource UPDATE and DELETE statements; these touch one row at a time from the app, so not measured as a problem.
- Counts: `count(*)` over recordings under row-level security reads all rows (about 1 ms at 5,000, linear). If the library grows 10x, the paged count should become an estimate or be cached.
- Everything here is plain PostgreSQL. Not measured: hosted Supabase latency, PostgREST overhead, pooler behaviour, real Storage requests, Auth token checks. Re-run `scripts/db-perf.sh` plus `bench.sql` on a Supabase test project with the same seed before relying on the absolute numbers.

## Reproduce

```
PGPORT=54351 scripts/db-perf.sh                      # cluster, migrations, seed, harness; prints how to connect
psql ... -v phase=final -v runs=5 -f supabase/tests/perf/bench.sql
psql ... -f supabase/tests/perf/access_resources.sql         # about 80 s
psql ... -f supabase/tests/perf/split_experiment.sql
psql ... -f supabase/tests/perf/order_by_check.sql
psql ... -f supabase/tests/perf/recordings_order_index.sql
UNTIL=20261127005000 PGPORT=54353 scripts/db-perf.sh # the Phase 1 schema
```
