-- Before/after access comparison for the resources SELECT policy (migration
-- 20261127020000). For every account in the seeded database it compares the ids
-- the policy returns with the ids the old rule (private.can_view_resource() on each
-- row, plus the restrictive "Active members only" policy) allows, evaluated without
-- row-level security. Any difference raises an exception.
--   psql -f supabase/tests/perf/access_resources.sql   (after db-perf.sh)
create or replace function perf.compare_resource_access() returns table (accounts int, mismatches int, ids_visible_total bigint)
language plpgsql as $$
declare a record; got bigint[]; want bigint[]; n int := 0; bad int := 0; tot bigint := 0;
begin
  for a in select id from public.profiles order by id loop
    perform set_config('request.jwt.claims', json_build_object('sub', a.id, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', '', true);
    -- the rule as it was: superuser, no RLS, the old function per row
    select coalesce(array_agg(r.id order by r.id), '{}') into want from public.resources r
      where private.is_active_member() and private.can_view_resource(r.subgroup_id, r.visibility, r.status, r.created_by);
    execute 'set local role authenticated';
    select coalesce(array_agg(r.id order by r.id), '{}') into got from public.resources r;
    execute 'reset role';
    n := n + 1; tot := tot + cardinality(got);
    if got is distinct from want then bad := bad + 1; raise warning 'access differs for %', a.id; end if;
  end loop;
  return query select n, bad, tot;
end $$;
select * from perf.compare_resource_access();
