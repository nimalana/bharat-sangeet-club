-- Least privilege (migration 20261127075000): who holds which privilege on which table.
--
-- Part 1 is a matrix. For every table in public and private it states the exact
-- privileges anon and authenticated hold, and fails if a table has no row (a new
-- table must be added here with the least it needs) or if any role holds more or
-- less than the row says. It also checks sequences and the default privileges.
-- The matrix is typed here independently of the migration, so a change in one
-- place without the other fails.
-- Part 2 proves the matrix is not too tight: every write path the frontend uses
-- still works as the signed-in role, through the same role switch PostgREST makes.
-- Part 3 proves it is not too loose: the old direct writes to the ledger and the
-- other tables meant to be written through audited functions are refused.
begin;

-- ---------------------------------------------------------------------------
-- The matrix. Privileges are listed alphabetically; an empty string means none.
-- Column-level privileges (granted for some columns only) are listed separately.
-- ---------------------------------------------------------------------------
create table test.expected_grants (
  rel text primary key,        -- schema.table
  anon text not null,          -- table-level privileges of anon
  auth text not null,          -- table-level privileges of authenticated
  auth_cols text not null default ''  -- column-level privileges of authenticated, e.g. UPDATE(a,b)
);
insert into test.expected_grants (rel, anon, auth, auth_cols) values
  ('public.admin_audit_log',                 '',       'SELECT', ''),
  ('public.announcements',                   '',       'DELETE,INSERT,SELECT,UPDATE', ''),
  ('public.archive_items',                   'SELECT', 'DELETE,INSERT,SELECT,UPDATE', ''),
  ('public.attendance_eligibility',          '',       'SELECT', ''),
  ('public.attendance_excuses',              '',       'SELECT', ''),
  ('public.attendance_record_audit',         '',       'SELECT', ''),
  ('public.attendance_records',              '',       'SELECT', ''),
  ('public.attendance_remediations',         '',       'SELECT', ''),
  ('public.attendance_session_participants', '',       'SELECT', ''),
  ('public.attendance_sessions',             '',       'SELECT', ''),
  ('public.attendance_settings',             '',       'SELECT', ''),
  ('public.events',                          '',       'DELETE,INSERT,SELECT,UPDATE', ''),
  ('public.finance_audit_log',               '',       'SELECT', ''),
  ('public.finance_claim_documents',         '',       'INSERT,SELECT', ''),
  ('public.finance_documents',               '',       'INSERT,SELECT', ''),
  ('public.finance_expense_documents',       '',       'INSERT,SELECT', ''),
  ('public.finance_expenses',                '',       'SELECT', ''),
  ('public.finance_payments',                '',       'SELECT', ''),
  ('public.finance_reimbursement_documents', '',       'INSERT,SELECT', ''),
  ('public.funding_claim_expenses',          '',       'SELECT', ''),
  ('public.funding_claims',                  '',       'SELECT', ''),
  ('public.member_deactivations',            '',       'SELECT', ''),
  ('public.personal_reimbursements',         '',       'SELECT', ''),
  ('public.profiles',                        '',       'SELECT', 'UPDATE(class_year,full_name,phone,specialty)'),
  ('public.recording_notes',                 '',       'DELETE,INSERT,SELECT,UPDATE', ''),
  ('public.recordings',                      '',       'DELETE,INSERT,SELECT,UPDATE', ''),
  ('public.resource_imports',                '',       'INSERT,SELECT,UPDATE', ''),
  ('public.resource_links',                  '',       'SELECT', ''),
  ('public.resource_tag_assignments',        '',       'SELECT', ''),
  ('public.resource_tags',                   '',       'SELECT', ''),
  ('public.resources',                       '',       'DELETE,INSERT,SELECT,UPDATE', ''),
  ('public.signup_reviews',                  '',       'SELECT', ''),
  ('public.subgroup_memberships',            '',       'SELECT', ''),
  ('public.subgroups',                       '',       'SELECT', ''),
  ('public.transactions',                    '',       'SELECT', '');

-- Raises one exception that lists every difference between the database and the matrix.
create function test.assert_grants_match() returns void language plpgsql as $$
declare
  all_privs text[] := array['DELETE', 'INSERT', 'REFERENCES', 'SELECT', 'TRIGGER', 'TRUNCATE', 'UPDATE']
                      || case when current_setting('server_version_num')::int >= 170000 then array['MAINTAIN'] else array[]::text[] end;
  rel record;
  role_name text;
  held text;
  held_cols text;
  want text;
  want_cols text;
  problems text[] := '{}';
  seq record;
