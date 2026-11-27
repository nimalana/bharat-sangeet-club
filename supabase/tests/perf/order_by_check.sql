-- Plan 2.4 item 4: for every ORDER BY ... LIMIT list query in perf.queries, which scan
-- feeds the ordering, as the member and the executive (row-level security on) and as
-- the table owner (no row-level security, the index's best case).
--   psql -f supabase/tests/perf/order_by_check.sql  (after bench setup: perf.queries filled)
select perf.pick_actors();
\ir queries.sql
create or replace function perf.shape(p_actor text, p_sql text) returns text language plpgsql as $$
declare plan jsonb; v_sql text := perf.expand(p_actor, p_sql);
begin
  if p_actor = 'owner' then v_sql := perf.expand('member', p_sql); reset role; else perform perf.act_as(p_actor); end if;
  execute 'explain (analyze, format json) ' || v_sql into plan;
  reset role;
  return (select string_agg(distinct (n ->> 'Node Type') || coalesce(' ' || (n ->> 'Index Name'), '') || coalesce(' ' || (n ->> 'Relation Name'), ''), '; ')
          from jsonb_path_query(plan, '$.** ? (@."Node Type" like_regex "Scan|Sort")') n)
         || ' | ' || round((plan -> 0 ->> 'Execution Time')::numeric, 2) || ' ms';
end $$;
select q.label,
       perf.shape('owner', q.sql) as owner_no_rls,
       perf.shape('member', q.sql) as member_rls,
       perf.shape('executive', q.sql) as executive_rls
from perf.queries q
where q.sql ~* 'order by' and q.sql ~* 'limit' and q.actors ~ 'member' and q.actors ~ 'executive' and q.sql !~* 'get_|storage'
order by q.ord;
