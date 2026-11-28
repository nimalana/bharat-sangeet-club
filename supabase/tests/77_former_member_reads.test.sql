-- Phase 4.3, P1-01 (migration 20261128030100): a former member of a group (removed by a manager, or left
-- on their own, which is status `inactive`) loses that group's attendance history and the group-scoped
-- reads from that moment, and keeps what is not group scoped.
--
-- Cast: stay (active in G the whole time), removed (removed from G by its manager), left (leaves G),
-- mover (member of G and H; removed from G only), other (H), exec, manager of G.
-- Meetings: G (closed), club-wide (closed), H (closed), G-open (open when the removals happen).
-- Each read path is probed as every member of the cast: the tables, the four read functions, the proof
-- image in storage, the group-scoped content (announcements, events, resources, recordings, archive,
-- roster) and the two write paths (check in, absence form).
begin;

create table test.m77_labels (session_id bigint primary key, label text not null, seq int not null);
grant select on test.m77_labels to public;

create function test.seen_as(p_user uuid, p_sql text) returns text language plpgsql as $$
declare result text;
begin
  perform test.login(p_user);
  begin
    execute p_sql into result;
  exception when insufficient_privilege then
    result := 'DENIED';
  end;
  perform test.logout();
  return coalesce(result, '');
end $$;

