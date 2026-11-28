-- Phase 4.3 (migration 20261128030400): the legacy `transactions` ledger is closed to every signed-in role.
-- Its writes were already closed by 20261127075000 (72_grants_matrix.test.sql); this adds the read, and
-- pins that nothing in the database depends on the grant.
begin;

create function test.m77l_state(p_user uuid, p_sql text) returns text language plpgsql as $$
declare st text;
begin
  perform test.login(p_user);
  begin execute p_sql; st := 'ok'; exception when others then get stacked diagnostics st = returned_sqlstate; end;
  perform test.logout();
  return st;
end $$;

do $$
declare
  v_exec uuid := test.make_user('Exec F77l', 'executive');
  v_admin uuid := test.make_user('Admin F77l', 'admin');
  v_member uuid := test.make_user('Member F77l');
  who record;
  stmt text;
  priv text;
  failures text[] := '{}';
  n bigint;
  found text;
begin
  -- a row exists, written by the owner (the migration role)
  insert into public.transactions (description, amount, category, created_by) values ('F77l legacy row', 12.5, 'Food', v_exec);

  -- no privilege of any kind for the two API roles
  foreach priv in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] loop
    if has_table_privilege('anon', 'public.transactions', priv) or has_table_privilege('authenticated', 'public.transactions', priv) then
      failures := failures || ('a role holds ' || priv);
    end if;
  end loop;
  assert not has_any_column_privilege('anon', 'public.transactions', 'select, insert, update, references')
     and not has_any_column_privilege('authenticated', 'public.transactions', 'select, insert, update, references'), 'no column privilege either';

  -- every operation, as every kind of caller
  for who in
    select * from (values ('executive', v_exec), ('administrator', v_admin), ('member', v_member), ('anonymous visitor', null::uuid)) w(label, id)
  loop
    foreach stmt in array array[
      'select count(*) from public.transactions',
      'select description from public.transactions limit 1',
      'insert into public.transactions (description, amount) values (''x'', 1)',
      'update public.transactions set description = ''x''',
      'delete from public.transactions',
      'truncate public.transactions'] loop
      if test.m77l_state(who.id, stmt) <> '42501' then
        failures := failures || (who.label || ': ' || stmt || ' -> ' || test.m77l_state(who.id, stmt));
      end if;
    end loop;
  end loop;
  if cardinality(failures) > 0 then raise exception 'LEGACY LEDGER: %', array_to_string(failures, '; '); end if;

  -- the owner (and the service role through BYPASSRLS/ownership) still has the data
  select count(*) into n from public.transactions where description = 'F77l legacy row';
  assert n = 1, 'the owner still reads the ledger';

  -- nothing in the database reads it: no function, policy or view mentions the table
  select string_agg(x, ', ') into found from (
    select 'function ' || n.nspname || '.' || p.proname as x from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('public', 'private') and p.prosrc ~ '\mtransactions\M'
    union all
    select 'policy ' || schemaname || '.' || tablename || ' ' || policyname from pg_policies
      where tablename <> 'transactions' and (coalesce(qual, '') ~ '\mtransactions\M' or coalesce(with_check, '') ~ '\mtransactions\M')
    union all
    select 'view ' || viewname from pg_views where schemaname = 'public' and definition ~ '\mtransactions\M'
  ) s;
  assert found is null, 'something depends on the legacy ledger being readable: ' || coalesce(found, '');
  -- the one foreign key to it (finance_payments.legacy_transaction_id) is checked as the table owner, so it needs no grant
  assert (select string_agg(conrelid::regclass::text, ',') from pg_constraint where contype = 'f' and confrelid = 'public.transactions'::regclass) = 'finance_payments',
    'finance_payments is the only table that points at the legacy ledger';
end $$;

rollback;
