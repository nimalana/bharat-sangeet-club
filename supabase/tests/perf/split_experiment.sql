-- Plan 2.4 item 3: does splitting the executive "for all" policies (which overlap the
-- member read policy on SELECT) into insert/update/delete policies make reads faster?
-- Runs in a transaction that is rolled back. Executive SELECT access is unchanged by
-- construction (the member policy already contains is_executive()), so this only
-- reports the timing gain.
select perf.pick_actors();
begin;
create temp table split_t (phase text, actor text, tbl text, ms numeric);
grant all on split_t to public;
create or replace function pg_temp.run(p_phase text) returns void language plpgsql as $f$
declare a text; t text; i int; plan jsonb; xs numeric[];
begin
  foreach t in array array['attendance_records','attendance_session_participants','attendance_excuses','attendance_sessions'] loop
    foreach a in array array['member','executive'] loop
      xs := '{}';
      for i in 0..9 loop
        perform perf.act_as(a);
        execute format('explain (analyze, format json) select count(*) from public.%I', t) into plan;
        reset role;
        if i > 0 then xs := xs || (plan -> 0 ->> 'Execution Time')::numeric; end if;
      end loop;
      insert into split_t values (p_phase, a, t, (select percentile_cont(0.5) within group (order by x) from unnest(xs) x));
    end loop;
  end loop;
end $f$;
set jit = off;
select pg_temp.run('overlapping');
do $$ declare t text; p record; begin
  foreach t in array array['attendance_records','attendance_session_participants','attendance_excuses','attendance_sessions'] loop
    select * into p from pg_policy where polrelid = ('public.' || t)::regclass and polcmd = '*' and polpermissive and polname like 'Executives%';
    execute format('drop policy %I on public.%I', p.polname, t);
    execute format('create policy "split ins" on public.%I for insert to authenticated with check (%s)', t, pg_get_expr(p.polqual, p.polrelid));
    execute format('create policy "split upd" on public.%I for update to authenticated using (%s) with check (%s)', t, pg_get_expr(p.polqual, p.polrelid), pg_get_expr(p.polqual, p.polrelid));
    execute format('create policy "split del" on public.%I for delete to authenticated using (%s)', t, pg_get_expr(p.polqual, p.polrelid));
  end loop; end $$;
select pg_temp.run('split');
select tbl, actor, round(max(ms) filter (where phase = 'overlapping'), 3) as overlapping_ms, round(max(ms) filter (where phase = 'split'), 3) as split_ms
from split_t group by tbl, actor order by tbl, actor;
rollback;