begin
  for rel in
    select c.oid, n.nspname || '.' || c.relname as name
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('public', 'private') and c.relkind in ('r', 'p', 'v', 'm', 'f')
    order by 2
  loop
    if not exists (select 1 from test.expected_grants e where e.rel = rel.name) then
      problems := problems || format('%s has no row in the matrix of 72_grants_matrix.test.sql: add one with the least privilege it needs', rel.name);
      continue;
    end if;
    for role_name in select unnest(array['anon', 'authenticated']) loop
      select string_agg(p, ',' order by p) into held from unnest(all_privs) p where has_table_privilege(role_name, rel.oid, p);
      -- privileges that exist for some columns only (has_column_privilege is also true for a table-wide privilege)
      select string_agg(format('%s(%s)', priv, cols), ' ' order by priv) into held_cols
      from (
        select priv, string_agg(a.attname, ',' order by a.attname) as cols
        from pg_attribute a cross join unnest(array['INSERT', 'REFERENCES', 'SELECT', 'UPDATE']) priv
        where a.attrelid = rel.oid and a.attnum > 0 and not a.attisdropped
          and not has_table_privilege(role_name, rel.oid, priv)
          and has_column_privilege(role_name, rel.oid, a.attnum, priv)
        group by priv
      ) s;
      select case role_name when 'anon' then e.anon else e.auth end, case role_name when 'anon' then '' else e.auth_cols end
        into want, want_cols from test.expected_grants e where e.rel = rel.name;
      if coalesce(held, '') <> want then
        problems := problems || format('%s: %s holds [%s] but the matrix says [%s]', rel.name, role_name, coalesce(held, ''), want);
      end if;
      if coalesce(held_cols, '') <> want_cols then
        problems := problems || format('%s: %s holds column privileges [%s] but the matrix says [%s]', rel.name, role_name, coalesce(held_cols, ''), want_cols);
      end if;
    end loop;
  end loop;
  -- a row for a table that does not exist is a typo
  for rel in select e.rel from test.expected_grants e where to_regclass(e.rel) is null loop
    problems := problems || format('the matrix lists %s, which does not exist', rel.rel);
  end loop;

  -- Sequences: nothing, except USAGE where a column default calls nextval() on a table
  -- the role can insert into (serial). Identity columns need none.
  for seq in
    select c.oid, n.nspname || '.' || c.relname as name, r.rolname,
      exists (
        select 1 from pg_depend d join pg_attrdef ad on ad.oid = d.objid join pg_class t on t.oid = ad.adrelid
        where d.classid = 'pg_attrdef'::regclass and d.refclassid = 'pg_class'::regclass and d.refobjid = c.oid
          and has_any_column_privilege(r.rolname, t.oid, 'insert')
      ) as needs_usage
    from pg_class c join pg_namespace n on n.oid = c.relnamespace cross join (values ('anon'), ('authenticated')) r(rolname)
    where n.nspname in ('public', 'private') and c.relkind = 'S'
    order by 2, 3
  loop
    select string_agg(p, ',' order by p) into held from unnest(array['SELECT', 'UPDATE', 'USAGE']) p where has_sequence_privilege(seq.rolname, seq.oid, p);
    if coalesce(held, '') <> (case when seq.needs_usage then 'USAGE' else '' end) then
      problems := problems || format('sequence %s: %s holds [%s]; expected %s', seq.name, seq.rolname, coalesce(held, ''),
        case when seq.needs_usage then 'USAGE only (a column default calls nextval)' else 'nothing (identity columns need no sequence privilege)' end);
    end if;
  end loop;

  -- Default privileges: new tables and sequences made by postgres are not handed out.
  select string_agg(format('for %s in %s %s to %s', d.defaclrole::regrole, d.defaclnamespace::regnamespace, d.defaclobjtype, r.rolname), '; ') into held
  from pg_default_acl d cross join lateral aclexplode(d.defaclacl) a join pg_roles r on r.oid = a.grantee
  where d.defaclobjtype in ('r', 'S') and r.rolname in ('anon', 'authenticated');
  if held is not null then problems := problems || ('default privileges still give new tables or sequences to anon or authenticated: ' || held); end if;

  if cardinality(problems) > 0 then
    raise exception E'grants differ from the matrix:\n  %', array_to_string(problems, E'\n  ');
  end if;
