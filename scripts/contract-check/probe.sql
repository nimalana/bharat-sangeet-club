-- Behavioural probes of what the frontend does, run as the real roles on the
-- replayed database. Everything happens in one transaction that is rolled back.
--   psql -X -At -d postgres -f probe.sql        (PGHOST/PGPORT/PGUSER set; needs a replayed cluster)
-- Output lines: PROBE <area> | <what> => <result>
begin;
create function test.msg(p_user uuid, p_sql text) returns text language plpgsql as $$
declare m text;
begin
  perform test.login(p_user);
  begin execute p_sql; m := 'ok';
  exception when others then m := 'ERROR: ' || sqlerrm; end;
  perform test.logout();
  return m;
end $$;
create function test.val(p_user uuid, p_sql text) returns text language plpgsql as $$
declare v text;
begin
  perform test.login(p_user);
  begin execute p_sql into v;
  exception when others then v := 'ERROR: ' || sqlerrm; end;
  perform test.logout();
  return v;
end $$;
grant execute on function test.msg(uuid, text), test.val(uuid, text) to anon, authenticated;

do $$
declare
  a uuid := test.make_user('Admin P', 'admin');
  e uuid := test.make_user('Exec P', 'executive');
  gm uuid := test.make_user('Manager P');
  gl uuid := test.make_user('Leader P');
  m uuid := test.make_user('Member P');
  m2 uuid := test.make_user('Member Q');
  n uuid := test.make_user('Outsider P');
  d uuid := test.make_user('Deactivated P');
  g bigint; g2 bigint;
  folder bigint; child bigint; pend bigint; failed bigint; execonly bigint; ready_file bigint;
  rec bigint; arch bigint; note_other bigint; legacy bigint;
