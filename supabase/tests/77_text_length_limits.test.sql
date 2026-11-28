-- Phase 4.3 / 4.4 (migration 20261128030300): upper bounds on free-text columns, added NOT VALID.
--
--   A. Catalog: the list of limits is written out here and compared with the constraints in both directions.
--   B. Every constraint, on a scratch copy of its table: exactly the limit is accepted, one more is refused,
--      and the limit counts characters (multi-byte text), and NULL passes.
--   C. The real client paths: direct writes (events, recordings, profiles) and the functions (create_subgroup,
--      set_attendance_status, record_club_expense), at the limit and one over.
--   D. NOT VALID: an old row that is already over a limit is still readable, cannot be edited until it is
--      shortened, is found by the query of the migration header, and VALIDATE then succeeds.
begin;

create function test.m77t_msg(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return null; exception when others then return sqlerrm; end $$;

-- ---------------------------------------------------------------------------------------------------------
-- A. Catalog
-- ---------------------------------------------------------------------------------------------------------
create temp table m77t_expected (tbl text, col text, max_chars int, primary key (tbl, col));
insert into m77t_expected values
  ('archive_items', 'title', 200), ('archive_items', 'description', 2000), ('archive_items', 'raga', 80), ('archive_items', 'tala', 80), ('archive_items', 'storage_path', 1024),
  ('attendance_eligibility', 'term_key', 40), ('attendance_eligibility', 'reason', 1000),
  ('attendance_excuses', 'review_note', 1000), ('attendance_excuses', 'proof_path', 1024),
  ('attendance_records', 'note', 1000), ('attendance_remediations', 'assignment', 1000), ('attendance_remediations', 'note', 1000),
  ('attendance_sessions', 'title', 200), ('attendance_sessions', 'cancel_reason', 1000),
  ('events', 'title', 200), ('events', 'description', 2000), ('events', 'location', 200),
  ('finance_documents', 'storage_path', 1024), ('finance_documents', 'mime_type', 255),
  ('finance_expenses', 'vendor', 200), ('finance_expenses', 'event_name', 200), ('finance_expenses', 'event_schedule', 2000), ('finance_expenses', 'notes', 2000), ('finance_expenses', 'void_reason', 1000),
  ('finance_payments', 'category', 80), ('finance_payments', 'account_name', 120), ('finance_payments', 'counterparty', 200), ('finance_payments', 'void_reason', 1000),
  ('funding_claims', 'funder_name', 200), ('funding_claims', 'award_reference', 120), ('funding_claims', 'heellife_reference', 120), ('funding_claims', 'notes', 2000), ('funding_claims', 'void_reason', 1000),
  ('personal_reimbursements', 'member_note', 2000), ('personal_reimbursements', 'review_note', 2000), ('personal_reimbursements', 'void_reason', 1000),
  ('profiles', 'full_name', 200), ('profiles', 'phone', 40), ('profiles', 'class_year', 40), ('profiles', 'specialty', 200),
  ('recording_notes', 'title', 200), ('recording_notes', 'body', 20000), ('recording_notes', 'storage_path', 1024), ('recording_notes', 'mime_type', 255),
  ('recordings', 'title', 200), ('recordings', 'description', 2000), ('recordings', 'storage_path', 1024), ('recordings', 'mime_type', 255),
  ('recordings', 'recording_kind', 80), ('recordings', 'raga', 80), ('recordings', 'tala', 80), ('recordings', 'sruthi', 80), ('recordings', 'tempo', 80),
  ('resources', 'season_label', 120), ('subgroups', 'name', 120), ('subgroups', 'description', 2000);
grant select on m77t_expected to public;

do $$
declare
  problems text;
begin
  -- every constraint named *_max_length is in the list with the same limit, and the other way round
  select string_agg(format('%s.%s', coalesce(x.tbl, a.tbl), coalesce(x.col, a.col)), ', ') into problems
  from m77t_expected x
  full join (
    select c.conrelid::regclass::text as tbl, substring(pg_get_constraintdef(c.oid) from 'char_length\(([a-z_]+)\)') as col,
           substring(pg_get_constraintdef(c.oid) from '<= ([0-9]+)\)')::int as max_chars, c.conname
    from pg_constraint c
    where c.contype = 'c' and c.connamespace = 'public'::regnamespace and c.conname like '%\_max\_length'
  ) a on a.tbl = x.tbl and a.col = x.col
  where x.tbl is null or a.tbl is null or x.max_chars is distinct from a.max_chars or a.conname is distinct from x.tbl || '_' || x.col || '_max_length';
  if problems is not null then raise exception 'TEXT LIMITS catalog: the list and the constraints differ on: %', problems; end if;
  -- they are all CHECK constraints on the public tables, and none was validated by the migration (production is not scanned)
  select string_agg(c.conname, ', ') into problems from pg_constraint c
  where c.conname like '%\_max\_length' and c.connamespace = 'public'::regnamespace and c.convalidated;
  if problems is not null then raise exception 'TEXT LIMITS: validated on replay (the migration adds them NOT VALID): %', problems; end if;
  assert (select count(*) from m77t_expected) = (select count(*) from pg_constraint where conname like '%\_max\_length' and connamespace = 'public'::regnamespace), 'the same number';
end $$;

-- ---------------------------------------------------------------------------------------------------------
-- B. Every constraint on a scratch copy of its table
-- ---------------------------------------------------------------------------------------------------------
do $$
declare
  x record;
  r record;
  m text;
  n int := 0;
begin
  for x in select e.tbl, e.col, e.max_chars, e.tbl || '_' || e.col || '_max_length' as conname from m77t_expected e order by 1, 2 loop
    execute format('create temp table m77t_copy (like public.%I including constraints) on commit drop', x.tbl);
    for r in select attname from pg_attribute where attrelid = 'pg_temp.m77t_copy'::regclass and attnum > 0 and not attisdropped and attnotnull loop
      execute format('alter table pg_temp.m77t_copy alter column %I drop not null', r.attname);
    end loop;
    for r in select conname from pg_constraint where conrelid = 'pg_temp.m77t_copy'::regclass and contype = 'c' and conname <> x.conname loop
      execute format('alter table pg_temp.m77t_copy drop constraint %I', r.conname);
    end loop;
    assert exists (select 1 from pg_constraint where conrelid = 'pg_temp.m77t_copy'::regclass and conname = x.conname), 'the copy carries ' || x.conname;
    -- exactly the limit
    m := test.m77t_msg(format('insert into pg_temp.m77t_copy (%I) values (repeat(''x'', %s))', x.col, x.max_chars));
    if m is not null then raise exception 'TEXT LIMITS %.%: exactly % characters should be accepted, got [%]', x.tbl, x.col, x.max_chars, m; end if;
    -- one more
    m := test.m77t_msg(format('insert into pg_temp.m77t_copy (%I) values (repeat(''x'', %s))', x.col, x.max_chars + 1));
    if m is null or m not like '%' || x.conname || '%' then raise exception 'TEXT LIMITS %.%: % characters should be refused by %, got [%]', x.tbl, x.col, x.max_chars + 1, x.conname, coalesce(m, 'no error'); end if;
    -- characters, not bytes (chr(233) is one character in any encoding; the replay cluster is SQL_ASCII, where bytes and characters coincide, production is UTF8 where char_length counts characters)
    m := test.m77t_msg(format('insert into pg_temp.m77t_copy (%I) values (repeat(chr(233), %s))', x.col, x.max_chars));
    if m is not null then raise exception 'TEXT LIMITS %.%: multi-byte text at the limit should be accepted, got [%]', x.tbl, x.col, m; end if;
    -- NULL and the empty string pass (the limit is an upper bound; the NOT NULL and the screens decide the rest)
    m := test.m77t_msg(format('insert into pg_temp.m77t_copy (%I) values (null), ('''')', x.col));
    if m is not null then raise exception 'TEXT LIMITS %.%: NULL and empty should pass, got [%]', x.tbl, x.col, m; end if;
    execute 'drop table pg_temp.m77t_copy';
    n := n + 1;
  end loop;
  assert n = 56, format('%s constraints exercised', n);
end $$;

-- ---------------------------------------------------------------------------------------------------------
-- C. The real client paths
-- ---------------------------------------------------------------------------------------------------------
do $$
declare
  v_exec uuid := test.make_user('Exec F77t', 'executive');
  v_mem uuid := test.make_user('Member F77t');
  v_g bigint; v_s bigint; v_rec bigint; v_ev bigint;
  m text;
begin
  perform test.login(v_exec);
  select id into v_g from public.create_subgroup('F77t Ensemble', '', 'open');
  perform public.add_subgroup_member(v_g, v_mem);
  perform test.logout();

  -- direct write: events (executive)
  m := test.error_as(v_exec, format('insert into public.events(title, starts_at, created_by) values (repeat(''t'', 200), now(), %L)', v_exec));
  assert m is null, 'a 200-character title is accepted: ' || coalesce(m, '');
  m := test.error_as(v_exec, format('insert into public.events(title, starts_at, created_by) values (repeat(''t'', 201), now(), %L)', v_exec));
  assert m like '%events_title_max_length%', 'a 201-character title is refused: ' || coalesce(m, 'no error');
  m := test.error_as(v_exec, format('insert into public.events(title, description, starts_at, created_by) values (''ok'', repeat(''d'', 2001), now(), %L)', v_exec));
  assert m like '%events_description_max_length%', 'a 2001-character description is refused: ' || coalesce(m, 'no error');
  m := test.error_as(v_exec, format('insert into public.events(title, location, starts_at, created_by) values (''ok'', repeat(''l'', 201), now(), %L)', v_exec));
  assert m like '%events_location_max_length%', 'a 201-character location is refused: ' || coalesce(m, 'no error');
  select id into v_ev from public.events where title = repeat('t', 200);
  m := test.error_as(v_exec, format('update public.events set title = repeat(''u'', 201) where id = %s', v_ev));
  assert m like '%events_title_max_length%', 'an edit to 201 characters is refused: ' || coalesce(m, 'no error');
  m := test.error_as(v_exec, format('update public.events set title = ''shorter'' where id = %s', v_ev));
  assert m is null, 'an ordinary edit is accepted: ' || coalesce(m, '');

  -- direct write: recordings (member of the group)
  m := test.error_as(v_mem, format('insert into public.recordings(title, description, subgroup_id, uploaded_by, storage_path, status, audience) values (''F77t take'', repeat(''d'', 2000), %s, %L, %L, ''draft'', ''subgroup'')', v_g, v_mem, v_mem || '/f77t/a.webm'));
  assert m is null, 'a recording with a 2000-character description is accepted: ' || coalesce(m, '');
  select id into v_rec from public.recordings where title = 'F77t take';
  m := test.error_as(v_mem, format('update public.recordings set description = repeat(''d'', 2001) where id = %s', v_rec));
  assert m like '%recordings_description_max_length%', 'an edit to a 2001-character description is refused: ' || coalesce(m, 'no error');
  m := test.error_as(v_mem, format('update public.recordings set raga = repeat(''r'', 81) where id = %s', v_rec));
  assert m like '%recordings_raga_max_length%', 'a 81-character raga is refused: ' || coalesce(m, 'no error');
  m := test.error_as(v_mem, format('insert into public.recording_notes(recording_id, title, note_type, body, uploaded_by) values (%s, ''F77t'', ''text'', repeat(''n'', 20001), %L)', v_rec, v_mem));
  assert m like '%recording_notes_body_max_length%', 'a 20001-character notation text is refused: ' || coalesce(m, 'no error');
  m := test.error_as(v_mem, format('insert into public.recording_notes(recording_id, title, note_type, body, uploaded_by) values (%s, ''F77t'', ''text'', repeat(''n'', 20000), %L)', v_rec, v_mem));
  assert m is null, 'a 20000-character notation text is accepted: ' || coalesce(m, '');

  -- direct write: a member's own contact details (column grants on profiles)
  m := test.error_as(v_mem, format('update public.profiles set full_name = repeat(''n'', 200), phone = repeat(''1'', 40), class_year = ''Junior'', specialty = repeat(''s'', 200) where id = %L', v_mem));
  assert m is null, 'contact details at the limits are accepted: ' || coalesce(m, '');
  m := test.error_as(v_mem, format('update public.profiles set full_name = repeat(''n'', 201) where id = %L', v_mem));
  assert m like '%profiles_full_name_max_length%', 'a 201-character name is refused: ' || coalesce(m, 'no error');
  m := test.error_as(v_mem, format('update public.profiles set phone = repeat(''1'', 41) where id = %L', v_mem));
  assert m like '%profiles_phone_max_length%', 'a 41-character phone is refused: ' || coalesce(m, 'no error');
  m := test.error_as(v_mem, format('update public.profiles set specialty = repeat(''s'', 201) where id = %L', v_mem));
  assert m like '%profiles_specialty_max_length%', 'a 201-character specialty is refused: ' || coalesce(m, 'no error');

  -- functions
  m := test.error_as(v_exec, 'select public.create_subgroup(repeat(''g'', 121), '''', ''open'')');
  assert m like '%subgroups_name_max_length%', 'a 121-character group name is refused: ' || coalesce(m, 'no error');
  m := test.error_as(v_exec, 'select public.create_subgroup(repeat(''g'', 120), repeat(''d'', 2000), ''open'')');
  assert m is null, 'a 120-character name with a 2000-character description is accepted: ' || coalesce(m, '');
  m := test.error_as(v_exec, format('select public.update_subgroup(%s, ''F77t Ensemble'', repeat(''d'', 2001))', v_g));
  assert m is not null, 'the function already refused a 2001-character description: ' || coalesce(m, 'no error');

  perform test.login(v_exec);
  select id into v_s from public.create_attendance_session('subgroup', v_g, 'F77t meeting', now() - interval '1 hour');
  perform public.open_attendance_session(v_s, 30);
  perform test.logout();
  m := test.error_as(v_exec, format('select public.set_attendance_status(%s, %L, ''absent'', repeat(''n'', 1001), 0)', v_s, v_mem));
  assert m like '%attendance_records_note_max_length%', 'a 1001-character note on a mark is refused: ' || coalesce(m, 'no error');
  m := test.error_as(v_exec, format('select public.set_attendance_status(%s, %L, ''absent'', repeat(''n'', 1000), 0)', v_s, v_mem));
  assert m is null, 'a 1000-character note on a mark is accepted: ' || coalesce(m, '');
  m := test.error_as(v_exec, format('select public.create_attendance_session(''subgroup'', %s, repeat(''t'', 201), now())', v_g));
  assert m like '%attendance_sessions_title_max_length%', 'a 201-character meeting title is refused: ' || coalesce(m, 'no error');

  m := test.error_as(v_exec, 'select public.record_club_expense(''F77t snacks'', repeat(''v'', 201), 12, date ''2026-11-02'', ''Food'', ''Club bank account'', ''4242'')');
  assert m like '%finance_expenses_vendor_max_length%', 'a 201-character vendor is refused: ' || coalesce(m, 'no error');
  m := test.error_as(v_exec, 'select public.record_club_expense(''F77t snacks'', repeat(''v'', 200), 12, date ''2026-11-02'', ''Food'', repeat(''a'', 121), ''4242'')');
  assert m like '%finance_payments_account_name_max_length%', 'a 121-character account name is refused: ' || coalesce(m, 'no error');
  m := test.error_as(v_mem, 'select public.submit_member_reimbursement(''F77t request'', ''Shop'', 10, date ''2026-11-04'', ''Supplies'', ''1111'', repeat(''n'', 2001))');
  assert m like '%max_length%', 'a 2001-character note for the treasurer is refused: ' || coalesce(m, 'no error');
  m := test.error_as(v_mem, 'select public.submit_member_reimbursement(''F77t request'', ''Shop'', 10, date ''2026-11-04'', ''Supplies'', ''1111'', repeat(''n'', 2000))');
  assert m is null, 'a 2000-character note for the treasurer is accepted: ' || coalesce(m, '');
end $$;

-- ---------------------------------------------------------------------------------------------------------
-- D. NOT VALID: an old row over the limit
-- ---------------------------------------------------------------------------------------------------------
do $$
declare
  v_exec uuid := test.make_user('Exec F77t D', 'executive');
  v_ev bigint;
  offenders int;
  m text;
begin
  -- an old row, written before the limit existed: the constraint is dropped and put back the way the migration adds it
  alter table public.events drop constraint events_description_max_length;
  insert into public.events(title, description, starts_at, created_by) values ('F77t old row', repeat('o', 5000), now(), v_exec) returning id into v_ev;
  alter table public.events add constraint events_description_max_length check (char_length(description) <= 2000) not valid;

  assert (select char_length(description) from public.events where id = v_ev) = 5000, 'the old row reads as it was';
  m := test.error_as(v_exec, format('update public.events set location = ''Hall'' where id = %s', v_ev));
  assert m like '%events_description_max_length%', 'editing another column of the old row is refused until it is shortened: ' || coalesce(m, 'no error');
  m := test.error_as(v_exec, format('update public.events set description = repeat(''s'', 100) where id = %s', v_ev));
  assert m is null, 'shortening the old row works: ' || coalesce(m, '');

  -- the query of the migration header finds offenders
  alter table public.events drop constraint events_description_max_length;
  update public.events set description = repeat('o', 5000) where id = v_ev;
  alter table public.events add constraint events_description_max_length check (char_length(description) <= 2000) not valid;
  select (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from %s where not (%s)', c.conrelid::regclass, pg_get_expr(c.conbin, c.conrelid)), false, true, '')))[1]::text::int
    into offenders
  from pg_constraint c where c.contype = 'c' and not c.convalidated and c.conname = 'events_description_max_length';
  assert offenders = 1, format('the header query counts the old row (%s)', offenders);
  m := test.m77t_msg('alter table public.events validate constraint events_description_max_length');
  assert m like '%events_description_max_length%', 'VALIDATE refuses while an old row is over the limit: ' || coalesce(m, 'no error');
  update public.events set description = repeat('s', 100) where id = v_ev;
  m := test.m77t_msg('alter table public.events validate constraint events_description_max_length');
  assert m is null, 'VALIDATE succeeds once the row is shortened: ' || coalesce(m, '');
  assert (select convalidated from pg_constraint where conname = 'events_description_max_length');
end $$;

rollback;