end $$;

-- What the privilege error looks like to PostgREST: SQLSTATE 42501 means "permission denied".
-- Returns 'ok' when the statement ran, otherwise its SQLSTATE.
create function test.state_as(p_user uuid, p_sql text) returns text language plpgsql as $$
declare st text;
begin
  perform test.login(p_user);
  begin
    execute p_sql;
    st := 'ok';
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
  end;
  perform test.logout();
  return st;
end $$;
grant execute on function test.state_as(uuid, text) to anon, authenticated;

-- ===========================================================================
-- Part 1. The matrix, and proof that the check is not vacuous.
-- ===========================================================================
select test.assert_grants_match();

do $$
declare message text;
begin
  -- A later widening is caught, whichever way it is made.
  grant truncate on public.events to authenticated;
  message := test.error_of('select test.assert_grants_match()');
  assert message like '%public.events: authenticated holds [DELETE,INSERT,SELECT,TRUNCATE,UPDATE] but the matrix says [DELETE,INSERT,SELECT,UPDATE]%', 'a new truncate grant is caught: ' || coalesce(message, 'no error');
  revoke truncate on public.events from authenticated;

  grant insert on public.finance_expenses to authenticated;
  message := test.error_of('select test.assert_grants_match()');
  assert message like '%public.finance_expenses: authenticated holds [INSERT,SELECT]%', 'a new insert grant on the ledger is caught: ' || coalesce(message, 'no error');
  revoke insert on public.finance_expenses from authenticated;

  grant select on public.subgroups to anon;
  message := test.error_of('select test.assert_grants_match()');
  assert message like '%public.subgroups: anon holds [SELECT] but the matrix says []%', 'an anon grant is caught: ' || coalesce(message, 'no error');
  revoke select on public.subgroups from anon;

  grant update (role) on public.profiles to authenticated;
  message := test.error_of('select test.assert_grants_match()');
  assert message like '%public.profiles: authenticated holds column privileges [UPDATE(class_year,full_name,phone,role,specialty)]%', 'update on profiles.role is caught: ' || coalesce(message, 'no error');
  revoke update (role) on public.profiles from authenticated;

  grant usage on sequence public.events_id_seq to authenticated;
  message := test.error_of('select test.assert_grants_match()');
  assert message like '%sequence public.events_id_seq: authenticated holds [USAGE]%', 'a sequence grant is caught: ' || coalesce(message, 'no error');
  revoke usage on sequence public.events_id_seq from authenticated;

  -- A table nobody listed is caught, and so is one created later with the old defaults.
  create table public.zz_unlisted (id integer);
  message := test.error_of('select test.assert_grants_match()');
  assert message like '%public.zz_unlisted has no row in the matrix%', 'an unlisted table is caught: ' || coalesce(message, 'no error');
  grant all on public.zz_unlisted to authenticated;
  insert into test.expected_grants values ('public.zz_unlisted', '', 'SELECT', '');
  message := test.error_of('select test.assert_grants_match()');
  assert message like '%public.zz_unlisted: authenticated holds [DELETE,INSERT,%REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE] but the matrix says [SELECT]%', 'a table granted too much is caught: ' || coalesce(message, 'no error');
  drop table public.zz_unlisted;
  delete from test.expected_grants where rel = 'public.zz_unlisted';

  perform test.assert_grants_match();
end $$;

-- ===========================================================================
-- Part 2. Every write path the frontend uses still works as the signed-in role.
-- ===========================================================================
do $$
declare
  v_exec uuid := test.make_user('Exec Seventytwo', 'executive');
  v_leader uuid := test.make_user('Leader Seventytwo');
  v_member uuid := test.make_user('Member Seventytwo');
  v_other uuid := test.make_user('Other Seventytwo');
  v_group bigint;
  v_open bigint;
  v_event bigint;
  v_ann bigint;
  v_archive bigint;
  v_folder bigint;
  v_link bigint;
  v_file bigint;
  v_pending bigint;
  v_import uuid;
  v_rec bigint;
  v_note bigint;
  v_expense bigint;
  v_member_expense bigint;
  v_reimbursement bigint;
  v_claim bigint;
  v_doc bigint;
  v_session bigint;
  message text;
  n bigint;