begin
  perform test.login(e);
  select id into g from public.create_subgroup('Probe Group', 'd', 'approval');
  select id into g2 from public.create_subgroup('Probe Group Two', 'd', 'open');
  perform public.add_subgroup_member(g, gm); perform public.add_subgroup_member(g, gl);
  perform public.add_subgroup_member(g, m); perform public.add_subgroup_member(g, m2); perform public.add_subgroup_member(g, d);
  perform public.set_subgroup_member_role(g, gm, 'manager'); perform public.set_subgroup_member_role(g, gl, 'leader');
  perform test.logout();

  -- ============================================================ deactivation
  perform test.login(a); perform public.admin_deactivate_member(d, ''); perform test.logout();
  raise notice 'PROBE deactivation | get_portal_bootstrap as deactivated member => %', test.val(d, 'select public.get_portal_bootstrap()::text');
  raise notice 'PROBE deactivation | get_portal_bootstrap as active member, keys => %', test.val(m, 'select string_agg(k, '','' order by k) from jsonb_object_keys(public.get_portal_bootstrap()) k');
  raise notice 'PROBE deactivation | deactivated: count profiles => %', test.val(d, 'select count(*)::text from public.profiles');
  raise notice 'PROBE deactivation | deactivated: count announcements => %', test.val(d, 'select count(*)::text from public.announcements');
  raise notice 'PROBE deactivation | deactivated: get_attendance_workspace => %', left(test.val(d, 'select public.get_attendance_workspace(''all'', null)::text'), 160);
  raise notice 'PROBE deactivation | deactivated: request_subgroup_enrollment => %', test.msg(d, format('select public.request_subgroup_enrollment(%s)', g2));
  raise notice 'PROBE deactivation | deactivated: update own profile => %', test.msg(d, format('update public.profiles set full_name = ''x'' where id = %L', d));

  -- ============================================================ resources: which role may use which control
  perform test.login(e);
  insert into public.resources (node_kind, title, subgroup_id, visibility, status, created_by) values ('folder', 'Group folder', g, 'members', 'ready', e) returning id into folder;
  insert into public.resources (node_kind, title, parent_id, subgroup_id, visibility, status, external_url, created_by) values ('link', 'Group link', folder, g, 'members', 'ready', 'https://example.org', e) returning id into child;
  insert into public.resources (node_kind, media_kind, title, subgroup_id, visibility, status, storage_bucket, storage_path, created_by) values ('file', 'document', 'Ready file', g, 'members', 'ready', 'club-resources', e || '/a/ready.pdf', e) returning id into ready_file;
  insert into public.resources (node_kind, title, subgroup_id, visibility, status, created_by) values ('folder', 'Exec only', g, 'executives', 'ready', e) returning id into execonly;
  perform test.logout();
  perform test.login(gl);
  insert into public.resources (node_kind, media_kind, title, subgroup_id, visibility, status, storage_bucket, storage_path, created_by) values ('file', 'document', 'Pending', g, 'members', 'pending_upload', 'club-resources', gl || '/a/pending.pdf', gl) returning id into pend;
  insert into public.resources (node_kind, media_kind, title, subgroup_id, visibility, status, storage_bucket, storage_path, created_by) values ('file', 'document', 'Failed', g, 'members', 'failed', 'club-resources', gl || '/a/failed.pdf', gl) returning id into failed;
  perform test.logout();
  raise notice 'PROBE resources | leader: rename (UI Edit) member-visible group item => %', test.msg(gl, format('with u as (update public.resources set title = ''r'' where id = %s returning id) select 1/(select count(*) from u)', ready_file));
  raise notice 'PROBE resources | leader: pin (UI Pin) => %', test.msg(gl, format('with u as (update public.resources set is_pinned = true where id = %s returning id) select 1/(select count(*) from u)', ready_file));
  raise notice 'PROBE resources | manager: set_resource_archived (UI Archive) on folder => %', test.msg(gm, format('select public.set_resource_archived(%s, true)', folder));
  raise notice 'PROBE resources | manager: set_resource_archived restore => %', test.msg(gm, format('select public.set_resource_archived(%s, false)', folder));
  raise notice 'PROBE resources | manager: set_resource_visibility (UI hides it) => %', test.msg(gm, format('select public.set_resource_visibility(%s, ''executives'')', folder));
  raise notice 'PROBE resources | leader: delete unfinished upload row (UI Discard upload) => %', test.msg(gl, format('with u as (delete from public.resources where id = %s returning id) select 1/(select count(*) from u)', pend));
  raise notice 'PROBE resources | manager: delete a ready file (UI hides Delete for non-exec) => %', test.msg(gm, format('with u as (delete from public.resources where id = %s returning id) select 1/(select count(*) from u)', ready_file));
  raise notice 'PROBE resources | manager: sees executives-only item in group => % rows', test.val(gm, format('select count(*)::text from public.resources where id = %s', execonly));
  raise notice 'PROBE resources | plain member: rename => %', test.msg(m, format('with u as (update public.resources set title = ''r'' where id = %s returning id) select 1/(select count(*) from u)', ready_file));
  raise notice 'PROBE resources | plain member sees pending/failed uploads of others => % rows', test.val(m, format('select count(*)::text from public.resources where id in (%s, %s)', pend, failed));

  -- ============================================================ announcements, events, groups
  raise notice 'PROBE announcements | executive insert (UI) => %', test.msg(e, format('with i as (insert into public.announcements (title, body, is_pinned, subgroup_id, created_by) values (''t'', ''b'', false, null, %L) returning id) select 1/(select count(*) from i)', e));
  raise notice 'PROBE announcements | group manager insert (UI hides button) => %', test.msg(gm, format('insert into public.announcements (title, body, subgroup_id, created_by) values (''t'', ''b'', %s, %L)', g, gm));
  raise notice 'PROBE announcements | executive update pin on existing row => %', test.msg(e, 'with u as (update public.announcements set is_pinned = true where true returning id) select 1/greatest((select count(*) from u),1)');
  raise notice 'PROBE events | executive insert/update/delete => %', test.msg(e, format('with i as (insert into public.events (title, description, starts_at, location, subgroup_id, created_by) values (''x'', '''', now(), '''', null, %L) returning id), u as (update public.events set title = ''y'' where id in (select id from i) returning id), d as (delete from public.events where id in (select id from i) returning id) select 1/(select count(*) from i)', e));
  raise notice 'PROBE events | plain member insert => %', test.msg(m, format('insert into public.events (title, starts_at, created_by) values (''x'', now(), %L)', m));
  raise notice 'PROBE groups | executive create_subgroup => %', test.msg(e, 'select public.create_subgroup(''Probe Three'', '''', ''open'')');
  raise notice 'PROBE groups | plain member create_subgroup => %', test.msg(m, 'select public.create_subgroup(''Probe Four'', '''', ''open'')');
  raise notice 'PROBE groups | plain member list_subgroup_roster (their group) rows => %', test.val(m, format('select count(*)::text from public.list_subgroup_roster(%s)', g));
  raise notice 'PROBE groups | outsider list_subgroup_roster rows => %', test.val(n, format('select count(*)::text from public.list_subgroup_roster(%s)', g));
  raise notice 'PROBE groups | manager: update_subgroup (UI Group settings) => %', test.msg(gm, format('select public.update_subgroup(%s, ''Probe Group'', ''new'')', g));
  raise notice 'PROBE groups | manager: set_subgroup_enrollment_mode (UI hides) => %', test.msg(gm, format('select public.set_subgroup_enrollment_mode(%s, ''open'')', g));
  raise notice 'PROBE groups | manager: set_subgroup_archived (UI hides) => %', test.msg(gm, format('select public.set_subgroup_archived(%s, true)', g));

  -- ============================================================ recordings
  perform test.login(m);
  insert into public.recordings (title, description, subgroup_id, uploaded_by, storage_path, mime_type, media_kind, status, audience, recording_kind) values ('Take', '', g, m, m || '/subgroups/' || g || '/take.webm', 'audio/webm', 'audio', 'published', 'subgroup', 'practice') returning id into rec;
  perform test.logout();
  raise notice 'PROBE recordings | uploader archives own recording (UI Archive) => %', test.msg(m, format('with u as (update public.recordings set status = ''archived'' where id = %s returning id) select 1/(select count(*) from u)', rec));
  raise notice 'PROBE recordings | uploader restores => %', test.msg(m, format('with u as (update public.recordings set status = ''published'' where id = %s returning id) select 1/(select count(*) from u)', rec));
  raise notice 'PROBE recordings | other member edits => %', test.msg(m2, format('with u as (update public.recordings set title = ''z'' where id = %s returning id) select 1/(select count(*) from u)', rec));
  -- another member attaches a notation file to the published recording
  perform test.login(m2);
  insert into public.recording_notes (recording_id, title, note_type, body, storage_path, mime_type, uploaded_by) values (rec, 'Their notation', 'file', '', m2 || '/their.pdf', 'application/pdf', m2) returning id into note_other;
  perform test.logout();
  insert into storage.objects (bucket_id, name, owner_id) values ('recording-notations', m2 || '/their.pdf', m2::text), ('recordings', m || '/subgroups/' || g || '/take.webm', m::text);
  raise notice 'PROBE recordings | member m2 may attach notation to someone else''s published recording => yes (note id %)', note_other;
  raise notice 'PROBE recordings | uploader (not exec) deletes the OTHER member''s notation file in storage (UI Delete recording does this first) => % rows deletable', test.val(m, format('with d as (delete from storage.objects where bucket_id = ''recording-notations'' and name = %L returning 1) select count(*)::text from d', m2 || '/their.pdf'));
  raise notice 'PROBE recordings | executive deletes that same file => % rows deletable', test.val(e, format('with d as (delete from storage.objects where bucket_id = ''recording-notations'' and name = %L returning 1) select count(*)::text from d', m2 || '/their.pdf'));

  -- ============================================================ legacy copy shares a club-archive file with a recording-room row
  perform test.login(e);
  insert into public.archive_items (title, description, type, storage_path, visibility, subgroup_id, uploaded_by, is_public) values ('Legacy take', '', 'recording', m || '/legacy.webm', 'members', g, m, false) returning id into legacy;
  perform test.logout();
  insert into storage.objects (bucket_id, name, owner_id) values ('club-archive', m || '/legacy.webm', m2::text);
  raise notice 'PROBE legacy | group member can sign (select) the club-archive file while archive_items.visibility = members => % rows', test.val(gl, format('select count(*)::text from storage.objects where bucket_id = ''club-archive'' and name = %L', m || '/legacy.webm'));
  perform test.login(e); update public.archive_items set visibility = 'executives' where id = legacy; perform test.logout();
  raise notice 'PROBE legacy | after executive sets access to "Executives only" (the UI advice for hiding a shared file), group member can sign it => % rows', test.val(gl, format('select count(*)::text from storage.objects where bucket_id = ''club-archive'' and name = %L', m || '/legacy.webm'));

  -- ============================================================ attendance
  raise notice 'PROBE attendance | member get_attendance_workspace profiles visible => %', test.val(m, 'select jsonb_array_length(public.get_attendance_workspace(''all'', null)->''profiles'')::text');
  raise notice 'PROBE attendance | executive set_attendance_thresholds(2,3) => %', test.msg(e, 'select public.set_attendance_thresholds(2, 3)');
  raise notice 'PROBE attendance | member set_attendance_thresholds => %', test.msg(m, 'select public.set_attendance_thresholds(2, 3)');
  raise notice 'PROBE attendance | executive get_attendance_workspace(''subgroup'', NULL) (scope picker never sends it) => %', left(test.val(e, 'select public.get_attendance_workspace(''subgroup'', null)::text'), 60);

  -- ============================================================ profiles
  raise notice 'PROBE profiles | member updates own full_name/phone/class_year/specialty (Members page) => %', test.msg(m, format('with u as (update public.profiles set full_name = ''Mm'', phone = ''1'', class_year = ''2028'', specialty = ''v'' where id = %L returning id) select 1/(select count(*) from u)', m));
  raise notice 'PROBE profiles | member updates own role => %', test.msg(m, format('update public.profiles set role = ''admin'' where id = %L', m));
  raise notice 'PROBE profiles | Members directory query (status = active) as plain member rows => %', test.val(m, 'select count(*)::text from public.profiles where status = ''active''');
end $$;
rollback;
