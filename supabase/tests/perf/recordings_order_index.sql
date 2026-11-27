-- Plan 2.4 item 4: recordings paging under row-level security. enum_eq is not leakproof,
-- so `status = 'published'` cannot become an index condition below the policy filter and
-- recordings_status_created_idx is not used; the plan is Seq Scan + top-N Sort. This
-- measures that at 5,000 rows and at 50,000 rows (ten copies, rolled back), with and
-- without a plain (created_at desc, id desc) index that can feed the ORDER BY.
select perf.pick_actors();
begin;
set jit = off;
create temp table t_res (scale text, idx text, actor text, ms numeric);
grant all on t_res to public;
create or replace function pg_temp.m(p_scale text, p_idx text) returns void language plpgsql as $f$
declare a text; i int; plan jsonb; xs numeric[];
begin
  foreach a in array array['member','executive'] loop
    xs := '{}';
    for i in 0..7 loop
      perform perf.act_as(a);
      execute $q$explain (analyze, format json) select * from public.recordings where status = 'published' order by created_at desc, id desc limit 24$q$ into plan;
      reset role;
      if i > 0 then xs := xs || (plan -> 0 ->> 'Execution Time')::numeric; end if;
    end loop;
    insert into t_res values (p_scale, p_idx, a, (select percentile_cont(0.5) within group (order by x) from unnest(xs) x));
  end loop;
end $f$;
select pg_temp.m('5,000 rows', 'status index only');
create index tmp_rec_created on public.recordings (created_at desc, id desc);
analyze public.recordings;
select pg_temp.m('5,000 rows', '+ created_at index');
drop index tmp_rec_created;
do $$ declare cols text; begin
  select string_agg(quote_ident(column_name), ',') into cols from information_schema.columns
   where table_schema='public' and table_name='recordings' and column_name not in ('id','storage_path') and is_generated='NEVER' and is_identity='NO';
  for i in 1..9 loop
    execute format('insert into public.recordings (%s, storage_path) select %s, storage_path || %L from public.recordings where id <= 5000 or true limit 5000', cols, cols, '-copy' || i);
  end loop;
end $$;
analyze public.recordings;
select pg_temp.m('50,000 rows', 'status index only');
create index tmp_rec_created on public.recordings (created_at desc, id desc);
analyze public.recordings;
select pg_temp.m('50,000 rows', '+ created_at index');
select scale, idx, round(max(ms) filter (where actor='member'), 2) member_ms, round(max(ms) filter (where actor='executive'), 2) executive_ms from t_res group by scale, idx order by 1, 2;
rollback;
