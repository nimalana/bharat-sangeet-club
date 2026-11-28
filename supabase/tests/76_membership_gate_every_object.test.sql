-- Membership gate (P0-01): an account that is not an active member (waiting for approval, declined,
-- or deactivated) gets nothing from EVERY table in public, EVERY function a signed-in user may call
-- and the storage policy, and can write nothing. The loops enumerate the catalog, so a table or a
-- function added later that forgets the gate fails here without anyone editing this file.
--
-- How it proves the gate and not something else. The gate is two things: the restrictive policy
-- "Active members only" (reads, and the check on writes) and the statement trigger
-- block_deactivated_writer (writes, including those made inside security definer functions). To see
-- them alone, the test opens everything else for the length of its transaction: authenticated gets
-- every privilege on every table and a permissive "true" policy on it (and on storage.objects). An
-- active member then reads and writes everything, and the three outsiders must still get nothing.
-- Every table first gets a sample row (a generic row built from the column types, with a short list
-- of values the check constraints need), so "zero rows" cannot be an empty table.
--
-- The functions are called with generic arguments (real ids from the sample rows where the name says
-- what it is). The call is refused (any error) or answers nothing (null, false, zero, an empty list
-- or an empty row set), and the database is byte-for-byte what it was afterwards. The few functions
-- whose answer is not empty by nature are listed below with the reason.
begin;

