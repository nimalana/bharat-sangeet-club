-- One-call read functions return exactly what the caller may already see.
begin;
do $$
declare
  v_exec uuid := test.make_user('Exec Six', 'executive');
  v_admin uuid := test.make_user('Admin Six', 'admin');
  v_a uuid := test.make_user('Member Six A');
  v_b uuid := test.make_user('Member Six B');
  v_group bigint;
  v_session bigint;
  boot jsonb;
  work jsonb;
begin
  perform test.login(v_exec);
  select id into v_group from public.create_subgroup('Reads Ensemble', '', 'open');
  perform public.add_subgroup_member(v_group, v_a);
  insert into public.announcements (title, body, created_by) values ('Club news', 'For everyone', v_exec);
  insert into public.announcements (title, body, subgroup_id, created_by) values ('Group news', 'For the ensemble', v_group, v_exec);
  insert into public.events (title, description, starts_at, location, created_by) values
    ('Upcoming concert', '', now() + interval '10 days', 'Hall', v_exec),
    ('Ancient concert', '', now() - interval '3 years', 'Hall', v_exec);
  insert into public.archive_items (title, description, type, storage_path, visibility, uploaded_by)
    values ('Concert 2025', '', 'recording', 'x/concert.mp3', 'members', v_exec);
  select id into v_session from public.create_attendance_session('club', null, 'General meeting', now() - interval '1 hour');
  perform public.open_attendance_session(v_session, 30);
  perform public.set_attendance_status(v_session, v_a, 'present', '', 0);
  perform public.set_attendance_status(v_session, v_b, 'absent', '', 0);
  perform test.logout();

  -- Bootstrap as a group member.
  perform test.login(v_a);
  boot := public.get_portal_bootstrap();
  work := public.get_attendance_workspace();
  perform test.logout();
  assert boot -> 'profile' ->> 'role' = 'member' and boot -> 'profile' ->> 'status' = 'active';
  assert jsonb_array_length(boot -> 'memberships') = 1, 'own membership only';
  assert jsonb_array_length(boot -> 'announcements') = 2, 'club and own group announcements';
  assert jsonb_array_length(boot -> 'events') = 1, 'events older than a year are left out';
  assert jsonb_array_length(boot -> 'archive') = 0, 'the archive list is for executives';
  assert (select count(*) from jsonb_array_elements(boot -> 'groups') g where (g ->> 'id')::bigint = v_group) = 1;
  -- Attendance as that member: own record only, own profile only.
  assert jsonb_array_length(work -> 'sessions') >= 1;
  assert (select count(*) from jsonb_array_elements(work -> 'records') r where (r ->> 'session_id')::bigint = v_session) = 1, 'a member sees only their own mark';
  assert jsonb_array_length(work -> 'profiles') = 1, 'a member gets only their own profile';
  assert (work -> 'settings' ->> 'warning_absences')::int >= 1;

  -- A member outside the group does not get the group announcement.
  perform test.login(v_b);
  boot := public.get_portal_bootstrap();
  perform test.logout();
  assert jsonb_array_length(boot -> 'announcements') = 1, 'no announcements from groups you are not in';

  -- Executive: archive list, every mark, every profile; scope filter works.
  perform test.login(v_exec);
  boot := public.get_portal_bootstrap();
  work := public.get_attendance_workspace('club');
  perform test.logout();
  assert jsonb_array_length(boot -> 'archive') = 1;
  assert (select count(*) from jsonb_array_elements(work -> 'records') r where (r ->> 'session_id')::bigint = v_session) = 2;
  assert jsonb_array_length(work -> 'profiles') >= 4;
  perform test.login(v_exec);
  work := public.get_attendance_workspace('subgroup', v_group);
  perform test.logout();
  assert (select count(*) from jsonb_array_elements(work -> 'sessions') s where (s ->> 'id')::bigint = v_session) = 0, 'scope filter excludes club meetings';

  -- Deactivated: profile says so, everything else is empty.
  perform test.login(v_admin);
  perform public.admin_deactivate_member(v_a, 'Left');
  perform test.logout();
  perform test.login(v_a);
  boot := public.get_portal_bootstrap();
  work := public.get_attendance_workspace();
  perform test.logout();
  assert boot -> 'profile' ->> 'status' = 'deactivated';
  assert jsonb_array_length(boot -> 'announcements') = 0 and jsonb_array_length(boot -> 'groups') = 0 and jsonb_array_length(boot -> 'events') = 0;
  assert jsonb_array_length(work -> 'sessions') = 0 and jsonb_array_length(work -> 'records') = 0;

  -- Signed-out visitors cannot call either function.
  assert test.error_as(null, 'select public.get_portal_bootstrap()') like '%permission denied%';
end $$;
rollback;
