-- core-7 (attendance side): an archived group gets no new attendance meetings.
begin;
do $$
declare
  v_exec uuid := test.make_user('Exec Ten', 'executive');
  v_member uuid := test.make_user('Member Ten');
  v_group bigint;
  v_draft bigint;
  v_open bigint;
  message text;
begin
  -- -------------------------------------------------------------------
  -- core-7: attendance in an archived group.
  -- -------------------------------------------------------------------
  perform test.login(v_exec);
  select id into v_group from public.create_subgroup('Ten Ensemble', '', 'open');
  perform public.add_subgroup_member(v_group, v_member);
  select id into v_draft from public.create_attendance_session('subgroup', v_group, 'Rehearsal before archive', now() + interval '1 day');
  select id into v_open from public.create_attendance_session('subgroup', v_group, 'Open when archived', now());
  perform public.open_attendance_session(v_open, 30);
  perform public.set_subgroup_archived(v_group, true);
  perform test.logout();

  message := test.error_as(v_exec, format('select public.create_attendance_session(''subgroup'', %s, ''New rehearsal'', now())', v_group));
  assert message like 'This group is archived%', 'no new meeting for an archived group: ' || coalesce(message, 'no error');
  message := test.error_as(v_exec, format('insert into public.attendance_sessions(scope, subgroup_id, title, session_date, starts_at, status, created_by) values (''subgroup'', %s, ''Direct'', current_date, now(), ''draft'', %L)', v_group, v_exec));
  assert message like 'This group is archived%', 'nor a direct insert: ' || coalesce(message, 'no error');
  -- A meeting that was already open can still be wound up.
  perform test.login(v_exec);
  perform public.close_attendance_session(v_open);
  perform test.logout();
  assert (select status from public.attendance_sessions where id = v_open) = 'closed', 'an open meeting can still be closed';
  message := test.error_as(v_exec, format('select public.open_attendance_session(%s, 30)', v_draft));
  assert message like 'This group is archived%', 'a draft cannot be opened for an archived group: ' || coalesce(message, 'no error');
  perform test.login(v_exec);
  perform public.delete_attendance_session(v_draft);
  perform test.logout();
  -- Club-wide meetings and restored groups are unaffected.
  perform test.login(v_exec);
  perform public.create_attendance_session('club', null, 'Club meeting', now() + interval '2 days');
  perform public.set_subgroup_archived(v_group, false);
  perform public.create_attendance_session('subgroup', v_group, 'After restore', now() + interval '3 days');
  perform test.logout();
end $$;
rollback;
