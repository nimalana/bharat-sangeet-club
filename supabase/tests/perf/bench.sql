-- Runs every query in perf.queries as every listed actor and records the median of
-- :runs executions (after one warm-up) in perf.results under :phase.
--   psql -v phase=before -v runs=7 -f supabase/tests/perf/bench.sql
set jit = off;
select perf.pick_actors();
\ir queries.sql
select perf.measure(:'phase', a.actor, q.label, q.sql, :runs)
from perf.queries q
cross join lateral unnest(string_to_array(q.actors, ',')) a(actor)
order by q.ord;
