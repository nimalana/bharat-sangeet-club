-- Measurement helpers for scripts/db-perf.sh. Loaded after supabase/tests/helpers.sql
-- and supabase/tests/seed-load.sql, on the throwaway database only.

-- The shim in shims.sql reads request.jwt.claim.sub. Hosted Supabase reads
-- the JSON claims PostgREST sets, which costs a jsonb parse per call; use the
-- hosted definition here so per-row helper costs are not understated.
create or replace function auth.uid() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

create schema if not exists perf;
grant usage on schema perf to anon, authenticated;

create table if not exists perf.actors (ord int primary key, actor text unique, id uuid, gid bigint, note text);
create table if not exists perf.params (k text primary key, v text);
create table if not exists perf.queries (ord serial primary key, label text unique, actors text, sql text);
create table if not exists perf.results (
  phase text, actor text, label text, median_ms numeric, min_ms numeric, planning_ms numeric,
  shared_hit bigint, shared_read bigint, rows bigint, seq_scans text, err text,
  primary key (phase, actor, label));

-- Act as one of the actors the way PostgREST does: a database role plus JSON claims.
create or replace function perf.act_as(p_actor text) returns void language plpgsql as $$
declare v_id uuid;
begin
  select id into v_id from perf.actors where actor = p_actor;
  perform set_config('request.jwt.claims',
    case when v_id is null then '{"role":"anon"}' else json_build_object('sub', v_id, 'role', 'authenticated')::text end, true);
  perform test.login(v_id);
  perform set_config('request.jwt.claim.sub', '', true);   -- hosted auth.uid() falls through to the JSON claims
end $$;

create or replace function perf.expand(p_actor text, p_sql text) returns text language plpgsql as $$
declare v_id uuid; v_gid bigint; v_sql text; p record;
begin
  select id, gid into v_id, v_gid from perf.actors where actor = p_actor;
  v_sql := replace(replace(p_sql, '{uid}', quote_literal(coalesce(v_id::text, '00000000-0000-0000-0000-000000000000'))), '{gid}', coalesce(v_gid::text, 'null'));
  for p in select k, v from perf.params loop v_sql := replace(v_sql, '{' || p.k || '}', p.v); end loop;
  return v_sql;
end $$;

-- Runs p_sql p_runs times (after one warm-up) as the actor under EXPLAIN (ANALYZE, BUFFERS)
-- and stores the median. {uid}, {gid} and every perf.params key are substituted first.
create or replace function perf.measure(p_phase text, p_actor text, p_label text, p_sql text, p_runs int)
returns void language plpgsql as $$
declare
  v_sql text := perf.expand(p_actor, p_sql); plan jsonb;
  exec_ms numeric[] := '{}'; plan_ms numeric[] := '{}'; i int;
  v_hit bigint; v_read bigint; v_rows bigint; v_seq text; v_err text;
begin
  for i in 0..p_runs loop
    begin
      perform perf.act_as(p_actor);
      execute 'explain (analyze, buffers, format json) ' || v_sql into plan;
      reset role;
    exception when others then
      reset role; v_err := sqlerrm; exit;
    end;
    if i > 0 then
      exec_ms := exec_ms || (plan -> 0 ->> 'Execution Time')::numeric;
      plan_ms := plan_ms || (plan -> 0 ->> 'Planning Time')::numeric;
    end if;
  end loop;
  if v_err is null then
    v_hit := (plan -> 0 -> 'Plan' ->> 'Shared Hit Blocks')::bigint;
    v_read := (plan -> 0 -> 'Plan' ->> 'Shared Read Blocks')::bigint;
    v_rows := (plan -> 0 -> 'Plan' ->> 'Actual Rows')::bigint;
    select string_agg(distinct n ->> 'Relation Name', ',') into v_seq
      from jsonb_path_query(plan, '$.** ? (@."Node Type" == "Seq Scan")') n;
    insert into perf.results values (p_phase, p_actor, p_label,
      (select percentile_cont(0.5) within group (order by x) from unnest(exec_ms) x), (select min(x) from unnest(exec_ms) x),
      (select percentile_cont(0.5) within group (order by x) from unnest(plan_ms) x), v_hit, v_read, v_rows, v_seq, null)
    on conflict (phase, actor, label) do update set median_ms = excluded.median_ms, min_ms = excluded.min_ms,
      planning_ms = excluded.planning_ms, shared_hit = excluded.shared_hit, shared_read = excluded.shared_read,
      rows = excluded.rows, seq_scans = excluded.seq_scans, err = null;
  else
    insert into perf.results (phase, actor, label, err) values (p_phase, p_actor, p_label, v_err)
    on conflict (phase, actor, label) do update set err = excluded.err, median_ms = null;
  end if;
