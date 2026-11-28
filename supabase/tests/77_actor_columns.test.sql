-- Phase 4.3, P3-05 (migration 20261128030200): a signed-in person cannot forge who did something.
--
--   A. Catalog: every "who" column in the public schema is guarded, by an ENABLE ALWAYS BEFORE ROW trigger that
--      fires before every other BEFORE ROW trigger of the table. The expected list is written out here, so a new
--      column (or a dropped trigger) fails this file until the list and the migration agree.
--   B. The function, on a probe table: every branch of `own` and `stamp`.
--   C. Every guarded column of every table, taken from the catalog: a forged insert is refused.
--   D. The eight tables the client writes directly, as the roles that can write them, through the policies.
--   E. Real rows made by the definer functions: a forged update of the stamped column is refused.
--   F. The system's own writes still go through: no signed-in person, a foreign-key action, another trigger.
--   G. It cannot be switched off from a session (session_replication_role = replica).
begin;

create function test.m77a_msg(p_user uuid, p_sql text) returns text language plpgsql as $$
begin return test.error_as(p_user, p_sql); end $$;

-- Runs a statement as postgres while auth.uid() is p_user (what a definer function, or a trigger, sees).
create function test.m77a_as_uid(p_user uuid, p_sql text) returns text language plpgsql as $$
declare message text;
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_user::text, ''), true);
  message := test.error_of(p_sql);
  perform set_config('request.jwt.claim.sub', '', true);
  return message;
end $$;

create function test.m77a_check(p_what text, p_message text, p_expected_like text) returns void language plpgsql as $$
begin
  if p_expected_like is null then
    if p_message is not null then raise exception 'ACTOR GUARD %: expected success, got [%]', p_what, p_message; end if;
  elsif p_message is null or p_message not like p_expected_like then
    raise exception 'ACTOR GUARD %: expected [%], got [%]', p_what, p_expected_like, coalesce(p_message, 'no error');
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------------------
-- A. Catalog
-- ---------------------------------------------------------------------------------------------------------
do $$
declare
  expected text[] := array[
    'announcements.own.created_by', 'archive_items.own.uploaded_by', 'events.own.created_by', 'finance_documents.own.uploaded_by',
    'recording_notes.own.uploaded_by', 'recordings.own.uploaded_by', 'resource_imports.own.created_by', 'resources.own.created_by',
    'resource_links.stamp.created_by', 'resource_tag_assignments.stamp.created_by', 'resource_tags.stamp.created_by',
    'subgroups.stamp.created_by', 'subgroups.stamp.archived_by',
    'subgroup_memberships.stamp.added_by', 'subgroup_memberships.stamp.requested_by', 'subgroup_memberships.stamp.reviewed_by',
    'attendance_sessions.stamp.created_by', 'attendance_records.stamp.marked_by', 'attendance_record_audit.stamp.changed_by',
    'attendance_excuses.stamp.reviewed_by', 'attendance_remediations.stamp.assigned_by', 'attendance_remediations.stamp.completed_by',
    'attendance_eligibility.stamp.updated_by', 'attendance_settings.stamp.updated_by', 'member_deactivations.stamp.deactivated_by',
    'finance_expenses.stamp.created_by', 'finance_expenses.stamp.approved_by', 'finance_expenses.stamp.voided_by',
    'finance_payments.stamp.created_by', 'finance_payments.stamp.voided_by',
    'funding_claims.stamp.created_by', 'funding_claims.stamp.updated_by', 'funding_claims.stamp.voided_by',
    'personal_reimbursements.stamp.reviewed_by', 'personal_reimbursements.stamp.voided_by',
    'finance_audit_log.stamp.actor_id', 'admin_audit_log.stamp.actor_id', 'content_audit_log.stamp.actor_id', 'transactions.stamp.created_by'];
  actual text[];
  who_columns text[];
  problems text;
