-- Phase 2 (plan 2.4/2.7): recording lists under row-level security.
-- enum_eq is not leakproof, so under the recordings policy `status = 'published'`
-- cannot become an index condition and recordings_status_created_idx is never chosen
-- for a signed-in member (supabase/tests/perf/recordings_order_index.sql). The plan is a
-- sequential scan plus a top-N sort: 1.4 ms (member) / 1.8 ms (executive) at 5,000
-- recordings, 12.6 / 17.0 ms at 50,000. An index on the ordering columns alone lets the
-- planner read rows newest first and stop after the page: 0.2 ms at both sizes.
create index if not exists recordings_created_idx on public.recordings (created_at desc, id desc);
