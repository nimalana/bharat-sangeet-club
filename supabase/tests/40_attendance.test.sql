-- Attendance corrections.
begin;
do $$
declare
  v_exec uuid := test.make_user('Exec Four', 'executive');
  v_a uuid := test.make_user('Member Four A');
  v_b uuid := test.make_user('Member Four B');
  v_draft bigint;
  v_session bigint;
  message text;
  v_status text;
  v_excuse bigint;
begin
  perform test.login(v_exec);
  select id into v_draft from public.create_attendance_session('club', null, 'Draft meeting', now() + interval '1 day');
  perform test.logout();

  -- Edit and delete are for executives and drafts only.
  message := test.error_as(v_a, format('select public.update_attendance_session(%s, ''Hacked'', now())', v_draft));
  assert message like 'executive permission required%';
  message := test.error_as(v_exec, format('select public.update_attendance_session(%s, ''General body meeting'', ''2026-12-02 19:30-05'')', v_draft));
  assert message is null, coalesce(message, '');
  assert (select title = 'General body meeting' and session_date = date '2026-12-02' from public.attendance_sessions where id = v_draft), 'draft is edited and its date follows club time';
  message := test.error_as(v_exec, format('select public.delete_attendance_session(%s)', v_draft));
  assert message is null and not exists (select 1 from public.attendance_sessions where id = v_draft), 'draft is deleted';

  -- A real meeting: open, mark, close.
  perform test.login(v_exec);
  select id into v_session from public.create_attendance_session('club', null, 'Wrong meeting', now() - interval '5 minutes');
  perform public.open_attendance_session(v_session, 30);
  perform public.set_attendance_status(v_session, v_a, 'absent', 'No show', 0);
  perform test.logout();

  message := test.error_as(v_exec, format('select public.update_attendance_session(%s, ''Too late'', now())', v_session));
  assert message like 'Only meetings that have not opened%';
  message := test.error_as(v_exec, format('select public.delete_attendance_session(%s)', v_session));
  assert message like 'Only meetings that have not opened%';

  -- Undo a mistaken mark: record gone, remediation gone, audit kept.
  assert exists (select 1 from public.attendance_remediations where session_id = v_session and member_id = v_a), 'absence created a remediation';
  message := test.error_as(v_a, format('select public.clear_attendance_status(%s, %L)', v_session, v_a));
  assert message like 'executive permission required%', 'members cannot clear their own marks';
  message := test.error_as(v_exec, format('select public.clear_attendance_status(%s, %L)', v_session, v_a));
  assert message is null, coalesce(message, '');
  assert not exists (select 1 from public.attendance_records where session_id = v_session and member_id = v_a), 'mark is cleared';
  assert not exists (select 1 from public.attendance_remediations where session_id = v_session and member_id = v_a), 'its remediation is removed';
  assert exists (select 1 from public.attendance_record_audit where session_id = v_session and member_id = v_a and previous_status = 'absent' and new_status is null and changed_by = v_exec), 'the clear is audited';
  message := test.error_as(v_exec, format('select public.clear_attendance_status(%s, %L)', v_session, v_a));
  assert message like 'There is no mark to clear%';

  -- Close (everyone unmarked becomes absent), then members file forms.
  perform test.login(v_exec);
  perform public.close_attendance_session(v_session);
  perform test.logout();
  perform test.login(v_a);
  select id into v_excuse from public.submit_attendance_excuse(v_session, 'I had a midterm that evening.', null, 'class_exam', null);
  perform test.logout();
  perform test.login(v_b);
  perform public.submit_attendance_excuse(v_session, 'I was sick and stayed home.', null, 'illness', null);
  perform test.logout();

  -- Withdraw: own pending form only; it can be filed again.
  message := test.error_as(v_b, format('select public.withdraw_attendance_excuse(%s)', v_excuse));
  assert message like 'Only your own forms%', 'cannot withdraw someone else''s form';
  message := test.error_as(v_a, format('select public.withdraw_attendance_excuse(%s)', v_excuse));
  assert message is null, coalesce(message, '');
  select status::text into v_status from public.attendance_excuses where id = v_excuse;
  assert v_status = 'withdrawn';
  message := test.error_as(v_exec, format('select public.review_attendance_excuse(%s, ''approved'', '''')', v_excuse));
  assert message like 'excuse not found or already reviewed%', 'a withdrawn form cannot be reviewed';
  perform test.login(v_a);
  perform public.submit_attendance_excuse(v_session, 'Filing again with more detail.', null, 'class_exam', null);
  perform test.logout();
  assert (select status::text from public.attendance_excuses where id = v_excuse) = 'pending', 'a withdrawn form can be filed again';

  -- Void the closed meeting.
  message := test.error_as(v_a, format('select public.void_attendance_session(%s, ''Not real'')', v_session));
  assert message like 'executive permission required%';
  message := test.error_as(v_exec, format('select public.void_attendance_session(%s, '' '')', v_session));
  assert message like 'Say why%', 'a reason is required';
  message := test.error_as(v_exec, format('select public.void_attendance_session(%s, ''Created by mistake'')', v_session));
  assert message is null, coalesce(message, '');
  assert (select status = 'canceled' and not counts_toward_metrics and cancel_reason = 'Created by mistake' from public.attendance_sessions where id = v_session), 'meeting is voided with its reason';
  assert not exists (select 1 from public.attendance_remediations where session_id = v_session and status = 'pending'), 'open remediations are waived';
  assert not exists (select 1 from public.attendance_excuses where session_id = v_session and status = 'pending'), 'waiting forms are closed';
  assert exists (select 1 from public.attendance_records where session_id = v_session), 'the marks themselves are kept for the record';
  message := test.error_as(v_exec, format('select public.void_attendance_session(%s, ''Again'')', v_session));
  assert message like 'Only closed meetings can be voided%';
  message := test.error_as(v_exec, format('select public.clear_attendance_status(%s, %L)', v_session, v_b));
  assert message like 'This meeting was canceled%';

  -- Thresholds.
  message := test.error_as(v_a, 'select public.set_attendance_thresholds(3, 5)');
  assert message like 'executive permission required%';
  message := test.error_as(v_exec, 'select public.set_attendance_thresholds(4, 4)');
  assert message like 'The warning level%';
  message := test.error_as(v_exec, 'select public.set_attendance_thresholds(3, 5)');
  assert message is null, coalesce(message, '');
  assert (select warning_absences = 3 and critical_absences = 5 and updated_by = v_exec from public.attendance_settings where id), 'thresholds saved';
end $$;
rollback;