begin
  select coalesce(array_agg(format('%s.%s.%s', c.relname, m[1], m[2]) order by c.relname, m[2]), '{}') into actual
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid and c.relnamespace = 'public'::regnamespace
  cross join lateral regexp_matches(pg_get_triggerdef(t.oid), '''(own|stamp):([a-z_]+)''', 'g') m
  where t.tgname = 'a_guard_actor_columns' and not t.tgisinternal;
  if (select array_agg(x order by x) from unnest(actual) x) is distinct from (select array_agg(x order by x) from unnest(expected) x) then
    raise exception 'ACTOR GUARD catalog: missing [%], unexpected [%]',
      (select string_agg(x, ', ') from unnest(expected) x where x <> all (actual)),
      (select string_agg(x, ', ') from unnest(actual) x where x <> all (expected));
  end if;

  -- every uuid column that points at a person and is named like an actor is in the list
  select array_agg(format('%s.%s', c.relname, a.attname)) into who_columns
  from pg_constraint k
  join pg_attribute a on a.attrelid = k.conrelid and a.attnum = any (k.conkey)
  join pg_class c on c.oid = k.conrelid and c.relkind in ('r', 'p')
  where k.contype = 'f' and k.connamespace = 'public'::regnamespace and k.confrelid = 'public.profiles'::regclass
    and (a.attname ~ '_by$' or a.attname = 'actor_id');
  select string_agg(w, ', ') into problems
  from unnest(who_columns) w
  where not exists (select 1 from unnest(expected) x where split_part(x, '.', 1) || '.' || split_part(x, '.', 3) = w);
  if problems is not null then raise exception 'ACTOR GUARD catalog: a column that names a person is not guarded: %', problems; end if;
  -- ... and so is every actor-named column that has no foreign key at all
  select string_agg(format('%s.%s', c.table_name, c.column_name), ', ') into problems
  from information_schema.columns c
  join information_schema.tables t using (table_schema, table_name)
  where c.table_schema = 'public' and t.table_type = 'BASE TABLE' and c.data_type = 'uuid'
    and (c.column_name ~ '_by$' or c.column_name = 'actor_id')
    and not exists (select 1 from unnest(expected) x where split_part(x, '.', 1) = c.table_name and split_part(x, '.', 3) = c.column_name);
  if problems is not null then raise exception 'ACTOR GUARD catalog: an actor-named uuid column is not guarded: %', problems; end if;

  -- the trigger: BEFORE, ROW, INSERT and UPDATE, ENABLE ALWAYS, and first in name order among the BEFORE ROW triggers
  select string_agg(c.relname, ', ') into problems
  from pg_trigger t join pg_class c on c.oid = t.tgrelid
  where t.tgname = 'a_guard_actor_columns' and not t.tgisinternal
    and not ((t.tgtype & 1) = 1 and (t.tgtype & 2) = 2 and (t.tgtype & 4) = 4 and (t.tgtype & 16) = 16 and t.tgenabled = 'A');
  if problems is not null then raise exception 'ACTOR GUARD catalog: not BEFORE ROW insert+update, ENABLE ALWAYS on: %', problems; end if;
  select string_agg(format('%s (%s)', c.relname, o.tgname), ', ') into problems
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_trigger o on o.tgrelid = t.tgrelid and not o.tgisinternal and (o.tgtype & 1) = 1 and (o.tgtype & 2) = 2 and o.tgname collate "C" < t.tgname collate "C"
  where t.tgname = 'a_guard_actor_columns' and not t.tgisinternal;
  if problems is not null then raise exception 'ACTOR GUARD catalog: a BEFORE ROW trigger fires before the guard on: %', problems; end if;
  -- nobody but the owner runs the function
  assert not has_function_privilege('authenticated', 'private.guard_actor_columns()', 'execute'), 'authenticated cannot execute the guard';
  assert not has_function_privilege('anon', 'private.guard_actor_columns()', 'execute'), 'anon cannot execute the guard';
end $$;

-- ---------------------------------------------------------------------------------------------------------
-- B. The function on a probe table
-- ---------------------------------------------------------------------------------------------------------
create table test.m77a_probe (id int generated always as identity primary key, author uuid, stamped uuid, plain uuid);
create trigger a_guard_actor_columns before insert or update of author, stamped on test.m77a_probe
  for each row execute function private.guard_actor_columns('own:author', 'stamp:stamped');
alter table test.m77a_probe enable always trigger a_guard_actor_columns;

do $$
declare
  me uuid := test.make_user('Probe Me F77a');
  other uuid := test.make_user('Probe Other F77a');
  m text;