begin
  perform test.login(v_exec);
  select id into v_group from public.create_subgroup('Seventytwo Ensemble', '', 'approval');
  select id into v_open from public.create_subgroup('Seventytwo Open', '', 'open');
  perform public.add_subgroup_member(v_group, v_leader);
  perform public.add_subgroup_member(v_group, v_member);
  perform public.set_subgroup_member_role(v_group, v_leader, 'leader');
  perform test.logout();

  -- Calendar and announcements: insert, update (pin), delete as an executive.
  perform test.login(v_exec);
  insert into public.events (title, description, starts_at, location, subgroup_id, created_by) values ('Concert', '', now() + interval '3 days', 'Hall', null, v_exec) returning id into v_event;
  update public.events set title = 'Concert (moved)' where id = v_event;
  insert into public.announcements (title, body, is_pinned, subgroup_id, created_by) values ('Notice', 'body', false, null, v_exec) returning id into v_ann;
  update public.announcements set is_pinned = true where id = v_ann;
  delete from public.announcements where id = v_ann;
  delete from public.events where id = v_event;
  -- The legacy archive form (public concert list).
  insert into public.archive_items (title, description, type, storage_path, visibility, subgroup_id, uploaded_by, is_public)
    values ('Public concert', '', 'recording', v_exec || '/public.webm', 'members', null, v_exec, true) returning id into v_archive;
  insert into public.archive_items (title, description, type, storage_path, visibility, subgroup_id, uploaded_by, is_public)
    values ('Members only take', '', 'recording', v_exec || '/members.webm', 'members', null, v_exec, false);
  update public.archive_items set raga = 'Bhairavi' where id = v_archive;
  perform test.logout();
  -- Identity columns need no sequence privilege: the inserts above ran as authenticated without USAGE.
  assert not has_sequence_privilege('authenticated', 'public.events_id_seq', 'usage'), 'authenticated has no USAGE on the events sequence';
  assert not has_sequence_privilege('authenticated', 'public.announcements_id_seq', 'usage'), 'authenticated has no USAGE on the announcements sequence';
  message := test.state_as(v_exec, 'select nextval(''public.events_id_seq'')');
  assert message = '42501', 'nobody can draw numbers from a sequence by hand: ' || message;

  -- A member cannot do what only executives can (policy, not privilege).
  message := test.error_as(v_member, format('insert into public.events (title, starts_at, created_by) values (''x'', now(), %L)', v_member));
  assert message like 'new row violates row-level security policy%', 'a member still meets the policy: ' || coalesce(message, 'no error');

  -- Resources: an executive builds a folder, a link and an upload; a leader runs an upload of their own.
  perform test.login(v_exec);
  insert into public.resources (node_kind, title, visibility, status, created_by) values ('folder', 'Docs', 'members', 'ready', v_exec) returning id into v_folder;
  insert into public.resources (node_kind, title, parent_id, visibility, status, external_url, created_by) values ('link', 'Sheet', v_folder, 'members', 'ready', 'https://example.org', v_exec) returning id into v_link;
  insert into public.resource_imports (name, root_parent_id, visibility, status, total_files, total_bytes, created_by) values ('notes.pdf', v_folder, 'members', 'uploading', 1, 10, v_exec) returning id into v_import;
  insert into public.resources (node_kind, media_kind, title, parent_id, visibility, status, storage_bucket, storage_path, created_by)
    values ('file', 'document', 'notes.pdf', v_folder, 'members', 'pending_upload', 'club-resources', v_exec || '/a/notes.pdf', v_exec) returning id into v_file;
  update public.resources set status = 'ready', updated_at = now() where id = v_file;
  update public.resource_imports set completed_files = 1, uploaded_bytes = 10, status = 'completed' where id = v_import;
  update public.resources set is_pinned = true, title = 'Sheet (renamed)' where id = v_link;
  perform test.logout();
  perform test.login(v_leader);
  insert into public.resources (node_kind, media_kind, title, subgroup_id, visibility, status, storage_bucket, storage_path, created_by)
    values ('file', 'document', 'Pending', v_group, 'members', 'pending_upload', 'club-resources', v_leader || '/a/pending.pdf', v_leader) returning id into v_pending;
  update public.resources set status = 'failed' where id = v_pending;
  delete from public.resources where id = v_pending;
  perform test.logout();
  perform test.login(v_exec);
  delete from public.resources where id = v_link;
  perform test.logout();

  -- Recordings: a member drafts, publishes and archives a take, adds and edits notation, deletes it.
  perform test.login(v_member);
  insert into public.recordings (title, description, subgroup_id, uploaded_by, storage_path, mime_type, media_kind, status, audience, recording_kind)
    values ('Take', '', v_group, v_member, v_member || '/subgroups/' || v_group || '/take.webm', 'audio/webm', 'audio', 'draft', 'subgroup', 'practice') returning id into v_rec;
  update public.recordings set status = 'published', published_at = now(), title = 'Take one' where id = v_rec;
  insert into public.recording_notes (recording_id, title, note_type, body, storage_path, mime_type, uploaded_by)
    values (v_rec, 'Notation', 'text', 'sa ri ga', null, null, v_member) returning id into v_note;
  update public.recording_notes set body = 'sa ri ga ma' where id = v_note;
  update public.recordings set status = 'archived' where id = v_rec;
  update public.recordings set status = 'published' where id = v_rec;
  delete from public.recording_notes where id = v_note;
  delete from public.recordings where id = v_rec;
  perform test.logout();

  -- Profiles: the four editable columns work, anything else does not.
  perform test.login(v_member);
  update public.profiles set full_name = 'Member 72', phone = '1', class_year = '2028', specialty = 'violin' where id = v_member;
  perform test.logout();
  assert (select full_name || '/' || phone || '/' || class_year || '/' || specialty from public.profiles where id = v_member) = 'Member 72/1/2028/violin';
  message := test.state_as(v_member, format('update public.profiles set role = ''admin'' where id = %L', v_member));
  assert message = '42501', 'a member cannot edit their own role: ' || message;
  message := test.state_as(v_member, format('update public.profiles set status = ''active'', email = ''x@y.z'' where id = %L', v_member));
  assert message = '42501', 'a member cannot edit status or email: ' || message;
  message := test.state_as(v_member, format('delete from public.profiles where id = %L', v_member));
  assert message = '42501', 'a member cannot delete their own profile row: ' || message;
  message := test.state_as(v_exec, format('update public.profiles set role = ''admin'' where id = %L', v_member));
  assert message = '42501', 'an executive cannot promote through the table either: ' || message;

  -- Groups: asking to join goes through the function, which writes the membership as its owner.
  perform test.login(v_other);
  perform public.request_subgroup_enrollment(v_open);
  perform test.logout();
  assert (select status::text from public.subgroup_memberships where subgroup_id = v_open and member_id = v_other) = 'active', 'an open group admits at once';
  perform test.login(v_exec);
  perform public.set_subgroup_member_role(v_open, v_other, 'leader');
  perform public.update_subgroup(v_open, 'Seventytwo Open', 'edited');
  perform test.logout();

  -- Finance: the RPCs write; the executive and the member register and link documents directly.
  perform test.login(v_exec);
  v_expense := public.record_club_expense('Tabla repair', 'Shop', 100, date '2026-11-02', 'Instruments', 'Club bank account', '4242');
  perform public.record_finance_income('Gig', 400, date '2026-11-01', 'Gig revenue', 'UNC');
  perform test.logout();
  perform test.login(v_member);
  select expense_id, reimbursement_id into v_member_expense, v_reimbursement
  from public.submit_member_reimbursement('Strings', 'Shop', 40, date '2026-11-04', 'Supplies', '1111', 'For the concert');
  insert into public.finance_documents (document_type, title, storage_path, mime_type, file_size_bytes, uploaded_by)
    values ('receipt', 'Receipt', v_member || '/receipt.pdf', 'application/pdf', 1000, v_member) returning id into v_doc;
  insert into public.finance_reimbursement_documents (reimbursement_id, document_id) values (v_reimbursement, v_doc);
  insert into public.finance_expense_documents (expense_id, document_id) values (v_member_expense, v_doc);
  perform test.logout();
  perform test.login(v_exec);
  select id into v_claim from public.create_funding_claim('Fall concert', 'GPSG', 'A-1', 'H-1', date '2026-12-01', '', array[v_expense]);
  insert into public.finance_claim_documents (claim_id, document_id) values (v_claim, v_doc);
  assert (public.get_finance_summary() ->> 'available_cash') is not null, 'the summary (security invoker) still reads the ledger';
  perform test.logout();

  -- Attendance: meetings, marks and eligibility all go through functions. The eligibility one
  -- is SECURITY DEFINER (20261127090000), so the table is select-only for signed-in users.
  perform test.login(v_exec);
  select id into v_session from public.create_attendance_session('club', null, 'Seventytwo meeting', now());
  perform public.open_attendance_session(v_session, 30);
  perform public.set_attendance_status(v_session, v_member, 'present', '', 0);
  perform public.set_attendance_eligibility('2026-fall', v_member, 'under_review', 'checking');
  perform public.set_attendance_eligibility('2026-fall', v_member, 'reinstated', 'done');
  perform public.close_attendance_session(v_session);
  perform test.logout();
  assert (select status::text from public.attendance_eligibility where member_id = v_member and term_key = '2026-fall') = 'reinstated';

  -- Read functions that run as the caller still find what they read.
  assert test.state_as(v_member, 'select public.get_portal_bootstrap()') = 'ok', 'get_portal_bootstrap runs for a member';
  assert test.state_as(v_exec, 'select public.get_portal_bootstrap()') = 'ok', 'get_portal_bootstrap runs for an executive';
  assert test.state_as(v_member, 'select public.get_attendance_workspace(''all'', null)') = 'ok', 'get_attendance_workspace runs for a member';
  assert test.state_as(v_exec, 'select public.get_attendance_workspace(''all'', null)') = 'ok', 'get_attendance_workspace runs for an executive';
  assert test.state_as(v_exec, 'select public.get_finance_summary()') = 'ok', 'get_finance_summary runs for an executive';
  assert test.state_as(v_member, format('select * from public.list_subgroup_roster(%s)', v_group)) = 'ok', 'list_subgroup_roster runs for a member';

  -- The signed-out site: the public concert list under its policy, and nothing else.
  assert test.count_as(null, 'select count(*) from public.archive_items') = 1, 'anon sees only the public concert row';
  assert test.count_as(null, 'select count(*) from public.archive_items where is_public and type = ''recording''') = 1;
  assert test.count_as(null, 'select count(*) from public.archive_items where title = ''Members only take''') = 0, 'a members-only row stays hidden from anon';
  insert into storage.objects (bucket_id, name, owner_id) values ('club-archive', v_exec || '/public.webm', v_exec::text), ('club-archive', v_exec || '/members.webm', v_exec::text);
  assert test.count_as(null, 'select count(*) from storage.objects where bucket_id = ''club-archive''') = 1, 'anon can stream the public concert file only (the storage policy reads archive_items as anon)';
  assert test.count_as(v_member, 'select count(*) from storage.objects where bucket_id = ''club-archive''') = 2, 'a member reads both files';
  perform test.logout();

  -- The sequence rule: a table whose column default calls nextval() needs USAGE for the
  -- inserting role, an identity column does not. Make events serial for the length of this
  -- test, see the insert refused, then see the migration give USAGE back when it runs again.
  alter table public.events alter column id drop identity;
  create sequence public.zz_events_serial_seq owned by public.events.id;
  alter table public.events alter column id set default nextval('public.zz_events_serial_seq');
  message := test.state_as(v_exec, format('insert into public.events (title, starts_at, created_by) values (''serial'', now(), %L)', v_exec));
  assert message = '42501', 'a serial default is refused without USAGE on its sequence: ' || message;
