-- Round 2 of core-3: (1) a remediation the portal waived by itself is reopened
-- when the record warrants one again; (2) clearing a mark re-rates the member's
-- other normal tardies by meeting date, in both directions.
begin;
do $$
declare
  v_exec uuid := test.make_user('Exec Reopen', 'executive');
  v_member uuid := test.make_user('Member Reopen');
  v_other uuid := test.make_user('Other Reopen');
  v_third uuid := test.make_user('Third Reopen');
  v_s1 bigint; v_s2 bigint; v_s3 bigint; v_s4 bigint; v_s5 bigint; v_s6 bigint;
  v_open bigint;
  v_rem bigint;
  units numeric[];
  v_status text;
  v_note text;
begin
  -- -------------------------------------------------------------------
  -- 1. Reopen. Four normal tardies; the fourth is worth a unit and has a
  --    pending remediation.
  -- -------------------------------------------------------------------
  perform test.login(v_exec);
  select id into v_s1 from public.create_attendance_session('club', null, 'Reopen 1', timestamptz '2026-09-01 19:00-04');
  perform public.open_attendance_session(v_s1, 30); perform public.set_attendance_status(v_s1, v_member, 'tardy', '', 5); perform public.close_attendance_session(v_s1);
  select id into v_s2 from public.create_attendance_session('club', null, 'Reopen 2', timestamptz '2026-09-08 19:00-04');
  perform public.open_attendance_session(v_s2, 30); perform public.set_attendance_status(v_s2, v_member, 'tardy', '', 5); perform public.close_attendance_session(v_s2);
  select id into v_s3 from public.create_attendance_session('club', null, 'Reopen 3', timestamptz '2026-09-15 19:00-04');
  perform public.open_attendance_session(v_s3, 30); perform public.set_attendance_status(v_s3, v_member, 'tardy', '', 5); perform public.close_attendance_session(v_s3);
  select id into v_s4 from public.create_attendance_session('club', null, 'Reopen 4', timestamptz '2026-09-22 19:00-04');
  perform public.open_attendance_session(v_s4, 30); perform public.set_attendance_status(v_s4, v_member, 'tardy', '', 5); perform public.close_attendance_session(v_s4);
  perform test.logout();
  assert (select status from public.attendance_remediations where session_id = v_s4 and member_id = v_member) = 'pending', 'setup: the fourth tardy has a pending remediation';

  -- Mis-marked present: waived. Corrected to absent: pending again.
  perform test.login(v_exec);
  perform public.set_attendance_status(v_s4, v_member, 'present', '', 0);
  select status, note into v_status, v_note from public.attendance_remediations where session_id = v_s4 and member_id = v_member;
  assert v_status = 'waived' and v_note like '%no longer counts%', 'present waives it: ' || coalesce(v_status, 'none');
  perform public.set_attendance_status(v_s4, v_member, 'absent', '', 0);
  select status, note into v_status, v_note from public.attendance_remediations where session_id = v_s4 and member_id = v_member;
  assert v_status = 'pending', 'absent reopens it: ' || coalesce(v_status, 'no row');
  assert v_note is null, 'with the automatic wording removed: ' || coalesce(v_note, 'null');
  assert (select count(*) from public.attendance_remediations where session_id = v_s4 and member_id = v_member) = 1, 'still one row';
  -- absent -> present -> excused
  perform public.set_attendance_status(v_s4, v_member, 'present', '', 0);
  assert (select status from public.attendance_remediations where session_id = v_s4 and member_id = v_member) = 'waived';
  perform public.set_attendance_status(v_s4, v_member, 'excused', '', 0);
  assert (select status from public.attendance_remediations where session_id = v_s4 and member_id = v_member) = 'pending', 'excused reopens it too';
  -- present again, then a tardy that no longer counts: stays waived.
  perform public.set_attendance_status(v_s4, v_member, 'present', '', 0);
  perform public.set_attendance_status(v_s4, v_member, 'tardy', '', 5);
  perform test.logout();
  select array_agg(r.unexcused_units order by s.starts_at) into units
  from public.attendance_records r join public.attendance_sessions s on s.id = r.session_id
  where r.member_id = v_member and s.id in (v_s1, v_s2, v_s3, v_s4);
  assert units = array[0, 0, 0, 1]::numeric[], 'the tardy is the fourth again, worth a unit: ' || units::text;
  assert (select status from public.attendance_remediations where session_id = v_s4 and member_id = v_member) = 'pending', 'and the remediation is back';

  -- A note an executive wrote survives the round trip.
  select id into v_rem from public.attendance_remediations where session_id = v_s4 and member_id = v_member;
  perform test.login(v_exec);
  perform public.set_attendance_remediation(v_rem, 'pending', 'Write a reflection', null, 'Talk to the section leader');
  perform public.set_attendance_status(v_s4, v_member, 'present', '', 0);
  select note into v_note from public.attendance_remediations where id = v_rem;
  assert v_note = 'Talk to the section leader Waived automatically: the attendance record no longer counts.', 'the waiver is appended to the note: ' || v_note;
  perform public.set_attendance_status(v_s4, v_member, 'absent', '', 0);
  select status, note into v_status, v_note from public.attendance_remediations where id = v_rem;
  assert v_status = 'pending' and v_note = 'Talk to the section leader', 'and removed again, leaving theirs: ' || coalesce(v_note, 'null');
  perform test.logout();

  -- What an executive decided stays decided.
  perform test.login(v_exec);
  select id into v_open from public.create_attendance_session('club', null, 'Reopen decided', timestamptz '2026-10-05 19:00-04');
  perform public.open_attendance_session(v_open, 30);
  perform public.set_attendance_status(v_open, v_other, 'absent', '', 0);
  perform public.set_attendance_status(v_open, v_third, 'absent', '', 0);
  perform public.close_attendance_session(v_open);
  select id into v_rem from public.attendance_remediations where session_id = v_open and member_id = v_other;
  perform public.set_attendance_remediation(v_rem, 'waived', null, null, 'Excused by the chair');
  perform public.set_attendance_status(v_open, v_other, 'excused', '', 0);
  select status, note into v_status, v_note from public.attendance_remediations where id = v_rem;
  assert v_status = 'waived' and v_note = 'Excused by the chair', 'a remediation waived by hand is not reopened: ' || v_status;
  select id into v_rem from public.attendance_remediations where session_id = v_open and member_id = v_third;
  perform public.set_attendance_remediation(v_rem, 'complete', null, null, 'Done');
  perform public.set_attendance_status(v_open, v_third, 'present', '', 0);
  perform public.set_attendance_status(v_open, v_third, 'absent', '', 0);
  assert (select status from public.attendance_remediations where id = v_rem) = 'complete', 'a completed one stays completed';
  perform test.logout();

  -- -------------------------------------------------------------------
  -- 2. Re-rate after a clear, by meeting date, in both directions.
  --    Six normal tardies in one term, entered as meetings 5,4,3,2,1,6.
  -- -------------------------------------------------------------------
  perform test.login(v_exec);
  select id into v_s1 from public.create_attendance_session('club', null, 'Rate 1', timestamptz '2026-02-02 19:00-05');
  select id into v_s2 from public.create_attendance_session('club', null, 'Rate 2', timestamptz '2026-02-09 19:00-05');
  select id into v_s3 from public.create_attendance_session('club', null, 'Rate 3', timestamptz '2026-02-16 19:00-05');
  select id into v_s4 from public.create_attendance_session('club', null, 'Rate 4', timestamptz '2026-02-23 19:00-05');
  select id into v_s5 from public.create_attendance_session('club', null, 'Rate 5', timestamptz '2026-03-02 19:00-05');
  select id into v_s6 from public.create_attendance_session('club', null, 'Rate 6', timestamptz '2026-03-09 19:00-05');
  perform public.open_attendance_session(v_s5, 30); perform public.set_attendance_status(v_s5, v_other, 'tardy', '', 5); perform public.close_attendance_session(v_s5);
  perform public.open_attendance_session(v_s4, 30); perform public.set_attendance_status(v_s4, v_other, 'tardy', '', 5); perform public.close_attendance_session(v_s4);
  perform public.open_attendance_session(v_s3, 30); perform public.set_attendance_status(v_s3, v_other, 'tardy', '', 5); perform public.close_attendance_session(v_s3);
  perform public.open_attendance_session(v_s2, 30); perform public.set_attendance_status(v_s2, v_other, 'tardy', '', 5); perform public.close_attendance_session(v_s2);
  perform public.open_attendance_session(v_s1, 30); perform public.set_attendance_status(v_s1, v_other, 'tardy', '', 5); perform public.close_attendance_session(v_s1);
  perform public.open_attendance_session(v_s6, 30); perform public.set_attendance_status(v_s6, v_other, 'tardy', '', 5); perform public.close_attendance_session(v_s6);
  perform test.logout();
  select array_agg(r.unexcused_units order by s.starts_at) into units
  from public.attendance_records r join public.attendance_sessions s on s.id = r.session_id
  where r.member_id = v_other and s.id in (v_s1, v_s2, v_s3, v_s4, v_s5, v_s6);
  assert units = array[1, 1, 0, 0, 0, 1]::numeric[], 'setup: out-of-order entry carries units on meetings 1, 2 and 6: ' || units::text;
  assert (select count(*) from public.attendance_remediations where member_id = v_other and status = 'pending' and session_id in (v_s1, v_s2, v_s3, v_s4, v_s5, v_s6)) = 3, 'setup: three pending remediations';

  -- Clear the last meeting's mark: five tardies, two units, on meetings 4 and 5.
  perform test.login(v_exec);
  perform public.clear_attendance_status(v_s6, v_other);
  perform test.logout();
  select array_agg(r.unexcused_units order by s.starts_at) into units
  from public.attendance_records r join public.attendance_sessions s on s.id = r.session_id
  where r.member_id = v_other and s.id in (v_s1, v_s2, v_s3, v_s4, v_s5);
  assert units = array[0, 0, 0, 1, 1]::numeric[], 'five tardies total two units, on the fourth and fifth by date: ' || units::text;
  assert (select sum(unexcused_units) from public.attendance_records r join public.attendance_sessions s on s.id = r.session_id where r.member_id = v_other and s.id in (v_s1, v_s2, v_s3, v_s4, v_s5)) = 2, 'total 2';
  assert (select count(*) from public.attendance_remediations where member_id = v_other and status = 'pending' and session_id in (v_s1, v_s2, v_s3, v_s4, v_s5, v_s6)) = 2, 'two pending remediations';
  assert (select count(*) from public.attendance_remediations where member_id = v_other and status = 'pending' and session_id in (v_s4, v_s5)) = 2, 'on the two that carry units';
  assert (select count(*) from public.attendance_remediations where member_id = v_other and status = 'waived' and session_id in (v_s1, v_s2)) = 2, 'the earlier ones are waived';

  -- Clear a mark that carried no unit: still the right total.
  perform test.login(v_exec);
  perform public.clear_attendance_status(v_s3, v_other);
  perform test.logout();
  select array_agg(r.unexcused_units order by s.starts_at) into units
  from public.attendance_records r join public.attendance_sessions s on s.id = r.session_id
  where r.member_id = v_other and s.id in (v_s1, v_s2, v_s4, v_s5);
  assert units = array[0, 0, 0, 1]::numeric[], 'four tardies total one unit: ' || units::text;
  assert (select status from public.attendance_remediations where session_id = v_s5 and member_id = v_other) = 'pending', 'the fifth keeps its remediation';
  assert (select status from public.attendance_remediations where session_id = v_s4 and member_id = v_other) = 'waived', 'the fourth is waived';

  -- Down to three: no units at all.
  perform test.login(v_exec);
  perform public.clear_attendance_status(v_s1, v_other);
  perform test.logout();
  select array_agg(r.unexcused_units order by s.starts_at) into units
  from public.attendance_records r join public.attendance_sessions s on s.id = r.session_id
  where r.member_id = v_other and s.id in (v_s2, v_s4, v_s5);
  assert units = array[0, 0, 0]::numeric[], 'three tardies carry no unit: ' || units::text;
  assert (select count(*) from public.attendance_remediations where member_id = v_other and status = 'pending' and session_id in (v_s1, v_s2, v_s3, v_s4, v_s5, v_s6)) = 0, 'and no pending remediation';

  -- Marking one again brings the unit back (entry-order rule, unchanged).
  perform test.login(v_exec);
  perform public.set_attendance_status(v_s3, v_other, 'tardy', '', 5);
  perform test.logout();
  assert (select sum(unexcused_units) from public.attendance_records r join public.attendance_sessions s on s.id = r.session_id where r.member_id = v_other and s.id in (v_s2, v_s3, v_s4, v_s5)) = 1, 'four tardies again total one unit';
end $$;
rollback;