begin
  -- own, insert
  m := test.m77a_as_uid(me, format('insert into test.m77a_probe(author) values (%L)', me));
  perform test.m77a_check('own insert, own id', m, null);
  m := test.m77a_as_uid(me, format('insert into test.m77a_probe(author) values (%L)', other));
  perform test.m77a_check('own insert, forged id', m, 'm77a_probe.author must be the signed-in member');
  m := test.m77a_as_uid(me, 'insert into test.m77a_probe(plain) values (gen_random_uuid())');
  perform test.m77a_check('own insert, omitted', m, null);
  assert (select count(*) from test.m77a_probe where author = me) = 2, 'an omitted author is filled with the signed-in member';
  m := test.m77a_as_uid(me, 'insert into test.m77a_probe(author) values (null)');
  perform test.m77a_check('own insert, explicit null', m, null);
  assert (select count(*) from test.m77a_probe where author = me) = 3, 'an explicit NULL author is filled too';
  -- own, update: never changes, not even to yourself, not even to null
  m := test.m77a_as_uid(other, format('update test.m77a_probe set author = %L where author = %L', other, me));
  perform test.m77a_check('own update to myself', m, 'm77a_probe.author cannot be changed');
  m := test.m77a_as_uid(me, format('update test.m77a_probe set author = %L where author = %L', other, me));
  perform test.m77a_check('own update to someone else', m, 'm77a_probe.author cannot be changed');
  m := test.m77a_as_uid(me, format('update test.m77a_probe set author = null where author = %L', me));
  perform test.m77a_check('own update to null', m, 'm77a_probe.author cannot be changed');
  m := test.m77a_as_uid(other, format('update test.m77a_probe set author = author, plain = gen_random_uuid() where author = %L', me));
  perform test.m77a_check('own update that leaves it as it is', m, null);
  m := test.m77a_as_uid(other, format('update test.m77a_probe set plain = null where author = %L', me));
  perform test.m77a_check('update of another column', m, null);
  -- stamp, insert
  m := test.m77a_as_uid(me, format('insert into test.m77a_probe(stamped) values (%L)', me));
  perform test.m77a_check('stamp insert, own id', m, null);
  m := test.m77a_as_uid(me, format('insert into test.m77a_probe(stamped) values (%L)', other));
  perform test.m77a_check('stamp insert, forged id', m, 'm77a_probe.stamped must be the signed-in member');
  m := test.m77a_as_uid(me, 'insert into test.m77a_probe(plain) values (null)');
  perform test.m77a_check('stamp insert, omitted', m, null);
  assert (select count(*) from test.m77a_probe where stamped is null and author = me) >= 1, 'an omitted stamp stays NULL (a row with no such event yet)';
  -- stamp, update: to me or to null; a value somebody else set is left alone unless I touch it
  m := test.m77a_as_uid(other, format('update test.m77a_probe set stamped = %L where stamped = %L', other, me));
  perform test.m77a_check('stamp update, take over for myself', m, null);
  m := test.m77a_as_uid(me, format('update test.m77a_probe set stamped = %L where stamped = %L', me, other));
  perform test.m77a_check('stamp update, back to me', m, null);
  m := test.m77a_as_uid(me, format('update test.m77a_probe set stamped = %L where stamped = %L', other, me));
  perform test.m77a_check('stamp update, to someone else', m, 'm77a_probe.stamped must be the signed-in member');
  m := test.m77a_as_uid(me, format('update test.m77a_probe set stamped = null where stamped = %L', me));
  perform test.m77a_check('stamp update, cleared', m, null);
  m := test.m77a_as_uid(other, format('update test.m77a_probe set stamped = %L where stamped is null and author = %L', other, me));
  perform test.m77a_check('stamp update, set from null to me', m, null);
  -- an update that does not name the column, on a row stamped by somebody else, is not refused
  m := test.m77a_as_uid(me, format('update test.m77a_probe set plain = gen_random_uuid() where stamped = %L', other));
  perform test.m77a_check('update of another column on a row stamped by someone else', m, null);
  -- the guard's own words do not leak the ids
  m := test.m77a_as_uid(me, format('insert into test.m77a_probe(author) values (%L)', other));
  assert position(other::text in m) = 0 and position(me::text in m) = 0, 'the message carries no member id';

  -- no signed-in person (migration role, service role, maintenance): not guarded
  m := test.m77a_as_uid(null, format('insert into test.m77a_probe(author, stamped) values (%L, %L)', other, other));
  perform test.m77a_check('no signed-in person, forged ids', m, null);
  m := test.m77a_as_uid(null, format('update test.m77a_probe set author = %L, stamped = %L where author = %L', me, me, other));
  perform test.m77a_check('no signed-in person, update', m, null);
end $$;

-- a write made by another trigger (and so a foreign-key action) is the database's own
create table test.m77a_driver (id int generated always as identity primary key, forged uuid);
create function test.m77a_driver_fn() returns trigger language plpgsql as $$
begin insert into test.m77a_probe(author, stamped) values (new.forged, new.forged); return new; end $$;
create trigger m77a_driver_t after insert on test.m77a_driver for each row execute function test.m77a_driver_fn();
do $$
declare
  me uuid := test.make_user('Driver Me F77a');
  other uuid := test.make_user('Driver Other F77a');
  m text;
begin
  m := test.m77a_as_uid(me, format('insert into test.m77a_driver(forged) values (%L)', other));
  perform test.m77a_check('written by another trigger', m, null);
  assert exists (select 1 from test.m77a_probe where author = other and stamped = other), 'the nested write kept its values';
  -- but the same statement written directly is refused
  m := test.m77a_as_uid(me, format('insert into test.m77a_probe(author) values (%L)', other));
  perform test.m77a_check('the same write directly', m, 'm77a_probe.author must be the signed-in member');
end $$;

-- ---------------------------------------------------------------------------------------------------------
-- C. Every guarded column, from the catalog: a forged insert is refused before any other check
-- ---------------------------------------------------------------------------------------------------------
do $$
declare
  me uuid := test.make_user('Catalog Me F77a');
  other uuid := test.make_user('Catalog Other F77a');
  g record;
  m text;
  n int := 0;
