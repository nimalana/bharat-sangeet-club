-- Default privileges and the anonymous role.
--
-- Hosted Supabase grants anon, authenticated and service_role every privilege
-- on each new table and sequence in the public schema, and EXECUTE on each new
-- function there, through default ACLs. A migration that forgets
-- "revoke ... from public, anon" is therefore open on the hosted project. This
-- harness reproduces those defaults (shims.sql) so the mistake shows up here:
--   1. the defaults are really in place (otherwise checks 2 and 3 prove nothing),
--   2. anon can execute no function in public or private,
--   3. no function in public or private keeps the built-in EXECUTE for PUBLIC,
--      which every role inherits.
begin;
do $$
declare
  bad text;
begin
  -- 2 and 3 first, before this test adds objects of its own.
  select string_agg(p.oid::regprocedure::text, E'\n  ' order by p.oid::regprocedure::text) into bad
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'private')
    and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
    and has_function_privilege('anon', p.oid, 'execute');
  assert bad is null, E'anon can execute these functions (add "revoke all on function ... from public, anon"):\n  ' || bad;

  select string_agg(p.oid::regprocedure::text, E'\n  ' order by p.oid::regprocedure::text) into bad
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'private')
    and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
    and (p.proacl is null
         or exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE'));
  assert bad is null, E'these functions still have EXECUTE for PUBLIC (add "revoke all on function ... from public"):\n  ' || bad;

  -- 1. Objects created now, as the migrations create them, get the hosted defaults.
  create function public.zz_default_acl_probe() returns integer language sql as 'select 1';
  assert has_function_privilege('anon', 'public.zz_default_acl_probe()', 'execute'), 'shim: anon must get EXECUTE on a new public function';
  assert has_function_privilege('authenticated', 'public.zz_default_acl_probe()', 'execute'), 'shim: authenticated must get EXECUTE on a new public function';
  assert has_function_privilege('service_role', 'public.zz_default_acl_probe()', 'execute'), 'shim: service_role must get EXECUTE on a new public function';
  revoke all on function public.zz_default_acl_probe() from public, anon;
  assert not has_function_privilege('anon', 'public.zz_default_acl_probe()', 'execute'), 'revoke from public, anon removes anon access';
  assert has_function_privilege('authenticated', 'public.zz_default_acl_probe()', 'execute'), 'authenticated keeps its default grant after that revoke';

  create function public.zz_public_only_probe() returns integer language sql as 'select 1';
  revoke all on function public.zz_public_only_probe() from public;
  assert has_function_privilege('anon', 'public.zz_public_only_probe()', 'execute'), 'a revoke from public alone leaves anon able to call the function, as on hosted Supabase';

  -- private has no default ACL, but PostgreSQL's own default (EXECUTE for PUBLIC)
  -- still applies, so a private function needs its revoke from public too.
  create function private.zz_private_probe() returns integer language sql as 'select 1';
  assert has_function_privilege('anon', 'private.zz_private_probe()', 'execute'), 'a new private function is executable through PUBLIC until it is revoked';

  create table public.zz_default_acl_table (id integer);
  assert has_table_privilege('anon', 'public.zz_default_acl_table', 'select, insert, update, delete, truncate'), 'shim: anon gets all table privileges by default';
  assert has_table_privilege('authenticated', 'public.zz_default_acl_table', 'select, insert, update, delete, truncate'), 'shim: authenticated gets all table privileges by default';
  create sequence public.zz_default_acl_seq;
  assert has_sequence_privilege('anon', 'public.zz_default_acl_seq', 'usage, select, update'), 'shim: anon gets all sequence privileges by default';
end $$;
rollback;
