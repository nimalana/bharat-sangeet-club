-- core-3: a remediation is waived when the record that caused it stops counting
-- (a meeting is voided, a mark is cleared or corrected).
begin;
do $$
declare
  v_exec uuid := test.make_user('Exec Eleven', 'executive');
  v_member uuid := test.make_user('Member Eleven');
  v_other uuid := test.make_user('Other Eleven');
  v_s1 bigint; v_s2 bigint; v_s3 bigint; v_s4 bigint; v_s5 bigint;
  v_open bigint;
  units numeric[];
begin
  -- -------------------------------------------------------------------
  -- core-3: voiding a meeting.
  -- Four normal tardies in one term. The fourth is worth one unit and has a
  -- pending remediation.
  -- -------------------------------------------------------------------
  perform test.login(v_exec);
  select id into v_s1 from public.create_attendance_session('club', null, 'Term meeting 1', timestamptz '2026-09-01 19:00-04');
  perform public.open_attendance_session(v_s1, 30); perform public.set_attendance_status(v_s1, v_member, 'tardy', '', 5); perform public.close_attendance_session(v_s1);
  select id into v_s2 from public.create_attendance_session('club', null, 'Term meeting 2', timestamptz '2026-09-08 19:00-04');
  perform public.open_attendance_session(v_s2, 30); perform public.set_attendance_status(v_s2, v_member, 'tardy', '', 5); perform public.close_attendance_session(v_s2);
  select id into v_s3 from public.create_attendance_session('club', null, 'Term meeting 3', timestamptz '2026-09-15 19:00-04');
  perform public.open_attendance_session(v_s3, 30); perform public.set_attendance_status(v_s3, v_member, 'tardy', '', 5); perform public.close_attendance_session(v_s3);
  select id into v_s4 from public.create_attendance_session('club', null, 'Term meeting 4', timestamptz '2026-09-22 19:00-04');
  perform public.open_attendance_session(v_s4, 30); perform public.set_attendance_status(v_s4, v_member, 'tardy', '', 5); perform public.close_attendance_session(v_s4);
  perform test.logout();

  select array_agg(r.unexcused_units order by s.starts_at) into units
  from public.attendance_records r join public.attendance_sessions s on s.id = r.session_id
  where r.member_id = v_member and s.id in (v_s1, v_s2, v_s3, v_s4);
  assert units = array[0, 0, 0, 1]::numeric[], 'setup: the fourth tardy is worth one unit: ' || units::text;
  assert (select status from public.attendance_remediations where session_id = v_s4 and member_id = v_member) = 'pending', 'setup: it has a pending remediation';

  perform test.login(v_exec);
  perform public.void_attendance_session(v_s1, 'Wrong date');
  perform test.logout();
  select array_agg(r.unexcused_units order by s.starts_at) into units
  from public.attendance_records r join public.attendance_sessions s on s.id = r.session_id
  where r.member_id = v_member and s.id in (v_s2, v_s3, v_s4);
  assert units = array[0, 0, 0]::numeric[], 'after the void no tardy is worth a unit: ' || units::text;
  assert (select status from public.attendance_remediations where session_id = v_s4 and member_id = v_member) = 'waived', 'the stale remediation is waived';
  assert (select note from public.attendance_remediations where session_id = v_s4 and member_id = v_member) like '%no longer counts%', 'with a note saying why';
  assert (select status from public.attendance_remediations where session_id = v_s1 and member_id = v_member) is null, 'the voided meeting never had one';

  -- -------------------------------------------------------------------
  -- core-3: clearing a mark. Five tardies in the spring term: 0, 0, 0, 1, 1.
  -- -------------------------------------------------------------------
  perform test.login(v_exec);
  select id into v_s1 from public.create_attendance_session('club', null, 'Spring 1', timestamptz '2026-02-02 19:00-05');
  perform public.open_attendance_session(v_s1, 30); perform public.set_attendance_status(v_s1, v_other, 'tardy', '', 5); perform public.close_attendance_session(v_s1);
  select id into v_s2 from public.create_attendance_session('club', null, 'Spring 2', timestamptz '2026-02-09 19:00-05');
  perform public.open_attendance_session(v_s2, 30); perform public.set_attendance_status(v_s2, v_other, 'tardy', '', 5); perform public.close_attendance_session(v_s2);
  select id into v_s3 from public.create_attendance_session('club', null, 'Spring 3', timestamptz '2026-02-16 19:00-05');
  perform public.open_attendance_session(v_s3, 30); perform public.set_attendance_status(v_s3, v_other, 'tardy', '', 5); perform public.close_attendance_session(v_s3);
  select id into v_s4 from public.create_attendance_session('club', null, 'Spring 4', timestamptz '2026-02-23 19:00-05');
  perform public.open_attendance_session(v_s4, 30); perform public.set_attendance_status(v_s4, v_other, 'tardy', '', 5); perform public.close_attendance_session(v_s4);
  select id into v_s5 from public.create_attendance_session('club', null, 'Spring 5', timestamptz '2026-03-02 19:00-05');
  perform public.open_attendance_session(v_s5, 30); perform public.set_attendance_status(v_s5, v_other, 'tardy', '', 5); perform public.close_attendance_session(v_s5);
  perform test.logout();
  select array_agg(r.unexcused_units order by s.starts_at) into units
  from public.attendance_records r join public.attendance_sessions s on s.id = r.session_id
  where r.member_id = v_other and s.id in (v_s1, v_s2, v_s3, v_s4, v_s5);
  assert units = array[0, 0, 0, 1, 1]::numeric[], 'setup: units are 0,0,0,1,1: ' || units::text;
  assert (select count(*) from public.attendance_remediations where member_id = v_other and status = 'pending' and session_id in (v_s4, v_s5)) = 2, 'setup: two pending remediations';

  perform test.login(v_exec);
  perform public.clear_attendance_status(v_s1, v_other);
  perform test.logout();
  select array_agg(r.unexcused_units order by s.starts_at) into units
  from public.attendance_records r join public.attendance_sessions s on s.id = r.session_id
  where r.member_id = v_other and s.id in (v_s2, v_s3, v_s4, v_s5);
  assert units = array[0, 0, 0, 1]::numeric[], 'after clearing the first mark the fourth remaining tardy is the only one worth a unit: ' || units::text;
  assert (select status from public.attendance_remediations where session_id = v_s4 and member_id = v_other) = 'waived', 'the remediation of the tardy that no longer counts is waived';
  assert (select status from public.attendance_remediations where session_id = v_s5 and member_id = v_other) = 'pending', 'the one that still counts stays pending';

  -- Clearing never raises anyone's units.
  perform test.login(v_exec);
  perform public.clear_attendance_status(v_s2, v_other);
  perform test.logout();
  select array_agg(r.unexcused_units order by s.starts_at) into units
  from public.attendance_records r join public.attendance_sessions s on s.id = r.session_id
  where r.member_id = v_other and s.id in (v_s3, v_s4, v_s5);
  assert units = array[0, 0, 0]::numeric[], 'three tardies left, none worth a unit: ' || units::text;
  assert (select status from public.attendance_remediations where session_id = v_s5 and member_id = v_other) = 'waived';

  -- -------------------------------------------------------------------
  -- core-3: correcting a mark. An absence has a remediation; changing it to
  -- excused still warrants one; changing it to present waives it.
  -- -------------------------------------------------------------------
  perform test.login(v_exec);
  select id into v_open from public.create_attendance_session('club', null, 'Correction meeting', timestamptz '2026-10-05 19:00-04');
  perform public.open_attendance_session(v_open, 30);
  perform public.set_attendance_status(v_open, v_member, 'absent', '', 0);
  perform public.set_attendance_status(v_open, v_other, 'present', '', 0);
  perform public.close_attendance_session(v_open);
  assert (select status from public.attendance_remediations where session_id = v_open and member_id = v_member) = 'pending', 'an absence has a pending remediation';
  perform public.set_attendance_status(v_open, v_member, 'excused', '', 0);
  assert (select status from public.attendance_remediations where session_id = v_open and member_id = v_member) = 'pending', 'absent to excused still warrants one';
  perform public.set_attendance_status(v_open, v_member, 'present', '', 0);
  assert (select status from public.attendance_remediations where session_id = v_open and member_id = v_member) = 'waived', 'present waives it';

  -- A remediation added by hand for a record that never warranted one (rows of
  -- this kind exist from before 20261127075000 took away direct inserts, and
  -- the service role can still add them) is not touched by later edits of that
  -- record. The row is inserted as the table owner.
  perform test.logout();
  insert into public.attendance_remediations (session_id, member_id, assignment, assigned_by)
  values (v_open, v_other, 'Write a short reflection', v_exec);
  perform test.login(v_exec);
  perform public.set_attendance_status(v_open, v_other, 'present', 'Arrived on time', 0);
  perform public.set_attendance_status(v_open, v_other, 'present', 'Edited note', 0);
  assert (select status from public.attendance_remediations where session_id = v_open and member_id = v_other) = 'pending', 'a hand-made remediation stays pending';
  perform test.logout();
end $$;
rollback;
