-- Phase 2: cheaper row-level security.
--
-- A policy that calls private.is_executive() or private.is_admin() directly
-- runs that lookup once per row. Wrapped as (select ...), Postgres runs it
-- once per query. The rule each policy enforces does not change.
--
-- This rewrites whatever policies exist in the database it runs on, rather
-- than restating them from the migration files, so nothing that differs in
-- production is overwritten. Helpers that take a row value as an argument
-- (is_subgroup_manager, can_view_resource, ...) cannot be hoisted and are
-- left alone.
do $$
declare
  p record;
  new_qual text;
  new_check text;
  statement text;
  -- A bare call: not already directly inside "SELECT ".
  pattern constant text := '(?<!SELECT )private\.(is_executive|is_admin)\(\)';
  replacement constant text := '(SELECT private.\1())';
begin
  -- Policy text is printed and re-read relative to the same search path.
  perform set_config('search_path', 'public, extensions', true);
  for p in
    select schemaname, tablename, policyname, qual, with_check
    from pg_catalog.pg_policies
    where schemaname in ('public', 'storage')
      and (qual ~ pattern or with_check ~ pattern)
  loop
    new_qual := regexp_replace(p.qual, pattern, replacement, 'g');
    new_check := regexp_replace(p.with_check, pattern, replacement, 'g');
    statement := format('alter policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);
    if new_qual is not null then statement := statement || format(' using (%s)', new_qual); end if;
    if new_check is not null then statement := statement || format(' with check (%s)', new_check); end if;
    execute statement;
  end loop;
end;
$$;