end $$;

-- Actors: found by what they are, so the choice is deterministic for the seeded data.
create or replace function perf.pick_actors() returns void language plpgsql as $$
begin
  truncate perf.actors, perf.params;
  insert into perf.actors (ord, actor, id, gid, note) values (0, 'anon', null, null, 'signed out');
  insert into perf.actors (ord, actor, id, gid, note)
  select 1, 'member', p.id, (select min(subgroup_id) from public.subgroup_memberships m where m.member_id = p.id and m.status = 'active'),
         'ordinary member, two active subgroups, no leader or manager role'
  from public.profiles p
  where p.role = 'member' and p.status = 'active' and p.email like 'member%@seed.invalid'
    and (select count(*) from public.subgroup_memberships m where m.member_id = p.id and m.status = 'active') = 2
    and not exists (select 1 from public.subgroup_memberships m where m.member_id = p.id and m.membership_role <> 'member')
  order by substring(p.email from 'member(\d+)@')::int limit 1;
  insert into perf.actors (ord, actor, id, gid, note)
  select 2, 'leader', p.id, m.subgroup_id, 'subgroup leader, club role member'
  from public.profiles p join public.subgroup_memberships m on m.member_id = p.id and m.status = 'active' and m.membership_role = 'leader'
  where p.role = 'member' and p.status = 'active' order by m.subgroup_id, p.email limit 1;
  insert into perf.actors (ord, actor, id, gid, note)
  select 3, 'manager', p.id, m.subgroup_id, 'subgroup manager, club role member'
  from public.profiles p join public.subgroup_memberships m on m.member_id = p.id and m.status = 'active' and m.membership_role = 'manager'
  where p.role = 'member' and p.status = 'active' order by m.subgroup_id, p.email limit 1;
  insert into perf.actors (ord, actor, id, gid, note)
  select 4, 'executive', p.id, (select min(subgroup_id) from public.subgroup_memberships m where m.member_id = p.id and m.status = 'active'), 'club role executive'
  from public.profiles p where p.role = 'executive' and p.status = 'active' order by p.email limit 1;
  insert into perf.actors (ord, actor, id, gid, note)
  select 5, 'admin', p.id, (select min(subgroup_id) from public.subgroup_memberships m where m.member_id = p.id and m.status = 'active'), 'club role admin'
  from public.profiles p where p.role = 'admin' and p.email like 'member%@seed.invalid' order by p.email limit 1;
  insert into perf.actors (ord, actor, id, gid, note)
  select 6, 'deactivated', p.id, null, 'deactivated account'
  from public.profiles p where p.status = 'deactivated' order by p.email limit 1;

  insert into perf.params values
    ('rec_path', (select storage_path from public.recordings where status = 'published' and audience = 'club' order by id limit 1)),
    ('res_path', (select storage_path from public.resources where node_kind = 'file' and status = 'ready' and subgroup_id is null and visibility = 'members' and storage_bucket = 'club-resources' order by id limit 1)),
    ('arch_path', (select storage_path from public.archive_items where subgroup_id is null and visibility = 'members' and type = 'document' order by id limit 1)),
    ('note_path', (select storage_path from public.recording_notes where storage_path is not null order by id limit 1)),
    ('fin_path', (select storage_path from public.finance_documents order by id limit 1)),
    ('exc_path', (select proof_path from public.attendance_excuses where proof_path is not null order by id limit 1)),
    ('res_paths50', (select 'array[' || string_agg(quote_literal(storage_path), ',') || ']' from (select storage_path from public.resources where node_kind = 'file' and storage_bucket = 'club-resources' and status = 'ready' and visibility = 'members' order by id limit 50) s)),
    ('rec_with_notes', (select min(recording_id)::text from public.recording_notes));
end $$;