-- Labels of the meetings (in creation order) for which the caller can see a row in p_table.
create function test.meetings_seen(p_user uuid, p_table text) returns text language sql as $$
  select test.seen_as(p_user, format(
    'select coalesce(string_agg(l.label, '','' order by l.seq), '''') from test.m77_labels l where exists (select 1 from public.%I t where t.%I = l.session_id)',
    p_table, case when p_table = 'attendance_sessions' then 'id' else 'session_id' end));
$$;

create function test.expect(p_what text, p_who text, p_got text, p_expected text) returns void language plpgsql as $$
begin
  if p_got is distinct from p_expected then
    raise exception 'FORMER MEMBER % / %: expected [%] but saw [%]', p_what, p_who, p_expected, p_got;
  end if;
end $$;

do $$
declare
  v_exec uuid := test.make_user('Exec F77', 'executive');
  v_mgr uuid := test.make_user('Manager F77');
  v_stay uuid := test.make_user('Stay F77');
  v_removed uuid := test.make_user('Removed F77');
  v_left uuid := test.make_user('Left F77');
  v_mover uuid := test.make_user('Mover F77');
  v_other uuid := test.make_user('Other F77');
  v_g bigint; v_h bigint;
  s_g bigint; s_club bigint; s_h bigint; s_open bigint;
  v_code text;
  v_proof_removed text; v_proof_stay text; v_proof_club text;
  v_rec bigint;
  message text;
  who text;
  uid uuid;
  boot jsonb; work jsonb; ov jsonb; pulse jsonb; roster jsonb;
begin
  -- ---------------------------------------------------------------------------------------------------
  -- Fixtures
  -- ---------------------------------------------------------------------------------------------------
  perform test.login(v_exec);
  select id into v_g from public.create_subgroup('F77 Ensemble G', '', 'approval');
  select id into v_h from public.create_subgroup('F77 Ensemble H', '', 'open');
  perform public.add_subgroup_member(v_g, v_mgr);
  perform public.set_subgroup_member_role(v_g, v_mgr, 'manager');
  perform public.add_subgroup_member(v_g, v_stay);
  perform public.add_subgroup_member(v_g, v_removed);
  perform public.add_subgroup_member(v_g, v_left);
  perform public.add_subgroup_member(v_g, v_mover);
  perform public.add_subgroup_member(v_h, v_mover);
  perform public.add_subgroup_member(v_h, v_other);

  -- the G meeting, closed, with marks for everyone on the roster
  select id into s_g from public.create_attendance_session('subgroup', v_g, 'F77 G meeting', now() - interval '3 hours');
  perform public.open_attendance_session(s_g, 30);
  perform public.set_attendance_status(s_g, v_stay, 'absent', 'f77', 0);
  perform public.set_attendance_status(s_g, v_removed, 'absent', 'f77', 0);
  perform public.set_attendance_status(s_g, v_left, 'absent', 'f77', 0);
  perform public.set_attendance_status(s_g, v_mover, 'absent', 'f77', 0);
  perform public.close_attendance_session(s_g);
  -- the club meeting
  select id into s_club from public.create_attendance_session('club', null, 'F77 club meeting', now() - interval '2 hours');
  perform public.open_attendance_session(s_club, 30);
  perform public.set_attendance_status(s_club, v_stay, 'present', 'f77', 0);
  perform public.set_attendance_status(s_club, v_removed, 'absent', 'f77', 0);
  perform public.set_attendance_status(s_club, v_left, 'absent', 'f77', 0);
  perform public.set_attendance_status(s_club, v_mover, 'present', 'f77', 0);
  perform public.close_attendance_session(s_club);
  -- the H meeting
  select id into s_h from public.create_attendance_session('subgroup', v_h, 'F77 H meeting', now() - interval '1 hour');
  perform public.open_attendance_session(s_h, 30);
  perform public.set_attendance_status(s_h, v_mover, 'absent', 'f77', 0);
  perform public.close_attendance_session(s_h);
  -- a G meeting that is open while the removals happen
  select id into s_open from public.create_attendance_session('subgroup', v_g, 'F77 G open meeting', now());
  select check_in_code into v_code from public.open_attendance_session(s_open, 60);
  perform test.logout();

  insert into test.m77_labels values (s_g, 'G', 1), (s_club, 'club', 2), (s_h, 'H', 3), (s_open, 'G-open', 4);

  -- absence forms (and their proof images) of stay and removed for the G meeting, and of removed for the club meeting
  v_proof_removed := v_removed || '/' || s_g || '/proof.png';
  v_proof_stay := v_stay || '/' || s_g || '/proof.png';
  v_proof_club := v_removed || '/' || s_club || '/proof.png';
  insert into storage.objects (bucket_id, name) values
    ('attendance-excuses', v_proof_removed), ('attendance-excuses', v_proof_stay), ('attendance-excuses', v_proof_club),
    ('attendance-excuses', v_removed || '/loose-proof.png');
  perform test.login(v_removed);
  perform public.submit_attendance_excuse(s_g, 'I was at a family event that evening', v_proof_removed, 'family_emergency', null);
  perform public.submit_attendance_excuse(s_club, 'I was at a family event that evening too', v_proof_club, 'family_emergency', null);
  perform test.logout();
  perform test.login(v_stay);
  perform public.submit_attendance_excuse(s_g, 'I had an exam that evening for sure', v_proof_stay, 'class_exam', null);
  perform test.logout();

  -- group-scoped content of G, made by the executive
  insert into public.announcements (title, body, subgroup_id, created_by) values ('F77 G news', 'b', v_g, v_exec), ('F77 club news', 'b', null, v_exec);
  insert into public.events (title, subgroup_id, starts_at, created_by) values ('F77 G rehearsal', v_g, now() + interval '1 day', v_exec), ('F77 club concert', null, now() + interval '2 days', v_exec);
  insert into public.resources (node_kind, media_kind, title, subgroup_id, visibility, status, storage_bucket, storage_path, created_by) values
    ('file', 'document', 'F77 G score', v_g, 'members', 'ready', 'club-resources', 'f77/g-score.pdf', v_exec),
    ('file', 'document', 'F77 club score', null, 'members', 'ready', 'club-resources', 'f77/club-score.pdf', v_exec);
  insert into storage.objects (bucket_id, name) values ('club-resources', 'f77/g-score.pdf'), ('club-resources', 'f77/club-score.pdf');
  insert into public.recordings (title, subgroup_id, uploaded_by, storage_path, status, audience) values
    ('F77 G take', v_g, v_stay, v_stay || '/f77/g-take.webm', 'published', 'subgroup') returning id into v_rec;
  insert into public.archive_items (title, type, storage_path, visibility, uploaded_by, subgroup_id) values
    ('F77 G archive item', 'recording', 'f77/g-archive.mp3', 'members', v_exec, v_g);
  -- a pending join request in G (an approval group): only the group's managers and executives see it
  perform test.login(v_other);
  perform public.request_subgroup_enrollment(v_g);
  perform test.logout();

  -- ---------------------------------------------------------------------------------------------------
  -- Before: everyone on the rosters sees everything of their own
  -- ---------------------------------------------------------------------------------------------------
  perform test.expect('sessions before', 'removed', test.meetings_seen(v_removed, 'attendance_sessions'), 'G,club,G-open');
  perform test.expect('records before', 'removed', test.meetings_seen(v_removed, 'attendance_records'), 'G,club');
  perform test.expect('excuses before', 'removed', test.meetings_seen(v_removed, 'attendance_excuses'), 'G,club');
  perform test.expect('remediations before', 'left', test.meetings_seen(v_left, 'attendance_remediations'), 'G,club');
  perform test.expect('proof before', 'removed', test.seen_as(v_removed, format('select count(*) from storage.objects where bucket_id = ''attendance-excuses'' and name = %L', v_proof_removed)), '1');
  perform test.expect('group content before', 'removed', test.seen_as(v_removed, $q$select string_agg(title, ',' order by title) from public.announcements where title like 'F77 %'$q$), 'F77 G news,F77 club news');

  -- ---------------------------------------------------------------------------------------------------
  -- The removals: a manager removes `removed` and `mover` (from G), `left` leaves
  -- ---------------------------------------------------------------------------------------------------
  perform test.login(v_mgr);
  perform public.remove_subgroup_member(v_g, v_removed);
  perform public.remove_subgroup_member(v_g, v_mover);
  perform test.logout();
  perform test.login(v_left);
  perform public.leave_subgroup(v_g);
  perform test.logout();
  assert (select status from public.subgroup_memberships where subgroup_id = v_g and member_id = v_removed) = 'removed';
  assert (select status from public.subgroup_memberships where subgroup_id = v_g and member_id = v_left) = 'inactive';
  assert (select status from public.subgroup_memberships where subgroup_id = v_h and member_id = v_mover) = 'active', 'the mover is still in H';

  -- ---------------------------------------------------------------------------------------------------
  -- After: the tables
  -- ---------------------------------------------------------------------------------------------------
  --                                          stay                   removed / left        mover               exec
  perform test.expect('attendance_sessions', 'stay',    test.meetings_seen(v_stay,    'attendance_sessions'), 'G,club,G-open');
  perform test.expect('attendance_sessions', 'removed', test.meetings_seen(v_removed, 'attendance_sessions'), 'club');
  perform test.expect('attendance_sessions', 'left',    test.meetings_seen(v_left,    'attendance_sessions'), 'club');
  perform test.expect('attendance_sessions', 'mover',   test.meetings_seen(v_mover,   'attendance_sessions'), 'club,H');
  perform test.expect('attendance_sessions', 'exec',    test.meetings_seen(v_exec,    'attendance_sessions'), 'G,club,H,G-open');
  perform test.expect('attendance_session_participants', 'stay',    test.meetings_seen(v_stay,    'attendance_session_participants'), 'G,club,G-open');
  perform test.expect('attendance_session_participants', 'removed', test.meetings_seen(v_removed, 'attendance_session_participants'), 'club');
  perform test.expect('attendance_session_participants', 'left',    test.meetings_seen(v_left,    'attendance_session_participants'), 'club');
  perform test.expect('attendance_session_participants', 'mover',   test.meetings_seen(v_mover,   'attendance_session_participants'), 'club,H');
  perform test.expect('attendance_session_participants', 'exec',    test.meetings_seen(v_exec,    'attendance_session_participants'), 'G,club,H,G-open');
  perform test.expect('attendance_records', 'stay',    test.meetings_seen(v_stay,    'attendance_records'), 'G,club');
  perform test.expect('attendance_records', 'removed', test.meetings_seen(v_removed, 'attendance_records'), 'club');
  perform test.expect('attendance_records', 'left',    test.meetings_seen(v_left,    'attendance_records'), 'club');
  perform test.expect('attendance_records', 'mover',   test.meetings_seen(v_mover,   'attendance_records'), 'club,H');
  perform test.expect('attendance_records', 'exec',    test.meetings_seen(v_exec,    'attendance_records'), 'G,club,H');
  perform test.expect('attendance_excuses', 'stay',    test.meetings_seen(v_stay,    'attendance_excuses'), 'G');
  perform test.expect('attendance_excuses', 'removed', test.meetings_seen(v_removed, 'attendance_excuses'), 'club');
  perform test.expect('attendance_excuses', 'left',    test.meetings_seen(v_left,    'attendance_excuses'), '');
  perform test.expect('attendance_excuses', 'exec',    test.meetings_seen(v_exec,    'attendance_excuses'), 'G,club');
  perform test.expect('attendance_remediations', 'stay',    test.meetings_seen(v_stay,    'attendance_remediations'), 'G');
  perform test.expect('attendance_remediations', 'removed', test.meetings_seen(v_removed, 'attendance_remediations'), 'club');
  perform test.expect('attendance_remediations', 'left',    test.meetings_seen(v_left,    'attendance_remediations'), 'club');
  perform test.expect('attendance_remediations', 'mover',   test.meetings_seen(v_mover,   'attendance_remediations'), 'H');
  perform test.expect('attendance_remediations', 'exec',    test.meetings_seen(v_exec,    'attendance_remediations'), 'G,club,H');
  -- not group scoped: the eligibility row of a term stays (none exists yet; set one and read it back)
  perform test.login(v_exec);
  perform public.set_attendance_eligibility('2026-fall', v_removed, 'under_review', 'f77');
  perform test.logout();
  perform test.expect('attendance_eligibility', 'removed', test.seen_as(v_removed, $q$select count(*) from public.attendance_eligibility where term_key = '2026-fall'$q$), '1');
  perform test.expect('attendance_eligibility', 'stay', test.seen_as(v_stay, $q$select count(*) from public.attendance_eligibility where term_key = '2026-fall'$q$), '0');

  -- ---------------------------------------------------------------------------------------------------
  -- After: the read functions (SECURITY INVOKER: they inherit the policies)
  -- ---------------------------------------------------------------------------------------------------
  foreach who in array array['removed', 'left', 'mover'] loop
    uid := case who when 'removed' then v_removed when 'left' then v_left else v_mover end;
    perform test.login(uid);
    work := public.get_attendance_workspace('all');
    ov := public.get_attendance_overview('all');
    pulse := public.get_attendance_pulse('all');
    roster := public.get_attendance_roster(s_g);
    perform test.logout();
    assert not exists (select 1 from jsonb_array_elements(work -> 'sessions') e where (e ->> 'id')::bigint in (s_g, s_open)), 'get_attendance_workspace: no G meeting for ' || who;
    assert not exists (select 1 from jsonb_array_elements(work -> 'records') e where (e ->> 'session_id')::bigint = s_g), 'get_attendance_workspace: no G mark for ' || who;
    assert not exists (select 1 from jsonb_array_elements(work -> 'participants') e where (e ->> 'session_id')::bigint in (s_g, s_open)), 'get_attendance_workspace: no G roster row for ' || who;
    assert not exists (select 1 from jsonb_array_elements(work -> 'excuses') e where (e ->> 'session_id')::bigint = s_g), 'get_attendance_workspace: no G absence form for ' || who;
    assert not exists (select 1 from jsonb_array_elements(work -> 'remediations') e where (e ->> 'session_id')::bigint = s_g), 'get_attendance_workspace: no G follow-up for ' || who;
    assert exists (select 1 from jsonb_array_elements(work -> 'sessions') e where (e ->> 'id')::bigint = s_club), 'get_attendance_workspace: the club meeting is still there for ' || who;
    assert not exists (select 1 from jsonb_array_elements(ov -> 'sessions') e where (e ->> 'id')::bigint in (s_g, s_open)), 'get_attendance_overview: no G meeting for ' || who;
    assert not exists (select 1 from jsonb_array_elements(ov -> 'records') e where (e ->> 'session_id')::bigint = s_g), 'get_attendance_overview: no G mark for ' || who;
    assert not exists (select 1 from jsonb_array_elements(ov -> 'excuses') e where (e ->> 'session_id')::bigint = s_g), 'get_attendance_overview: no G absence form for ' || who;
    assert not exists (select 1 from jsonb_array_elements(ov -> 'remediations') e where (e ->> 'session_id')::bigint = s_g), 'get_attendance_overview: no G follow-up for ' || who;
    assert exists (select 1 from jsonb_array_elements(ov -> 'sessions') e where (e ->> 'id')::bigint = s_club), 'get_attendance_overview: the club meeting is still there for ' || who;
    assert not exists (select 1 from jsonb_array_elements(pulse -> 'sessions') e where (e ->> 'id')::bigint = s_open), 'get_attendance_pulse: the open G meeting is not offered to ' || who;
    assert jsonb_array_length(roster -> 'rows') = 0, 'get_attendance_roster: no row of the G meeting for ' || who;
  end loop;
  -- the same functions still give the active member everything
  perform test.login(v_stay);
  work := public.get_attendance_workspace('all');
  ov := public.get_attendance_overview('all');
  pulse := public.get_attendance_pulse('all');
  roster := public.get_attendance_roster(s_g);
  perform test.logout();
  assert (select count(*) from jsonb_array_elements(work -> 'sessions') e where (e ->> 'id')::bigint in (s_g, s_club, s_open)) = 3, 'workspace: stay sees the three meetings';
  assert (select count(*) from jsonb_array_elements(work -> 'records') e where (e ->> 'session_id')::bigint in (s_g, s_club)) = 2;
  assert (select count(*) from jsonb_array_elements(work -> 'excuses') e where (e ->> 'session_id')::bigint = s_g) = 1;
  assert (select count(*) from jsonb_array_elements(ov -> 'excuses') e where (e ->> 'session_id')::bigint = s_g) = 1, 'overview: stay still sees their absence form';
  assert exists (select 1 from jsonb_array_elements(pulse -> 'sessions') e where (e ->> 'id')::bigint = s_open), 'pulse: stay is offered the open G meeting';
  assert jsonb_array_length(roster -> 'rows') = 1, 'roster: stay sees their own row of the G meeting';
  -- a group scope asked for by id returns nothing to a former member
  perform test.login(v_removed);
  ov := public.get_attendance_overview('subgroup', v_g);
  work := public.get_attendance_workspace('subgroup', v_g);
  perform test.logout();
  assert jsonb_array_length(ov -> 'sessions') = 0 and jsonb_array_length(work -> 'sessions') = 0, 'asking for the group scope directly gives a former member no meetings';

  -- ---------------------------------------------------------------------------------------------------
  -- After: storage (the proof image of an absence form)
  -- ---------------------------------------------------------------------------------------------------
  perform test.expect('proof of the G meeting', 'removed', test.seen_as(v_removed, format('select count(*) from storage.objects where bucket_id = ''attendance-excuses'' and name = %L', v_proof_removed)), '0');
  perform test.expect('proof of the G meeting', 'stay', test.seen_as(v_stay, format('select count(*) from storage.objects where bucket_id = ''attendance-excuses'' and name = %L', v_proof_stay)), '1');
  perform test.expect('proof of the G meeting', 'exec', test.seen_as(v_exec, format('select count(*) from storage.objects where bucket_id = ''attendance-excuses'' and name = %L', v_proof_removed)), '1');
  perform test.expect('proof of the club meeting', 'removed', test.seen_as(v_removed, format('select count(*) from storage.objects where bucket_id = ''attendance-excuses'' and name = %L', v_proof_club)), '1');
  perform test.expect('proof at a hand-made path', 'removed', test.seen_as(v_removed, format('select count(*) from storage.objects where bucket_id = ''attendance-excuses'' and name = %L', v_removed || '/loose-proof.png')), '1');
  perform test.expect('proof of another member', 'stay', test.seen_as(v_stay, format('select count(*) from storage.objects where bucket_id = ''attendance-excuses'' and name = %L', v_proof_removed)), '0');

  -- ---------------------------------------------------------------------------------------------------
  -- After: the other group-scoped reads
  -- ---------------------------------------------------------------------------------------------------
  foreach who in array array['removed', 'left', 'mover'] loop
    uid := case who when 'removed' then v_removed when 'left' then v_left else v_mover end;
    perform test.expect('announcements', who, test.seen_as(uid, $q$select string_agg(title, ',' order by title) from public.announcements where title like 'F77 %'$q$), 'F77 club news');
    perform test.expect('events', who, test.seen_as(uid, $q$select string_agg(title, ',' order by title) from public.events where title like 'F77 %'$q$), 'F77 club concert');
    perform test.expect('resources', who, test.seen_as(uid, $q$select string_agg(title, ',' order by title) from public.resources where title like 'F77 %'$q$), 'F77 club score');
    perform test.expect('resource files', who, test.seen_as(uid, $q$select string_agg(name, ',' order by name) from storage.objects where bucket_id = 'club-resources' and name like 'f77/%'$q$), 'f77/club-score.pdf');
    perform test.expect('recordings', who, test.seen_as(uid, $q$select coalesce(string_agg(title, ',' order by title), '') from public.recordings where title like 'F77 %'$q$), '');
    perform test.expect('recording files', who, test.seen_as(uid, format('select count(*) from storage.objects where bucket_id = ''recordings'' and name = %L', v_stay || '/f77/g-take.webm')), '0');
    perform test.expect('archive_items', who, test.seen_as(uid, $q$select coalesce(string_agg(title, ',' order by title), '') from public.archive_items where title like 'F77 %'$q$), '');
    perform test.expect('bootstrap announcements', who, test.seen_as(uid, $q$select (select count(*) from jsonb_array_elements(public.get_portal_bootstrap() -> 'announcements') a where a ->> 'title' like 'F77 %')::text$q$), '1');
    perform test.expect('pending requests of the group', who, test.seen_as(uid, format('select count(*) from public.list_subgroup_roster(%s) r where r.status in (''pending'', ''waitlisted'')', v_g)), '0');
  end loop;
  perform test.expect('announcements', 'stay', test.seen_as(v_stay, $q$select string_agg(title, ',' order by title) from public.announcements where title like 'F77 %'$q$), 'F77 G news,F77 club news');
  perform test.expect('pending requests of the group', 'manager', test.seen_as(v_mgr, format('select count(*) from public.list_subgroup_roster(%s) r where r.status = ''pending''', v_g)), '1');
  perform test.expect('recordings', 'stay', test.seen_as(v_stay, $q$select string_agg(title, ',' order by title) from public.recordings where title like 'F77 %'$q$), 'F77 G take');
  -- what the mover still has in H is not touched
  perform test.expect('H announcements', 'mover', test.seen_as(v_mover, $q$select count(*) from public.subgroup_memberships where member_id = auth.uid() and status = 'active'$q$), '1');
  -- the member's own membership row stays visible to them (the screen says "removed"), and the active roster is the club-wide directory
  perform test.expect('own membership', 'removed', test.seen_as(v_removed, format('select status::text from public.subgroup_memberships where subgroup_id = %s and member_id = auth.uid()', v_g)), 'removed');
  perform test.expect('own membership', 'left', test.seen_as(v_left, format('select status::text from public.subgroup_memberships where subgroup_id = %s and member_id = auth.uid()', v_g)), 'inactive');
  perform test.expect('active roster (directory by design)', 'removed', test.seen_as(v_removed, format('select count(*) from public.list_subgroup_roster(%s) r where r.status = ''active''', v_g)),
    (select count(*)::text from public.subgroup_memberships where subgroup_id = v_g and status = 'active'));
  -- the removed member's own recordings stay readable to them (a decision), the group's other recordings do not
  insert into public.recordings (title, subgroup_id, uploaded_by, storage_path, status, audience) values ('F77 removed own take', v_g, v_removed, v_removed || '/f77/own.webm', 'draft', 'subgroup');
  perform test.expect('own upload', 'removed', test.seen_as(v_removed, $q$select string_agg(title, ',' order by title) from public.recordings where title like 'F77 %'$q$), 'F77 removed own take');

  -- ---------------------------------------------------------------------------------------------------
  -- After: the write side
  -- ---------------------------------------------------------------------------------------------------
  message := test.error_as(v_removed, format('select public.check_in_attendance(%L)', v_code));
  assert message like 'You are not eligible for this meeting%', 'a removed member cannot check in to the G meeting that was open when they were removed: ' || coalesce(message, 'no error');
  message := test.error_as(v_left, format('select public.check_in_attendance(%L)', v_code));
  assert message like 'You are not eligible for this meeting%', 'nor can one who left: ' || coalesce(message, 'no error');
  message := test.error_as(v_mover, format('select public.check_in_attendance(%L)', v_code));
  assert message like 'You are not eligible for this meeting%', 'nor the mover, for G: ' || coalesce(message, 'no error');
  message := test.error_as(v_stay, format('select public.check_in_attendance(%L)', v_code));
  assert message is null, 'an active member checks in: ' || coalesce(message, '');
  message := test.error_as(v_left, format('select public.submit_attendance_excuse(%s, ''I left the group but file a form anyway'', null, ''other'', null)', s_g));
  assert message like 'You were not on this meeting roster%', 'no absence form for a meeting of a group you left: ' || coalesce(message, 'no error');
  message := test.error_as(v_removed, format('select public.submit_attendance_excuse(%s, ''Changing my form after being removed'', null, ''other'', null)', s_g));
  assert message like 'You were not on this meeting roster%', 'nor an edit of the form you filed before being removed: ' || coalesce(message, 'no error');
  message := test.error_as(v_left, format('select public.submit_attendance_excuse(%s, ''The club meeting I missed, a real reason'', null, ''other'', null)', s_club));
  assert message is null, 'a club-wide meeting still takes the form: ' || coalesce(message, '');
  -- an executive can still file nothing for someone else: forms are the member''s own
  message := test.error_as(v_stay, format('select public.submit_attendance_excuse(%s, ''A form for the open meeting, honest'', null, ''other'', null)', s_open));
  assert message is null, 'an active member files a form for the open G meeting: ' || coalesce(message, '');

  -- ---------------------------------------------------------------------------------------------------
  -- Coming back restores the view (the rule is about the state now, not the removal)
  -- ---------------------------------------------------------------------------------------------------
  perform test.login(v_exec);
  perform public.add_subgroup_member(v_g, v_removed);
  perform test.logout();
  assert (select status from public.subgroup_memberships where subgroup_id = v_g and member_id = v_removed) = 'active', 'the member is back in G';
  perform test.expect('sessions after return', 'removed', test.meetings_seen(v_removed, 'attendance_sessions'), 'G,club,G-open');
  perform test.expect('records after return', 'removed', test.meetings_seen(v_removed, 'attendance_records'), 'G,club');
end $$;
rollback;
