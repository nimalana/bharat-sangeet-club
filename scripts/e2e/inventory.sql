-- Lists every table, function and storage bucket the anonymous-access sweep (tests/80-anon-public.mjs) must cover.
-- Run it on the TEST project (SQL editor or execute_sql) and save the single result cell as scripts/e2e/inventory.json
-- whenever a migration adds a table or function. The sweep reads that file; it needs no database access of its own.
select jsonb_pretty(jsonb_build_object(
  'generatedFrom', current_database(),
  'tables', (select jsonb_agg(jsonb_build_object('name', c.relname, 'rls', c.relrowsecurity,
        'columns', (select jsonb_agg(a.attname order by a.attnum) from pg_attribute a where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped),
        'anonGrants', (select coalesce(jsonb_agg(p order by p), '[]') from unnest(array['select','insert','update','delete']) p where has_table_privilege('anon', c.oid, p)))
      order by c.relname)
    from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','v','m','p')),
  'functions', (select jsonb_agg(jsonb_build_object('name', p.proname,
        'anonExecute', has_function_privilege('anon', p.oid, 'execute'),
        'args', (select coalesce(jsonb_agg(jsonb_build_object('name', coalesce(p.proargnames[i], 'arg' || i), 'type', format_type(p.proargtypes[i - 1], null)) order by i), '[]')
                 from generate_series(1, p.pronargs) i))
      order by p.proname, p.pronargs)
    from pg_proc p where p.pronamespace = 'public'::regnamespace
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')),
  'enums', (select jsonb_object_agg(typname::text, labels) from (
      select t.typname, jsonb_agg(e.enumlabel order by e.enumsortorder) as labels
      from pg_type t join pg_enum e on e.enumtypid = t.oid where t.typnamespace = 'public'::regnamespace group by t.typname) x),
  'buckets', (select jsonb_agg(jsonb_build_object('id', b.id, 'public', b.public) order by b.id) from storage.buckets b)
)) as inventory;
