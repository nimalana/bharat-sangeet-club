-- Round 3, item 3 (20261127090100): a voided meeting's marks cannot be changed,
-- and a remediation inside it is never reopened.
--
-- The checker scenario: absent, then present (the remediation is waived by the
-- portal), then the meeting is voided, then an executive sets absent. Before the
-- fix the last step succeeded and the trigger put the remediation back to
-- pending inside the voided meeting.
begin;
do $$
declare
  v_exec uuid := test.make_user('Exec Seventyfive', 'executive');
  v_a uuid := test.make_user('Member A Seventyfive');
  v_b uuid := test.make_user('Member B Seventyfive');
  v_c uuid := test.make_user('Member C Seventyfive');
  v_s bigint;
  v_live bigint;
  v_status text;
  v_note text;
  message text;
  audits_before bigint;
begin
  perform test.login(v_exec);
  select id into v_s from public.create_attendance_session('club', null, 'Seventyfive voided', timestamptz '2026-09-01 19:00-04');
  perform public.open_attendance_session(v_s, 30);
  perform public.set_attendance_status(v_s, v_a, 'absent', '', 0);
  perform public.set_attendance_status(v_s, v_b, 'present', '', 0);
  perform public.set_attendance_status(v_s, v_c, 'absent', '', 0);
  perform test.logout();
  assert (select status from public.attendance_remediations where session_id = v_s and member_id = v_a) = 'pending', 'setup: absent has a pending remediation';

  -- Absent corrected to present: the portal waives the remediation by itself.
  perform test.login(v_exec);
  perform public.set_attendance_status(v_s, v_a, 'present', '', 0);
  perform public.close_attendance_session(v_s);
  perform test.logout();
  select status, note into v_status, v_note from public.attendance_remediations where session_id = v_s and member_id = v_a;
  assert v_status = 'waived' and v_note like '%Waived automatically%', 'setup: present waived it automatically: ' || coalesce(v_status, 'no row');

  -- The meeting is voided. The remediation of C (still absent) is waived by the void.
  perform test.login(v_exec);
  perform public.void_attendance_session(v_s, 'Held on the wrong night');
  perform test.logout();
  assert (select status from public.attendance_sessions where id = v_s) = 'canceled';
  assert (select status from public.attendance_remediations where session_id = v_s and member_id = v_c) = 'waived', 'setup: the void waived C''s remediation';
  select count(*) into audits_before from public.attendance_record_audit where session_id = v_s;

  -- 1. Step four of the scenario: set absent in the voided meeting. Refused, readably.
  message := test.error_as(v_exec, format('select public.set_attendance_status(%s, %L, ''absent'', '''', 0)', v_s, v_a));
  assert message = 'This meeting was canceled, so its marks cannot be changed', 'set absent in a voided meeting is refused: ' || coalesce(message, 'it worked');
  -- Same wording as clear_attendance_status.
  assert test.error_as(v_exec, format('select public.clear_attendance_status(%s, %L)', v_s, v_a)) = message, 'clear refuses with the same message';
  -- Every status and member is refused, including one with no mark and one who is not on the roster.
  assert test.error_as(v_exec, format('select public.set_attendance_status(%s, %L, ''tardy'', '''', 5)', v_s, v_a)) = message, 'tardy is refused too';
  assert test.error_as(v_exec, format('select public.set_attendance_status(%s, %L, ''excused'', '''', 0)', v_s, v_b)) = message, 'so is excused';
  -- Others still get the executive check first.
  assert test.error_as(v_a, format('select public.set_attendance_status(%s, %L, ''absent'', '''', 0)', v_s, v_a)) = 'executive permission required', 'a member is told they lack permission, not about the meeting';

  -- Nothing changed.
  assert (select status::text from public.attendance_records where session_id = v_s and member_id = v_a) = 'present', 'the mark is unchanged';
  select status, note into v_status, v_note from public.attendance_remediations where session_id = v_s and member_id = v_a;
  assert v_status = 'waived' and v_note like '%Waived automatically%', 'the remediation stays waived: ' || coalesce(v_status, 'no row');
  assert (select count(*) from public.attendance_remediations where session_id = v_s and status = 'pending') = 0, 'no pending remediation in the voided meeting';
  assert (select count(*) from public.attendance_record_audit where session_id = v_s) = audits_before, 'and no audit row was written';

  -- 2. The trigger on its own: a write that does not go through the function (here the table owner,
  --    as a future function or a repair script would) still cannot reopen a remediation in a voided meeting.
  update public.attendance_records set status = 'absent' where session_id = v_s and member_id = v_a;
  assert (select status::text from public.attendance_records where session_id = v_s and member_id = v_a) = 'absent', 'setup: the owner changed the mark';
  select status, note into v_status, v_note from public.attendance_remediations where session_id = v_s and member_id = v_a;
  assert v_status = 'waived' and v_note like '%Waived automatically%', 'the trigger leaves the voided meeting''s remediation alone: ' || coalesce(v_status, 'no row');

  -- 3. A meeting that is not canceled behaves as before: a correction can be made, and the
  --    automatic waiver is reopened when the record warrants a remediation again.
  perform test.login(v_exec);
  select id into v_live from public.create_attendance_session('club', null, 'Seventyfive live', timestamptz '2026-09-08 19:00-04');
  perform public.open_attendance_session(v_live, 30);
  perform public.set_attendance_status(v_live, v_a, 'absent', '', 0);
  perform public.close_attendance_session(v_live);
  perform public.set_attendance_status(v_live, v_a, 'present', '', 0);
  assert (select status from public.attendance_remediations where session_id = v_live and member_id = v_a) = 'waived', 'a closed meeting can still be corrected: present waives';
  perform public.set_attendance_status(v_live, v_a, 'absent', '', 0);
  perform test.logout();
  assert (select status from public.attendance_remediations where session_id = v_live and member_id = v_a) = 'pending', 'and absent reopens it in a meeting that was not voided';
end $$;
rollback;