end $$;

-- Re-running the migration changes nothing that matters: still the matrix, and now the
-- serial sequence the previous block created gets USAGE because events can be inserted into.
-- It also hands attendance_eligibility its old insert and update again (the matrix inside it
-- is frozen), so the later migration that takes them away runs again after it, as it did on
-- the first replay.
-- It likewise takes the select on signup_reviews (a table created after it) away, so the
-- membership gate's schema file runs again too, which is also the proof that it can be repeated.
\ir ../migrations/20261127075000_least_privilege_grants.sql
\ir ../migrations/20261127090000_attendance_eligibility_definer.sql
\ir ../migrations/20261128010000_membership_gate_schema.sql

do $$
declare
  v_exec uuid := (select id from public.profiles where full_name = 'Exec Seventytwo');
  message text;
begin
  assert has_sequence_privilege('authenticated', 'public.zz_events_serial_seq', 'usage'), 'the migration gives USAGE on a sequence that a column default calls';
  assert not has_sequence_privilege('anon', 'public.zz_events_serial_seq', 'usage'), 'anon gets none';
  assert not has_sequence_privilege('authenticated', 'public.zz_events_serial_seq', 'select, update'), 'USAGE only, not select or update';
  message := test.state_as(v_exec, format('insert into public.events (title, starts_at, created_by) values (''serial'', now(), %L)', v_exec));
  assert message = 'ok', 'the serial insert works after the grant: ' || message;
  assert not has_sequence_privilege('authenticated', 'public.announcements_id_seq', 'usage'), 'identity sequences stay closed';
  -- Put events back as it was, so the matrix check below sees the real shape.
  drop sequence public.zz_events_serial_seq cascade;
  alter table public.events alter column id add generated always as identity;
