-- Prints every grant, policy and callable function that decides who can do
-- what. scripts/db-replay.sh compares the output with permissions.snapshot so
-- that any change to access shows up as a reviewable diff.
\pset tuples_only on
\pset format unaligned
select '# table grants';
select format('%s  %s  %s', table_name, grantee, string_agg(privilege_type, ',' order by privilege_type))
from information_schema.role_table_grants
where table_schema = 'public' and grantee in ('anon', 'authenticated')
group by table_name, grantee order by table_name, grantee;

select '# column grants (column-level privileges; the table grants above do not show them)';
select format('%s.%s  %s  %s (%s)', n.nspname, c.relname, r.rolname, a.privilege_type, string_agg(att.attname, ', ' order by att.attname))
from pg_attribute att
join pg_class c on c.oid = att.attrelid join pg_namespace n on n.oid = c.relnamespace
cross join lateral aclexplode(att.attacl) a join pg_roles r on r.oid = a.grantee
where n.nspname in ('public', 'private') and att.attacl is not null and r.rolname in ('anon', 'authenticated')
group by n.nspname, c.relname, r.rolname, a.privilege_type order by 1;

select '# sequence grants';
select format('%s.%s  %s  %s', n.nspname, c.relname, r.rolname, string_agg(a.privilege_type, ',' order by a.privilege_type))
from pg_class c join pg_namespace n on n.oid = c.relnamespace
cross join lateral aclexplode(c.relacl) a join pg_roles r on r.oid = a.grantee
where n.nspname in ('public', 'private') and c.relkind = 'S' and r.rolname in ('anon', 'authenticated')
group by n.nspname, c.relname, r.rolname order by 1;

select '# default privileges that give new objects to anon or authenticated (r = table, S = sequence, f = function)';
select format('for %s in %s  %s  %s  %s', d.defaclrole::regrole, d.defaclnamespace::regnamespace, d.defaclobjtype, r.rolname, string_agg(a.privilege_type, ',' order by a.privilege_type))
from pg_default_acl d cross join lateral aclexplode(d.defaclacl) a join pg_roles r on r.oid = a.grantee
where r.rolname in ('anon', 'authenticated')
group by d.defaclrole, d.defaclnamespace, d.defaclobjtype, r.rolname order by 1;

select '# tables without row level security';
select c.relname from pg_class c
where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and not c.relrowsecurity order by 1;

select '# policies';
select format(E'%s.%s  [%s]  %s%s  to %s\n    using: %s\n    check: %s',
  schemaname, tablename, policyname, cmd, case when permissive = 'RESTRICTIVE' then '  RESTRICTIVE' else '' end, array_to_string(roles, ','),
  coalesce(regexp_replace(qual, '\s+', ' ', 'g'), '-'),
  coalesce(regexp_replace(with_check, '\s+', ' ', 'g'), '-'))
from pg_policies where schemaname in ('public', 'storage')
order by schemaname, tablename, policyname;

select '# functions callable by signed-in users (definer = runs with owner rights)';
select format('%s.%s(%s)  %s%s', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid),
  case when p.prosecdef then 'definer' else 'invoker' end,
  case when has_function_privilege('anon', p.oid, 'execute') then '  ANON' else '' end)
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname in ('public', 'private')
  and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'))
order by 1;