-- ---------------------------------------------------------------------------
-- Helpers (all rolled back with the transaction)
-- ---------------------------------------------------------------------------
-- A literal of the right type for a column or an argument.
create function test.sample_literal(p_type oid, p_name text default '') returns text language plpgsql as $$
declare typ text := format_type(p_type, null);
begin
  return case
    when typ in ('text', 'character varying') then quote_literal(case
        when p_name like '%term_key' then '2026-fall'
        when p_name like '%scope' then 'club'
        when p_name like '%code' then 'ABCDEFGH'
        else 'sample text' end) || '::text'
    when typ = 'bigint' then '1::bigint'
    when typ = 'integer' then '1::integer'
    when typ = 'smallint' then '1::smallint'
    when typ = 'numeric' then '1::numeric'
    when typ = 'boolean' then 'false'
    when typ = 'uuid' then quote_literal(gen_random_uuid()::text) || '::uuid'
    when typ = 'date' then 'current_date'
    when typ = 'timestamp with time zone' then 'now()'
    when typ = 'jsonb' then '''{}''::jsonb'
    when typ like '%[]' then format('%L::%s', '{}', typ)
    else coalesce((select format('%L::%s', e.enumlabel, typ) from pg_enum e where e.enumtypid = p_type order by e.enumsortorder limit 1), 'null::' || typ)
  end;
end $$;

-- One row in a table: the columns that must have a value (no default), by type, with p_over
-- (a jsonb object: column -> text) taking precedence. Foreign keys are not checked (the caller
-- sets session_replication_role to replica), check constraints are.
create function test.sample_row(p_rel regclass, p_over jsonb default '{}') returns void language plpgsql as $$
declare cols text[] := '{}'; vals text[] := '{}'; a record;
begin
  for a in
    select att.attname::text as name, att.atttypid, att.attnotnull, att.atthasdef
    from pg_attribute att
    where att.attrelid = p_rel and att.attnum > 0 and not att.attisdropped and att.attidentity = '' and att.attgenerated = ''
    order by att.attnum
  loop
    if p_over ? a.name then
      cols := cols || quote_ident(a.name);
      vals := vals || format('%L::%s', p_over ->> a.name, format_type(a.atttypid, null));
    elsif a.attnotnull and not a.atthasdef then
      cols := cols || quote_ident(a.name);
      vals := vals || test.sample_literal(a.atttypid, a.name);
    end if;
  end loop;
  if cardinality(cols) = 0 then
    execute format('insert into %s default values', p_rel);
  else
    execute format('insert into %s (%s) values (%s)', p_rel, array_to_string(cols, ', '), array_to_string(vals, ', '));
  end if;
end $$;

-- A number that changes when any row of any table in public changes (run as the table owner).
create function test.fingerprint() returns numeric language plpgsql as $$
declare r record; total numeric := 0; n numeric;
begin
  for r in select c.oid::regclass as rel from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' loop
    execute format('select coalesce(sum(hashtextextended(t::text, 0)::numeric), 0) from %s t', r.rel) into n;
    total := total + n;
  end loop;
  return total;
end $$;

-- True when a json value says nothing: null, false, 0, '', and lists or objects made of those.
create function test.says_nothing(j jsonb) returns boolean language sql immutable as $$
  select case jsonb_typeof(j)
    when 'null' then true
    when 'boolean' then not (j #>> '{}')::boolean
    when 'number' then (j #>> '{}')::numeric = 0
    when 'string' then (j #>> '{}') = ''
    when 'array' then not exists (select 1 from jsonb_array_elements(j) e where not test.says_nothing(e))
    when 'object' then not exists (select 1 from jsonb_each(j) e where not test.says_nothing(e.value))
    else true end;
$$;

-- How many rows an answer carries: the elements of every list in it, not counting the one object
-- that is the caller's own profile (an object whose "id" is p_own). Scalars (echoes of the
-- arguments, digests) are not rows.
create function test.rows_in(j jsonb, p_own uuid) returns bigint language sql immutable as $$
  select case jsonb_typeof(j)
    when 'array' then coalesce((select sum(case when jsonb_typeof(e) = 'object' and e ->> 'id' = p_own::text then 0 else 1 + test.rows_in(e, p_own) end)
                                from jsonb_array_elements(j) e), 0)
    when 'object' then coalesce((select sum(test.rows_in(e.value, p_own)) from jsonb_each(j) e), 0)
    else 0 end;
$$;

-- ---------------------------------------------------------------------------
-- The accounts: one active control per kind, and three that are not active members.
-- ---------------------------------------------------------------------------
create table test.gate_accounts (kind text primary key, id uuid not null, message text);
do $$
declare
  v_admin uuid := test.make_user('Gate Admin', 'admin');
  v_member uuid := test.make_user('Gate Member');
begin
  insert into test.gate_accounts values
    ('admin', v_admin, null),
    ('member', v_member, null),
    ('pending', test.make_user('Gate Pending', p_status => 'pending'), 'Your sign-up is waiting for approval by a club executive'),
    ('rejected', test.make_user('Gate Rejected', p_status => 'rejected'), 'Your sign-up was not approved'),
    ('deactivated', test.make_user('Gate Deactivated', p_status => 'deactivated'), 'Your access to the portal has been deactivated');
end $$;

-- ---------------------------------------------------------------------------
-- Part 1. A sample row in every table, then everything but the gate opened up.
-- ---------------------------------------------------------------------------
set local session_replication_role = replica;
do $$
declare
  r record;
  has_row boolean;
  failed text[] := '{}';
  -- What the check constraints need that a generic value does not give. A table that is not
  -- here and cannot take a generic row makes this test fail, naming it: add its values here.
  overrides jsonb := jsonb_build_object(
    'admin_audit_log',       '{"action": "role_changed"}'::jsonb,
    'attendance_sessions',   '{"scope": "club"}'::jsonb,
    'finance_documents',     '{"document_type": "receipt"}'::jsonb,
    'finance_expenses',      '{"paid_by": "club"}'::jsonb,
    'finance_payments',      '{"direction": "inflow", "purpose": "income"}'::jsonb,
    'recording_notes',       '{"note_type": "text"}'::jsonb,
    'resource_links',        '{"url": "https://example.org/sample"}'::jsonb,
    'signup_reviews',        '{"decision": "approved"}'::jsonb);
begin
  for r in select c.oid::regclass as rel, c.relname::text as name from pg_class c
           where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' order by 2
  loop
    begin
      -- A table that already holds a row (a singleton such as attendance_settings) needs none.
      execute format('select exists (select 1 from %s)', r.rel) into has_row;
      if not has_row then perform test.sample_row(r.rel, coalesce(overrides -> r.name, '{}'::jsonb)); end if;
    exception when others then failed := failed || format('%s (%s)', r.name, sqlerrm);
    end;
  end loop;
  assert cardinality(failed) = 0, 'no sample row could be made for: ' || array_to_string(failed, '; ') || '. Add the values its check constraints need to the overrides in 76_membership_gate_every_object.test.sql';
end $$;
set local session_replication_role = origin;

do $$
declare r record; empty text[] := '{}'; n bigint;
begin
  for r in select c.oid::regclass as rel, c.relname::text as name from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' order by 2 loop
    execute format('select count(*) from %s', r.rel) into n;
    if n = 0 then empty := empty || r.name; end if;
    -- Open everything but the gate.
    execute format('grant all on %s to authenticated', r.rel);
    execute format('drop policy if exists zz_open_for_test on %s', r.rel);
    execute format('create policy zz_open_for_test on %s for all to authenticated using (true) with check (true)', r.rel);
  end loop;
  assert cardinality(empty) = 0, 'tables without a sample row: ' || array_to_string(empty, ', ');
  grant all on storage.objects to authenticated;
  drop policy if exists zz_open_for_test on storage.objects;
  create policy zz_open_for_test on storage.objects for all to authenticated using (true) with check (true);
end $$;

-- ---------------------------------------------------------------------------
-- Part 2. Every table: the gate is there, the controls pass it, the outsiders do not.
-- ---------------------------------------------------------------------------
do $$
declare
  r record; o record;
  v_admin uuid := (select id from test.gate_accounts where kind = 'admin');
  total bigint; seen bigint; got bigint; message text; col text; tables integer := 0;
begin
  for r in select c.oid as relid, c.oid::regclass as rel, c.relname::text as name from pg_class c
           where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' order by 2
  loop
    tables := tables + 1;
    -- The two guards are on the table, and the policy is the one that asks is_active_member().
    assert exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = r.name and p.policyname = 'Active members only'
                     and p.permissive = 'RESTRICTIVE' and p.cmd = 'ALL' and p.qual like '%is_active_member%'),
      r.name || ' has no restrictive "Active members only" policy that asks private.is_active_member()';
    assert exists (select 1 from pg_trigger t where t.tgrelid = r.relid and t.tgname = 'block_deactivated_writer' and t.tgenabled = 'O' and not t.tgisinternal),
      r.name || ' has no enabled block_deactivated_writer trigger';

    execute format('select count(*) from %s', r.rel) into total;
    assert total > 0, r.name || ' has no sample row';
    -- The control: an active member reads every row of the opened-up table.
    got := test.count_as(v_admin, format('select count(*) from %s', r.rel));
    assert got = total, format('%s: the active administrator reads %s of %s sample rows (the test cannot prove anything on this table)', r.name, got, total);

    -- A column an update may name (not identity, not generated).
    select a.attname::text into col from pg_attribute a
    where a.attrelid = r.relid and a.attnum > 0 and not a.attisdropped and a.attidentity = '' and a.attgenerated = '' order by a.attnum limit 1;

    for o in select * from test.gate_accounts where kind in ('pending', 'rejected', 'deactivated') order by kind loop
      seen := test.count_as(o.id, format('select count(*) from %s', r.rel));
      assert seen = (case when r.name = 'profiles' then 1 else 0 end),
        format('%s account reads %s row(s) of %s (expected %s)', o.kind, seen, r.name, case when r.name = 'profiles' then 'its own row only' else 'none' end);
      message := test.error_as(o.id, format('delete from %s where false', r.rel));
      assert message = o.message, format('%s account: delete on %s was answered with [%s], expected [%s]', o.kind, r.name, coalesce(message, 'no error'), o.message);
      message := test.error_as(o.id, format('insert into %s default values', r.rel));
      assert message = o.message, format('%s account: insert into %s was answered with [%s], expected [%s]', o.kind, r.name, coalesce(message, 'no error'), o.message);
      if col is not null then
        message := test.error_as(o.id, format('update %s set %I = %I where false', r.rel, col, col));
        assert message = o.message, format('%s account: update on %s was answered with [%s], expected [%s]', o.kind, r.name, coalesce(message, 'no error'), o.message);
      end if;
      -- Truncate is not granted to anyone; the opened-up grant above did not include a way round the gate either.
    end loop;
    -- The rows are all still there.
    execute format('select count(*) from %s', r.rel) into seen;
    assert seen = total, r.name || ' lost or gained rows during the probes';
  end loop;
  assert tables >= 35, 'the loop saw only ' || tables || ' tables';
end $$;

-- ---------------------------------------------------------------------------
-- Part 3. Storage: every bucket, read and write.
-- ---------------------------------------------------------------------------
do $$
declare
  b record; o record;
  v_admin uuid := (select id from test.gate_accounts where kind = 'admin');
  total bigint; seen bigint; message text; buckets integer := 0;
begin
  assert exists (select 1 from pg_policies p where p.schemaname = 'storage' and p.tablename = 'objects' and p.policyname = 'Active members only'
                   and p.permissive = 'RESTRICTIVE' and p.cmd = 'ALL' and p.qual like '%is_active_member%' and p.with_check like '%is_active_member%'),
    'storage.objects has no restrictive "Active members only" policy that asks private.is_active_member() for reads and writes';
  for b in select id::text as id from storage.buckets order by 1 loop
    buckets := buckets + 1;
    insert into storage.objects (bucket_id, name, owner_id) values (b.id, 'someone/sample-' || b.id || '.bin', 'someone');
    for o in select * from test.gate_accounts where kind in ('pending', 'rejected', 'deactivated') order by kind loop
      insert into storage.objects (bucket_id, name, owner_id) values (b.id, o.id || '/own-' || b.id || '.bin', o.id::text);  -- the account's own folder, the most a policy could ever allow
    end loop;
    select count(*) into total from storage.objects where bucket_id = b.id;
    assert test.count_as(v_admin, format('select count(*) from storage.objects where bucket_id = %L', b.id)) = total,
      b.id || ': the active control does not read every object of the opened-up bucket';
    for o in select * from test.gate_accounts where kind in ('pending', 'rejected', 'deactivated') order by kind loop
      assert test.count_as(o.id, format('select count(*) from storage.objects where bucket_id = %L', b.id)) = 0, format('%s account lists objects of %s, its own folder included', o.kind, b.id);
      message := test.error_as(o.id, format('insert into storage.objects (bucket_id, name, owner_id) values (%L, %L, %L)', b.id, o.id || '/new-' || b.id || '.bin', o.id::text));
      assert message like 'new row violates row-level security policy%', format('%s account uploads to %s: [%s]', o.kind, b.id, coalesce(message, 'no error'));
      assert test.count_as(o.id, format('with u as (update storage.objects set name = name where bucket_id = %L returning 1) select count(*) from u', b.id)) = 0, format('%s account updates objects of %s', o.kind, b.id);
      assert test.count_as(o.id, format('with d as (delete from storage.objects where bucket_id = %L returning 1) select count(*) from d', b.id)) = 0, format('%s account deletes objects of %s', o.kind, b.id);
    end loop;
    select count(*) into seen from storage.objects where bucket_id = b.id;
    assert seen = total, b.id || ': objects changed during the probes';
    -- The control may write there (so the refusals above are the gate, not a broken probe).
    assert test.error_as(v_admin, format('insert into storage.objects (bucket_id, name, owner_id) values (%L, %L, %L)', b.id, v_admin || '/ctl-' || b.id || '.bin', v_admin::text)) is null,
      b.id || ': the active control cannot upload to the opened-up bucket';
  end loop;
  assert buckets >= 6, 'the loop saw only ' || buckets || ' buckets';
end $$;

-- ---------------------------------------------------------------------------
-- Part 4. Every function a signed-in user may call.
-- ---------------------------------------------------------------------------
create table test.gate_ids (kind text primary key, val text not null);
insert into test.gate_ids
select k, v from (values
  ('session',       (select id::text from public.attendance_sessions limit 1)),
  ('subgroup',      (select id::text from public.subgroups limit 1)),
  ('expense',       (select id::text from public.finance_expenses limit 1)),
  ('claim',         (select id::text from public.funding_claims limit 1)),
  ('reimbursement', (select id::text from public.personal_reimbursements limit 1)),
  ('payment',       (select id::text from public.finance_payments limit 1)),
  ('document',      (select id::text from public.finance_documents limit 1)),
  ('resource',      (select id::text from public.resources limit 1)),
  ('excuse',        (select id::text from public.attendance_excuses limit 1)),
  ('remediation',   (select id::text from public.attendance_remediations limit 1)),
  ('event',         (select id::text from public.events limit 1)),
  ('member',        (select id::text from test.gate_accounts where kind = 'member'))
) x(k, v) where v is not null;

create function test.arg_literal(p_name text, p_type oid) returns text language plpgsql as $$
declare typ text := format_type(p_type, null); want text; val text;
begin
  if typ in ('bigint', 'uuid') then
    want := case
      when p_name like '%session_id' then 'session'
      when p_name like '%subgroup_id' then 'subgroup'
      when p_name like '%expense_id' then 'expense'
      when p_name like '%claim_id' then 'claim'
      when p_name like '%reimbursement_id' then 'reimbursement'
      when p_name like '%payment_id' then 'payment'
      when p_name like '%document_id' then 'document'
      when p_name like '%resource_id' then 'resource'
      when p_name like '%excuse_id' then 'excuse'
      when p_name like '%remediation_id' then 'remediation'
      when p_name like '%event_id' then 'event'
      when p_name like '%member_id' or p_name like '%target_id' then 'member'
      when p_name like '%path' then null
      else null end;
    select g.val into val from test.gate_ids g where g.kind = want;
    if val is not null then return format('%L::%s', val, typ); end if;
  end if;
  return test.sample_literal(p_type, p_name);
end $$;

do $$
declare
  f record; o record;
  call_sql text; arg_list text; answer jsonb; before_fp numeric; after_fp numeric;
  exercised integer := 0; refused integer := 0; answered_nothing integer := 0;
  problems text[] := '{}';
  -- Functions whose answer is not "nothing" for an outsider, and what is checked instead.
  --   rows  no row beyond the caller's own profile, in the one json value the function returns (what
  --         is left are echoes of the arguments and digests of an empty set)
  --   true  answers true whatever it is asked (see the migration: an inactive caller is told every
  --         path is registered, so a policy that asks "not registered" says no)
  --   any   a pure predicate over the row it is handed (a policy passes the row in); it reads no
  --         table for it, and the tables are behind the gate (Part 2)
  --   skip  checked in detail in 76_membership_gate.test.sql
  allowed jsonb := jsonb_build_object(
    'public.get_portal_bootstrap()', 'skip',
    'public.get_attendance_workspace(text,bigint,timestamp with time zone)', 'rows',
    'public.get_attendance_overview(text,bigint,text,timestamp with time zone,integer)', 'rows',
    'public.get_attendance_pulse(text,bigint,text,timestamp with time zone)', 'rows',
    'public.get_attendance_roster(bigint)', 'rows',
    'private.attendance_items_version(bigint[])', 'any',
    'private.attendance_roster_version(bigint)', 'any',
    'private.finance_path_registered(text)', 'true',
    'private.can_view_resource(bigint,archive_visibility,resource_status,uuid)', 'any',
    'private.can_manage_resource(bigint,archive_visibility)', 'any',
    'private.can_manage_resource_import(bigint,uuid)', 'any');
  mode text;
begin
  for f in
    select p.oid, n.nspname::text as schema, p.proname::text as name, p.proargnames, p.proargtypes::oid[] as argtypes,
           n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as ident,
           (n.nspname || '.' || p.proname || '(' || replace(oidvectortypes(p.proargtypes), ', ', ',') || ')') as compact
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private') and p.prokind = 'f' and p.prorettype <> 'trigger'::regtype
      and has_function_privilege('authenticated', p.oid, 'execute')
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
    order by 1, 2
  loop
    -- Positional arguments, typed.
    select coalesce(string_agg(test.arg_literal(coalesce(f.proargnames[i], ''), f.argtypes[i]), ', ' order by i), '')
      into arg_list from generate_subscripts(f.argtypes, 1) i;
    call_sql := format('select coalesce(jsonb_agg(to_jsonb(x)), ''[]''::jsonb) from (select * from %I.%I(%s)) x', f.schema, f.name, arg_list);
    for o in select * from test.gate_accounts where kind in ('pending', 'rejected', 'deactivated') order by kind loop
      exercised := exercised + 1;
      before_fp := test.fingerprint();
      answer := null;
      perform test.login(o.id);
      begin
        execute call_sql into answer;
      exception when others then
        answer := null;
        refused := refused + 1;
      end;
      perform test.logout();
      after_fp := test.fingerprint();
      if before_fp <> after_fp then problems := problems || format('%s changed the database for a %s account', f.ident, o.kind); end if;
      if answer is not null then
        answered_nothing := answered_nothing + 1;
        mode := allowed ->> f.compact;
        if mode is null and not test.says_nothing(answer) then
          problems := problems || format('%s answered a %s account with data: %s', f.ident, o.kind, left(answer::text, 200));
        elsif mode = 'rows' and coalesce(test.rows_in(answer -> 0, o.id), 0) > 0 then
          problems := problems || format('%s answered a %s account with rows: %s', f.ident, o.kind, left(answer::text, 200));
        elsif mode = 'true' and answer <> '[{"finance_path_registered": true}]'::jsonb then
          problems := problems || format('%s did not answer true to a %s account: %s', f.ident, o.kind, answer::text);
        end if;
      end if;
    end loop;
  end loop;
  assert cardinality(problems) = 0, E'the gate has a hole:\n  ' || array_to_string(problems, E'\n  ');
  assert exercised >= 74 * 3, 'only ' || exercised || ' calls were made: the enumeration missed functions';
  -- Most calls are refused outright: if almost none were, the probes are not reaching the functions.
  assert refused >= exercised / 2, format('only %s of %s calls were refused', refused, exercised);
end $$;

rollback;