begin
  for g in
    select c.relname as tbl, mm[1] as kind, mm[2] as colname
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid and c.relnamespace = 'public'::regnamespace
    cross join lateral regexp_matches(pg_get_triggerdef(t.oid), '''(own|stamp):([a-z_]+)''', 'g') mm
    where t.tgname = 'a_guard_actor_columns' and not t.tgisinternal
    order by 1, 3
  loop
    -- a row of the table with only this column set to somebody else: the guard answers before NOT NULL, CHECK, RLS or any later trigger
    m := test.m77a_as_uid(me, format(
      'insert into public.%1$I overriding system value select (jsonb_populate_record(null::public.%1$I, jsonb_build_object(%2$L, %3$L))).*', g.tbl, g.colname, other));
    perform test.m77a_check(format('forged insert %s.%s (%s)', g.tbl, g.colname, g.kind), m, format('%s.%s must be the signed-in member', g.tbl, g.colname));
    n := n + 1;
  end loop;
  assert n = 39, format('the loop covered %s columns', n);
end $$;

-- ---------------------------------------------------------------------------------------------------------
-- D. The tables the client writes directly, as the roles that write them
-- ---------------------------------------------------------------------------------------------------------
do $$
declare
  v_exec uuid := test.make_user('Exec1 F77a', 'executive');
  v_exec2 uuid := test.make_user('Exec2 F77a', 'executive');
  v_mgr uuid := test.make_user('Manager F77a');
  v_mem uuid := test.make_user('Member F77a');
  v_out uuid := test.make_user('Outsider F77a');
  v_g bigint;
  v_rec bigint;
  v_id text;
  m text;