end $$;
select test.assert_grants_match();

-- ===========================================================================
-- Part 3. The old direct writes are refused.
-- ===========================================================================
do $$
declare
  v_exec uuid := test.make_user('Exec Seventythree', 'executive');
  v_member uuid := test.make_user('Member Seventythree');
  v_expense bigint;
  v_expense2 bigint;
  v_payment bigint;
  v_reimbursement bigint;
  v_claim bigint;
  v_session bigint;
  v_before numeric;
  message text;
  rel record;
  stmt text;
  first_col text;
  seen integer := 0;
begin
  -- Real rows the ledger now protects.
  perform test.login(v_exec);
  v_expense := public.record_club_expense('Tabla repair', 'Shop', 100, date '2026-11-02', 'Instruments', 'Club bank account', '4242');
  v_expense2 := public.record_club_expense('Snacks', 'Grocer', 20, date '2026-11-03', 'Food', 'Club bank account', '4242');
  v_payment := public.record_finance_income('Gig', 400, date '2026-11-01', 'Gig revenue', 'UNC');
  select id into v_claim from public.create_funding_claim('Fall concert', 'GPSG', 'A-1', 'H-1', date '2026-12-01', '', array[v_expense]);
  select id into v_session from public.create_attendance_session('club', null, 'Seventythree meeting', now());
  perform test.logout();
  perform test.login(v_member);
  select reimbursement_id into v_reimbursement from public.submit_member_reimbursement('Strings', 'Shop', 40, date '2026-11-04', 'Supplies', '1111', 'For the concert');
  perform test.logout();
  select amount into v_before from public.finance_expenses where id = v_expense;

  -- The edits and deletes the policies used to allow an executive, straight through the API.
  assert test.state_as(v_exec, format('update public.finance_expenses set amount = 1 where id = %s', v_expense)) = '42501', 'executive: edit an expense directly';
  assert test.state_as(v_exec, format('delete from public.finance_expenses where id = %s', v_expense)) = '42501', 'executive: delete an expense directly';
  assert test.state_as(v_exec, 'insert into public.finance_expenses (description, amount) values (''ghost'', 1)') = '42501', 'executive: insert an expense directly';
  assert test.state_as(v_exec, format('update public.finance_payments set amount = 1 where id = %s', v_payment)) = '42501', 'executive: edit a payment directly';
  assert test.state_as(v_exec, format('delete from public.finance_payments where id = %s', v_payment)) = '42501', 'executive: delete a payment directly';
  assert test.state_as(v_exec, format('update public.personal_reimbursements set status = ''paid'' where id = %s', v_reimbursement)) = '42501', 'executive: mark a reimbursement paid directly';
  assert test.state_as(v_exec, format('delete from public.personal_reimbursements where id = %s', v_reimbursement)) = '42501', 'executive: delete a reimbursement directly';
  assert test.state_as(v_exec, format('update public.funding_claims set status = ''approved'' where id = %s', v_claim)) = '42501', 'executive: approve a claim directly';
  assert test.state_as(v_exec, format('delete from public.funding_claims where id = %s', v_claim)) = '42501', 'executive: delete a claim directly';
  assert test.state_as(v_exec, format('insert into public.funding_claim_expenses (claim_id, expense_id, claimed_amount) values (%s, %s, 1)', v_claim, v_expense)) = '42501', 'executive: link an expense to a claim directly';
  assert test.state_as(v_exec, format('delete from public.funding_claim_expenses where claim_id = %s', v_claim)) = '42501', 'executive: unlink an expense directly';
  assert test.state_as(v_exec, format('update public.attendance_sessions set status = ''closed'' where id = %s', v_session)) = '42501', 'executive: close a meeting directly';
  assert test.state_as(v_exec, 'delete from public.attendance_records') = '42501', 'executive: delete attendance marks directly';
  assert test.state_as(v_exec, format('insert into public.attendance_eligibility (term_key, member_id, status, updated_by, updated_at) values (''2026-fall'', %L, ''reinstated'', %L, now())', v_member, v_exec)) = '42501', 'executive: write an eligibility row directly, with a chosen author';
  assert test.state_as(v_exec, 'update public.attendance_eligibility set updated_by = null, updated_at = now() - interval ''1 year''') = '42501', 'executive: rewrite who set an eligibility and when';
  assert test.state_as(v_exec, 'delete from public.finance_audit_log') = '42501', 'executive: erase the finance audit trail';
  assert test.state_as(v_exec, 'update public.attendance_record_audit set note = ''x''') = '42501', 'executive: rewrite the attendance audit trail';
  assert test.state_as(v_exec, 'insert into public.admin_audit_log (action) values (''forged'')') = '42501', 'executive: forge an admin audit entry';
  assert test.state_as(v_exec, format('insert into public.subgroup_memberships (subgroup_id, member_id, status) values (1, %L, ''active'')', v_member)) = '42501', 'executive: add a member to a group directly';
  assert test.state_as(v_exec, 'delete from public.subgroups') = '42501', 'executive: delete groups directly';
  assert test.state_as(v_exec, 'delete from public.transactions') = '42501', 'executive: delete from the legacy ledger';
  assert test.state_as(v_exec, 'truncate public.finance_expenses') = '42501', 'executive: truncate the ledger';
  assert test.state_as(v_member, 'truncate public.events') = '42501', 'member: truncate events';
  assert test.state_as(null, 'truncate public.archive_items') = '42501', 'anon: truncate the public concert list';
  assert (select amount from public.finance_expenses where id = v_expense) = v_before, 'the expense is unchanged';
  assert (select count(*) from public.finance_payments where id = v_payment) = 1, 'the payment is still there';

  -- The functions that do the same things properly still work for the executive.
  perform test.login(v_exec);
  perform public.void_finance_expense(v_expense2, 'duplicate');
  perform test.logout();
  assert (select voided_at is not null from public.finance_expenses where id = v_expense2), 'the void function still works';

  -- Every table, every role: whatever the matrix withholds is refused with 42501, for each statement shape.
  for rel in
    select c.relname as tbl, (select a.attname from pg_attribute a where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped and a.attidentity = '' and a.attgenerated = '' order by a.attnum limit 1) as first_col
    from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' order by 1
  loop
    for message in select unnest(array['authenticated', 'anon']) loop
      for stmt in select unnest(array['insert', 'update', 'delete', 'truncate', 'trigger']) loop
        declare
          held boolean := case stmt when 'trigger' then has_table_privilege(message, format('public.%I', rel.tbl), 'trigger')
                                    when 'update' then has_any_column_privilege(message, format('public.%I', rel.tbl), 'update')
                                    when 'insert' then has_any_column_privilege(message, format('public.%I', rel.tbl), 'insert')
                                    else has_table_privilege(message, format('public.%I', rel.tbl), stmt) end;
          sql text := case stmt when 'insert' then format('insert into public.%I default values', rel.tbl)
                                when 'update' then format('update public.%I set %I = %I where false', rel.tbl, rel.first_col, rel.first_col)
                                when 'delete' then format('delete from public.%I where false', rel.tbl)
                                when 'truncate' then format('truncate public.%I', rel.tbl)
                                else format('create trigger zz_probe before insert on public.%I for each row execute function private.touch_event_updated_at()', rel.tbl) end;
          who uuid := case message when 'anon' then null else v_exec end;
        begin
          if held then continue; end if;
          seen := seen + 1;
          assert test.state_as(who, sql) = '42501', format('%s must be refused: %s (%s)', message, sql, test.state_as(who, sql));
        end;
      end loop;
    end loop;
  end loop;
  assert seen >= 300, 'the loop really exercised the refusals: ' || seen;
end $$;

rollback;