begin
  perform test.login(v_exec);
  select id into v_g from public.create_subgroup('F77a Ensemble', '', 'open');
  perform public.add_subgroup_member(v_g, v_mgr);
  perform public.set_subgroup_member_role(v_g, v_mgr, 'manager');
  perform public.add_subgroup_member(v_g, v_mem);
  perform test.logout();

  -- announcements (executives)
  m := test.m77a_msg(v_exec, format('insert into public.announcements(title, body, created_by) values (''F77a forged'', ''b'', %L)', v_mem));
  perform test.m77a_check('announcements forged insert', m, 'announcements.created_by must be the signed-in member');
  m := test.m77a_msg(v_exec, 'insert into public.announcements(title, body) values (''F77a omitted'', ''b'')');
  perform test.m77a_check('announcements omitted created_by', m, null);
  assert (select created_by from public.announcements where title = 'F77a omitted') = v_exec, 'announcements: the author is filled in';
  m := test.m77a_msg(v_exec, format('insert into public.announcements(title, body, created_by) values (''F77a own'', ''b'', %L)', v_exec));
  perform test.m77a_check('announcements own insert', m, null);
  m := test.m77a_msg(v_exec2, format('update public.announcements set created_by = %L where title = ''F77a own''', v_exec2));
  perform test.m77a_check('announcements take over the author', m, 'announcements.created_by cannot be changed');
  m := test.m77a_msg(v_exec2, format('update public.announcements set created_by = %L where title = ''F77a own''', v_mem));
  perform test.m77a_check('announcements hand the author to someone', m, 'announcements.created_by cannot be changed');
  m := test.m77a_msg(v_exec2, 'update public.announcements set title = ''F77a edited by another executive'', created_by = created_by where title = ''F77a own''');
  perform test.m77a_check('announcements an ordinary edit by another executive', m, null);
  assert (select created_by from public.announcements where title = 'F77a edited by another executive') = v_exec, 'announcements: the author stays';
  m := test.m77a_msg(v_mem, format('insert into public.announcements(title, body, created_by) values (''F77a member'', ''b'', %L)', v_mem));
  assert m is not null, 'a member still cannot post an announcement';

  -- events (executives): the insert policy had no author check
  m := test.m77a_msg(v_exec, format('insert into public.events(title, starts_at, created_by) values (''F77a forged'', now(), %L)', v_exec2));
  perform test.m77a_check('events forged insert', m, 'events.created_by must be the signed-in member');
  m := test.m77a_msg(v_exec, 'insert into public.events(title, starts_at) values (''F77a omitted'', now())');
  perform test.m77a_check('events omitted created_by', m, null);
  assert (select created_by from public.events where title = 'F77a omitted') = v_exec, 'events: the author is filled in';
  m := test.m77a_msg(v_exec2, format('update public.events set created_by = %L where title = ''F77a omitted''', v_exec2));
  perform test.m77a_check('events take over the author', m, 'events.created_by cannot be changed');
  m := test.m77a_msg(v_exec2, 'update public.events set title = ''F77a omitted, moved'' where title = ''F77a omitted''');
  perform test.m77a_check('events an ordinary edit', m, null);

  -- archive_items (executives): the insert policy had no author check
  m := test.m77a_msg(v_exec, format('insert into public.archive_items(title, type, storage_path, visibility, uploaded_by) values (''F77a forged'', ''recording'', ''f77a/forged.mp3'', ''members'', %L)', v_exec2));
  perform test.m77a_check('archive_items forged insert', m, 'archive_items.uploaded_by must be the signed-in member');
  m := test.m77a_msg(v_exec, 'insert into public.archive_items(title, type, storage_path, visibility) values (''F77a omitted'', ''recording'', ''f77a/omitted.mp3'', ''members'')');
  perform test.m77a_check('archive_items omitted uploaded_by', m, null);
  assert (select uploaded_by from public.archive_items where title = 'F77a omitted') = v_exec, 'archive_items: the uploader is filled in';
  m := test.m77a_msg(v_exec2, format('update public.archive_items set uploaded_by = %L where title = ''F77a omitted''', v_exec2));
  perform test.m77a_check('archive_items take over the uploader', m, 'archive_items.uploaded_by cannot be changed');
  m := test.m77a_msg(v_exec2, 'update public.archive_items set is_public = false, description = ''edited'' where title = ''F77a omitted''');
  perform test.m77a_check('archive_items an ordinary edit', m, null);

  -- resources (executives and group managers)
  m := test.m77a_msg(v_mgr, format('insert into public.resources(node_kind, title, subgroup_id, visibility, status, created_by) values (''folder'', ''F77a forged'', %s, ''members'', ''ready'', %L)', v_g, v_exec));
  perform test.m77a_check('resources forged insert by a group manager', m, 'resources.created_by must be the signed-in member');
  m := test.m77a_msg(v_mgr, format('insert into public.resources(node_kind, title, subgroup_id, visibility, status) values (''folder'', ''F77a omitted'', %s, ''members'', ''ready'')', v_g));
  perform test.m77a_check('resources omitted created_by', m, null);
  assert (select created_by from public.resources where title = 'F77a omitted') = v_mgr, 'resources: the creator is filled in';
  m := test.m77a_msg(v_exec, format('update public.resources set created_by = %L where title = ''F77a omitted''', v_exec));
  perform test.m77a_check('resources an executive takes over a folder', m, 'resources.created_by cannot be changed');
  m := test.m77a_msg(v_mgr, format('update public.resources set created_by = %L where title = ''F77a omitted''', v_mem));
  perform test.m77a_check('resources a manager hands a folder away', m, 'resources.created_by cannot be changed');
  m := test.m77a_msg(v_mem, format('insert into public.resources(node_kind, title, subgroup_id, visibility, status, created_by) values (''folder'', ''F77a by member'', %s, ''members'', ''ready'', %L)', v_g, v_mem));
  assert m is not null, 'a plain member still cannot create a resource';

  -- resource_imports (executives and group managers)
  m := test.m77a_msg(v_mgr, format('insert into public.resource_imports(name, subgroup_id, status, created_by) values (''F77a forged'', %s, ''uploading'', %L)', v_g, v_exec));
  perform test.m77a_check('resource_imports forged insert', m, 'resource_imports.created_by must be the signed-in member');
  m := test.m77a_msg(v_mgr, format('insert into public.resource_imports(name, subgroup_id, status) values (''F77a omitted'', %s, ''uploading'')', v_g));
  perform test.m77a_check('resource_imports omitted created_by', m, null);
  assert (select created_by from public.resource_imports where name = 'F77a omitted') = v_mgr, 'resource_imports: the creator is filled in';
  m := test.m77a_msg(v_exec, format('update public.resource_imports set created_by = %L where name = ''F77a omitted''', v_exec));
  perform test.m77a_check('resource_imports an executive takes over a batch', m, 'resource_imports.created_by cannot be changed');
  m := test.m77a_msg(v_mgr, 'update public.resource_imports set completed_files = 0, status = ''completed'' where name = ''F77a omitted''');
  perform test.m77a_check('resource_imports an ordinary progress update', m, null);

  -- recordings (a member of the group)
  m := test.m77a_msg(v_mem, format('insert into public.recordings(title, subgroup_id, uploaded_by, storage_path, status, audience) values (''F77a forged'', %s, %L, %L, ''draft'', ''subgroup'')', v_g, v_mgr, v_mgr || '/f77a/forged.webm'));
  perform test.m77a_check('recordings forged insert', m, 'recordings.uploaded_by must be the signed-in member');
  -- the omitted uploader is filled BEFORE the path binding looks at it: another member's folder is still refused
  m := test.m77a_msg(v_mem, format('insert into public.recordings(title, subgroup_id, storage_path, status, audience) values (''F77a omitted, foreign path'', %s, %L, ''draft'', ''subgroup'')', v_g, v_mgr || '/f77a/theirs.webm'));
  perform test.m77a_check('recordings omitted uploader, another member''s folder', m, 'A file can only be registered from your own folder');
  m := test.m77a_msg(v_mem, format('insert into public.recordings(title, subgroup_id, storage_path, status, audience) values (''F77a omitted'', %s, %L, ''draft'', ''subgroup'')', v_g, v_mem || '/f77a/mine.webm'));
  perform test.m77a_check('recordings omitted uploader', m, null);
  assert (select uploaded_by from public.recordings where title = 'F77a omitted') = v_mem, 'recordings: the uploader is filled in';
  select id into v_rec from public.recordings where title = 'F77a omitted';
  m := test.m77a_msg(v_mem, format('update public.recordings set uploaded_by = %L where id = %s', v_mgr, v_rec));
  perform test.m77a_check('recordings the uploader hands the take to someone', m, 'recordings.uploaded_by cannot be changed');
  m := test.m77a_msg(v_exec, format('update public.recordings set uploaded_by = %L where id = %s', v_exec, v_rec));
  perform test.m77a_check('recordings an executive takes over a take', m, 'recordings.uploaded_by cannot be changed');
  m := test.m77a_msg(v_mem, format('update public.recordings set title = ''F77a renamed'', status = ''published'' where id = %s', v_rec));
  perform test.m77a_check('recordings an ordinary edit by the uploader', m, null);
  m := test.m77a_msg(v_exec, format('update public.recordings set description = ''edited by an executive'' where id = %s', v_rec));
  perform test.m77a_check('recordings an ordinary edit by an executive', m, null);

  -- recording_notes
  m := test.m77a_msg(v_mgr, format('insert into public.recording_notes(recording_id, title, note_type, body, uploaded_by) values (%s, ''F77a forged'', ''text'', ''x'', %L)', v_rec, v_mem));
  perform test.m77a_check('recording_notes forged insert', m, 'recording_notes.uploaded_by must be the signed-in member');
  m := test.m77a_msg(v_mgr, format('insert into public.recording_notes(recording_id, title, note_type, body) values (%s, ''F77a omitted'', ''text'', ''x'')', v_rec));
  perform test.m77a_check('recording_notes omitted uploaded_by', m, null);
  assert (select uploaded_by from public.recording_notes where title = 'F77a omitted') = v_mgr, 'recording_notes: the uploader is filled in';
  m := test.m77a_msg(v_exec, format('update public.recording_notes set uploaded_by = %L where title = ''F77a omitted''', v_exec));
  perform test.m77a_check('recording_notes an executive takes over a note', m, 'recording_notes.uploaded_by cannot be changed');
  m := test.m77a_msg(v_mgr, 'update public.recording_notes set body = ''edited'' where title = ''F77a omitted''');
  perform test.m77a_check('recording_notes an ordinary edit', m, null);
  m := test.m77a_msg(v_out, format('insert into public.recording_notes(recording_id, title, note_type, body, uploaded_by) values (%s, ''F77a outsider'', ''text'', ''x'', %L)', v_rec, v_out));
  assert (select count(*) from public.recording_notes where title = 'F77a outsider') = 0 or m is null, 'unchanged policy outcome for an outsider (published recording: allowed)';

  -- finance_documents (any member registers their own; executives manage)
  m := test.m77a_msg(v_mem, format('insert into public.finance_documents(document_type, title, storage_path, mime_type, file_size_bytes, uploaded_by) values (''receipt'', ''F77a forged'', ''f77a/forged.pdf'', ''application/pdf'', 10, %L)', v_exec));
  perform test.m77a_check('finance_documents forged insert by a member', m, 'finance_documents.uploaded_by must be the signed-in member');
  m := test.m77a_msg(v_exec, format('insert into public.finance_documents(document_type, title, storage_path, mime_type, file_size_bytes, uploaded_by) values (''receipt'', ''F77a on behalf'', ''f77a/behalf.pdf'', ''application/pdf'', 10, %L)', v_mem));
  perform test.m77a_check('finance_documents an executive registers a file in a member''s name', m, 'finance_documents.uploaded_by must be the signed-in member');
  m := test.m77a_msg(v_mem, 'insert into public.finance_documents(document_type, title, storage_path, mime_type, file_size_bytes) values (''receipt'', ''F77a omitted'', ''f77a/omitted.pdf'', ''application/pdf'', 10)');
  perform test.m77a_check('finance_documents omitted uploaded_by', m, null);
  assert (select uploaded_by from public.finance_documents where title = 'F77a omitted') = v_mem, 'finance_documents: the uploader is filled in';
  -- (the client holds no UPDATE on finance_documents, so this one is a definer's write, made as postgres with the executive signed in)
  m := test.m77a_as_uid(v_exec, format('update public.finance_documents set uploaded_by = %L where title = ''F77a omitted''', v_exec));
  perform test.m77a_check('finance_documents a definer function takes over a file', m, 'finance_documents.uploaded_by cannot be changed');
  m := test.m77a_msg(v_exec, format('update public.finance_documents set uploaded_by = %L where title = ''F77a omitted''', v_exec));
  assert m like 'permission denied%', 'the client cannot update finance_documents at all: ' || coalesce(m, 'no error');

  -- an upsert cannot be used to rewrite the column either
  m := test.m77a_msg(v_exec2, format('insert into public.events(id, title, starts_at, created_by) select id, title, starts_at, %L from public.events where title = ''F77a omitted, moved'' on conflict (id) do update set created_by = excluded.created_by', v_exec2));
  assert m is not null, 'an upsert that rewrites the author is refused: ' || coalesce(m, 'no error');

  -- anonymous visitors write none of these tables
  perform test.login(null);
  m := test.error_of('insert into public.events(title, starts_at, created_by) values (''F77a anon'', now(), null)');
  perform test.logout();
  assert m like '%permission denied%', 'anon: ' || coalesce(m, 'no error');
end $$;

-- ---------------------------------------------------------------------------------------------------------
-- E. Real rows made by the definer functions: the stamped column cannot be forged afterwards
-- ---------------------------------------------------------------------------------------------------------
do $$
declare
  v_exec uuid := test.make_user('ExecE F77a', 'executive');
  v_exec2 uuid := test.make_user('ExecE2 F77a', 'executive');
  v_mem uuid := test.make_user('MemberE F77a');
  v_g bigint; v_s bigint; v_exp bigint; v_reimb bigint; v_exp2 bigint;
  m text;
begin
  perform test.login(v_exec);
  select id into v_g from public.create_subgroup('F77a Ensemble E', '', 'open');
  perform public.add_subgroup_member(v_g, v_mem);
  select id into v_s from public.create_attendance_session('subgroup', v_g, 'F77a meeting', now() - interval '1 hour');
  perform public.open_attendance_session(v_s, 30);
  perform public.set_attendance_status(v_s, v_mem, 'absent', 'f77a', 0);
  v_exp := public.record_club_expense('F77a purchase', 'Shop', 25, date '2026-11-02', 'Supplies', 'Club bank account', '4242');
  perform test.logout();
  perform test.login(v_mem);
  select expense_id, reimbursement_id into v_exp2, v_reimb from public.submit_member_reimbursement('F77a request', 'Shop', 12, date '2026-11-03', 'Supplies', '1111');
  perform test.logout();
  perform test.login(v_exec2);
  perform public.review_personal_reimbursement(v_reimb, 'approved', null, 'ok');
  perform test.logout();

  assert (select created_by from public.attendance_sessions where id = v_s) = v_exec;
  assert (select marked_by from public.attendance_records where session_id = v_s and member_id = v_mem) = v_exec;
  assert (select added_by from public.subgroup_memberships where subgroup_id = v_g and member_id = v_mem) = v_exec;
  assert (select reviewed_by from public.personal_reimbursements where id = v_reimb) = v_exec2;
  assert (select approved_by from public.finance_expenses where id = v_exp2) = v_exec2;

  m := test.m77a_as_uid(v_exec2, format('update public.attendance_sessions set created_by = %L where id = %s', v_mem, v_s));
  perform test.m77a_check('attendance_sessions.created_by forged', m, 'attendance_sessions.created_by must be the signed-in member');
  m := test.m77a_as_uid(v_exec2, format('update public.attendance_records set marked_by = %L where session_id = %s', v_mem, v_s));
  perform test.m77a_check('attendance_records.marked_by forged', m, 'attendance_records.marked_by must be the signed-in member');
  m := test.m77a_as_uid(v_exec2, format('update public.subgroup_memberships set added_by = %L where subgroup_id = %s and member_id = %L', v_mem, v_g, v_mem));
  perform test.m77a_check('subgroup_memberships.added_by forged', m, 'subgroup_memberships.added_by must be the signed-in member');
  m := test.m77a_as_uid(v_exec2, format('update public.subgroup_memberships set reviewed_by = %L where subgroup_id = %s and member_id = %L', v_mem, v_g, v_mem));
  perform test.m77a_check('subgroup_memberships.reviewed_by forged', m, 'subgroup_memberships.reviewed_by must be the signed-in member');
  m := test.m77a_as_uid(v_exec, format('update public.subgroups set archived_by = %L where id = %s', v_exec2, v_g));
  perform test.m77a_check('subgroups.archived_by forged', m, 'subgroups.archived_by must be the signed-in member');
  m := test.m77a_as_uid(v_exec, format('update public.finance_expenses set created_by = %L where id = %s', v_exec2, v_exp));
  perform test.m77a_check('finance_expenses.created_by forged', m, 'finance_expenses.created_by must be the signed-in member');
  m := test.m77a_as_uid(v_exec, format('update public.finance_expenses set approved_by = %L where id = %s', v_mem, v_exp2));
  perform test.m77a_check('finance_expenses.approved_by forged', m, 'finance_expenses.approved_by must be the signed-in member');
  m := test.m77a_as_uid(v_exec, format('update public.personal_reimbursements set reviewed_by = %L where id = %s', v_mem, v_reimb));
  perform test.m77a_check('personal_reimbursements.reviewed_by forged', m, 'personal_reimbursements.reviewed_by must be the signed-in member');
  -- the audit tables: a log line written in someone else's name
  m := test.m77a_as_uid(v_exec, format('insert into public.admin_audit_log(action, actor_id, actor_email, target_id, target_email) values (''member_deleted'', %L, ''x@test.invalid'', %L, ''y@test.invalid'')', v_exec2, v_mem));
  perform test.m77a_check('admin_audit_log.actor_id forged', m, 'admin_audit_log.actor_id must be the signed-in member');
  m := test.m77a_as_uid(v_exec, format('update public.finance_audit_log set actor_id = %L', v_exec2));
  assert m is null or m like '%must be the signed-in member%' or m like '%append%' or m like '%cannot%', 'finance_audit_log update: ' || coalesce(m, '');
  -- and the real functions keep working with a person signed in (the definer functions write their own id)
  perform test.login(v_mem);
  select expense_id, reimbursement_id into v_exp2, v_reimb from public.submit_member_reimbursement('F77a request two', 'Shop', 14, date '2026-11-04', 'Supplies', '1111');
  perform test.logout();
  perform test.login(v_exec2);
  perform public.review_personal_reimbursement(v_reimb, 'rejected', null, 'No');
  perform test.logout();
  assert (select status from public.personal_reimbursements where id = v_reimb) = 'rejected', 'a review still goes through';
  assert (select reviewed_by from public.personal_reimbursements where id = v_reimb) = v_exec2;
end $$;

-- ---------------------------------------------------------------------------------------------------------
-- F. The system's own writes
-- ---------------------------------------------------------------------------------------------------------
do $$
declare
  v_admin uuid := test.make_user('Admin F77a', 'admin');
  v_former uuid := test.make_user('Former Exec F77a', 'executive');
  v_other uuid := test.make_user('Other F77a');
  v_ev bigint; v_g bigint; v_s bigint;
  m text;
begin
  -- the migration role (no signed-in person) may write any author: legacy copies and imports do
  insert into public.events(title, starts_at, created_by) values ('F77a legacy event', now(), v_other) returning id into v_ev;
  assert (select created_by from public.events where id = v_ev) = v_other, 'the migration role writes any author';
  update public.events set created_by = v_former where id = v_ev;
  assert (select created_by from public.events where id = v_ev) = v_former, 'and re-assigns one';

  -- a former executive's rows lose the author when the admin deletes the account (ON DELETE SET NULL)
  perform test.login(v_former);
  insert into public.announcements(title, body, created_by) values ('F77a by former', 'b', v_former);
  insert into public.archive_items(title, type, storage_path, visibility, uploaded_by) values ('F77a by former', 'recording', 'f77a/former.mp3', 'members', v_former);
  select id into v_g from public.create_subgroup('F77a Ensemble F', '', 'open');
  select id into v_s from public.create_attendance_session('subgroup', v_g, 'F77a meeting F', now());
  perform test.logout();
  assert (select count(*) from public.events where created_by = v_former) = 1;
  perform test.login(v_admin);
  perform public.admin_delete_member(v_former);
  perform test.logout();
  assert not exists (select 1 from auth.users where id = v_former), 'the account is gone';
  assert (select created_by from public.events where id = v_ev) is null, 'events.created_by is blanked by the foreign key (not refused by the guard)';
  assert (select created_by from public.announcements where title = 'F77a by former') is null, 'announcements.created_by blanked';
  assert (select uploaded_by from public.archive_items where title = 'F77a by former') is null, 'archive_items.uploaded_by blanked';
  assert (select created_by from public.subgroups where id = v_g) is null, 'subgroups.created_by blanked';
  assert (select created_by from public.attendance_sessions where id = v_s) is null, 'attendance_sessions.created_by blanked';
  assert (select actor_id from public.admin_audit_log where action = 'member_deleted' and target_id = v_former) = v_admin, 'the audit row names the admin who deleted';

  -- but a signed-in person cannot do the same blanking by hand
  insert into public.events(title, starts_at, created_by) values ('F77a authored', now(), v_other);
  m := test.m77a_as_uid(v_admin, 'update public.events set created_by = null where title = ''F77a authored''');
  perform test.m77a_check('a signed-in person erases an author by hand', m, 'events.created_by cannot be changed');
end $$;

-- ---------------------------------------------------------------------------------------------------------
-- G. It cannot be switched off from a session
-- ---------------------------------------------------------------------------------------------------------
do $$
declare
  me uuid := test.make_user('Replica Me F77a');
  other uuid := test.make_user('Replica Other F77a');
  m text;
begin
  set local session_replication_role = replica;
  m := test.m77a_as_uid(me, format('insert into public.events(title, starts_at, created_by) values (''F77a replica'', now(), %L)', other));
  perform test.m77a_check('forged insert with session_replication_role = replica', m, 'events.created_by must be the signed-in member');
  set local session_replication_role = origin;
  -- a signed-in role cannot change the setting at all
  perform test.login(me);
  m := test.error_of('set local session_replication_role = replica');
  perform test.logout();
  assert m like '%permission denied%', 'a member cannot set session_replication_role: ' || coalesce(m, 'no error');
  -- nor drop or disable the trigger
  perform test.login(me);
  m := test.error_of('alter table public.events disable trigger a_guard_actor_columns');
  perform test.logout();
  assert m like '%must be owner%', 'a member cannot disable the trigger: ' || coalesce(m, 'no error');
end $$;

rollback;
