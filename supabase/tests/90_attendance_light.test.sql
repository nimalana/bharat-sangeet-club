-- finance-11: the attendance screen reads a bounded overview, a tiny poll and
-- one roster at a time instead of every mark. Members and executives see what
-- they saw before; nothing per member leaks to members.
begin;
do $$
declare
  v_exec uuid := test.make_user('Exec Ninety', 'executive');
  v_admin uuid := test.make_user('Admin Ninety', 'admin');
  v_a uuid := test.make_user('Member Ninety A');
  v_b uuid := test.make_user('Member Ninety B');
  v_c uuid := test.make_user('Member Ninety C');
  v_d uuid := test.make_user('Member Ninety D');
  v_group bigint;
  v_s1 bigint; v_s2 bigint; v_s3 bigint; v_s4 bigint; v_s5 bigint;
  v_code text;
  v_term1 text; v_term2 text;
  work jsonb; ov jsonb; pulse jsonb; roster jsonb; roster2 jsonb;
  message text;
  v_row jsonb;
  v_live jsonb;
  v_expected_flagged int;
begin
  -- Two terms (about 40 and 400 days ago), a group meeting, one meeting open now and a draft.
  perform test.login(v_exec);
  select id into v_group from public.create_subgroup('Light Ensemble', '', 'open');
  perform public.add_subgroup_member(v_group, v_a);
  perform public.add_subgroup_member(v_group, v_b);

  select id into v_s1 from public.create_attendance_session('club', null, 'Fall club meeting', now() - interval '40 days');
  perform public.open_attendance_session(v_s1, 30);
  perform public.set_attendance_status(v_s1, v_a, 'present', '', 0);
  perform public.set_attendance_status(v_s1, v_b, 'absent', '', 0);
  perform public.set_attendance_status(v_s1, v_c, 'tardy', '', 15);
  perform public.close_attendance_session(v_s1);

  select id into v_s2 from public.create_attendance_session('club', null, 'Old club meeting', now() - interval '400 days');
  perform public.open_attendance_session(v_s2, 30);
  perform public.set_attendance_status(v_s2, v_a, 'absent', '', 0);
  perform public.set_attendance_status(v_s2, v_b, 'absent', '', 0);
  perform public.set_attendance_status(v_s2, v_c, 'present', '', 0);
  perform public.close_attendance_session(v_s2);

  select id into v_s3 from public.create_attendance_session('subgroup', v_group, 'Light Ensemble rehearsal', now() - interval '20 days');
  perform public.open_attendance_session(v_s3, 30);
  perform public.set_attendance_status(v_s3, v_a, 'absent', '', 0);
  perform public.set_attendance_status(v_s3, v_b, 'absent', '', 0);
  perform public.close_attendance_session(v_s3);

  select id into v_s5 from public.create_attendance_session('club', null, 'Draft meeting', now() + interval '30 days');
  perform test.logout();

  -- Absence forms: one waiting, one reviewed.
  perform test.login(v_a);
  perform public.submit_attendance_excuse(v_s2, 'I had a final exam that evening.', null, 'class_exam', null);
  perform test.logout();
  perform test.login(v_b);
  perform public.submit_attendance_excuse(v_s3, 'My bus broke down on the way.', null, 'other', null);
  perform test.logout();
  perform test.login(v_d);
  perform public.submit_attendance_excuse(v_s1, 'I was unwell and stayed home.', null, 'illness', null);
  perform test.logout();
  perform test.login(v_exec);
  perform public.review_attendance_excuse((select id from public.attendance_excuses where session_id = v_s1 and member_id = v_d), 'approved', 'Thanks');
  select id into v_s4 from public.create_attendance_session('club', null, 'Live meeting', now() + interval '1 minute');
  select check_in_code into v_code from public.open_attendance_session(v_s4, 30);
  perform test.logout();
  perform test.login(v_a);
  perform public.check_in_attendance(v_code);
  perform test.logout();
  -- B and C have marks in the open meeting too (D has none). A poll that leaked
  -- every mark's member, or counted wrongly, would now show it: the checks on
  -- the poll below look for these two ids.
  perform test.login(v_exec);
  perform public.set_attendance_status(v_s4, v_b, 'present', '', 0);
  perform public.set_attendance_status(v_s4, v_c, 'tardy', '', 15);
  perform test.logout();

  v_term1 := private.attendance_term_key(now() - interval '40 days');
  v_term2 := private.attendance_term_key(now() - interval '400 days');
  assert v_term1 <> v_term2, 'the test needs two terms';

  -- ---------------------------------------------------------------- executive
  perform test.login(v_exec);
  ov := public.get_attendance_overview('all');
  perform test.logout();
  assert (ov -> 'terms') @> to_jsonb(v_term1) and (ov -> 'terms') @> to_jsonb(v_term2), 'both terms are offered';
  assert jsonb_array_length(ov -> 'sessions') = 5, 'every meeting in the audience, drafts included';
  assert jsonb_array_length(ov -> 'records') = 0, 'an executive page works from totals, not from every mark';
  assert (select count(*) from jsonb_array_elements(ov -> 'sessions') s where s ->> 'id' = v_s5::text and s -> 'live' = 'null'::jsonb) = 1, 'only an open meeting carries live counts';
  select s -> 'live' into v_live from jsonb_array_elements(ov -> 'sessions') s where (s ->> 'id')::bigint = v_s4;
  assert (v_live ->> 'roster_count')::int = (select count(*) from public.attendance_session_participants where session_id = v_s4), 'live roster size';
  assert (v_live ->> 'checked_in_count')::int = 3, 'live check-in count: A checked in, B present, C tardy';
  assert (select s ->> 'subgroup_name' from jsonb_array_elements(ov -> 'sessions') s where (s ->> 'id')::bigint = v_s3) = 'Light Ensemble';
  assert (ov ->> 'excuses_pending')::int = 2 and (ov ->> 'excuses_total')::int = 3, 'form totals';
  assert (ov ->> 'remediations_pending')::int = (select count(*) from public.attendance_remediations where status = 'pending' and session_id in (v_s1, v_s2, v_s3, v_s4, v_s5)), 'open follow-up total';

  -- The totals equal the old rule worked out from the raw marks: a recorded
  -- unit count wins, a bare absence is one unit, only closed meetings that count.
  for v_row in select value from jsonb_array_elements(ov -> 'flagged') loop
    assert (v_row ->> 'club_units')::numeric = (
      select coalesce(sum(case when r.unexcused_units <> 0 then r.unexcused_units when r.status = 'absent' then 1 else 0 end), 0)
      from public.attendance_records r join public.attendance_sessions s on s.id = r.session_id
      where r.member_id = (v_row ->> 'member_id')::uuid and s.scope = 'club' and s.status = 'closed' and s.counts_toward_metrics), 'club units match the raw marks';
    assert (v_row ->> 'subgroup_units')::numeric = (
      select coalesce(sum(case when r.unexcused_units <> 0 then r.unexcused_units when r.status = 'absent' then 1 else 0 end), 0)
      from public.attendance_records r join public.attendance_sessions s on s.id = r.session_id
      where r.member_id = (v_row ->> 'member_id')::uuid and s.scope = 'subgroup' and s.status = 'closed' and s.counts_toward_metrics), 'group units match the raw marks';
  end loop;
  select count(*) into v_expected_flagged from (
    select r.member_id,
      sum(case when s.scope = 'club' then case when r.unexcused_units <> 0 then r.unexcused_units when r.status = 'absent' then 1 else 0 end else 0 end) as club_units,
      sum(case when s.scope = 'subgroup' then case when r.unexcused_units <> 0 then r.unexcused_units when r.status = 'absent' then 1 else 0 end else 0 end) as group_units
    from public.attendance_records r join public.attendance_sessions s on s.id = r.session_id
    where s.status = 'closed' and s.counts_toward_metrics group by r.member_id
  ) t where greatest(t.club_units, t.group_units) >= 2;
  assert jsonb_array_length(ov -> 'flagged') = v_expected_flagged and v_expected_flagged >= 1, 'the members at the warning level are exactly those the raw marks give';
  assert (select (f ->> 'club_units')::numeric from jsonb_array_elements(ov -> 'flagged') f where f ->> 'member_id' = v_b::text) = 2, 'B was absent from two club meetings';
  assert not exists (select 1 from jsonb_array_elements(ov -> 'flagged') f where f ->> 'member_id' = v_a::text), 'A (one club and one group absence) is under the warning level';
  assert (ov ->> 'attended_total')::int = (select count(*) from public.attendance_records r join public.attendance_sessions s on s.id = r.session_id
    where s.status = 'closed' and s.counts_toward_metrics and r.status in ('present', 'tardy')), 'attended total';
  assert (ov ->> 'absent_total')::int = (select count(*) from public.attendance_records r join public.attendance_sessions s on s.id = r.session_id
    where s.status = 'closed' and s.counts_toward_metrics and r.status = 'absent'), 'absent total';
  assert jsonb_array_length(ov -> 'profiles') >= 1 and exists (select 1 from jsonb_array_elements(ov -> 'profiles') p where p ->> 'id' = v_b::text), 'names for the members listed';
  assert not exists (
    select 1 from jsonb_array_elements(ov -> 'profiles') p
    where p ->> 'id' <> v_exec::text
      and not exists (select 1 from jsonb_array_elements((ov -> 'flagged') || (ov -> 'excuses') || (ov -> 'remediations')) m where m ->> 'member_id' = p ->> 'id')
  ), 'only people the page mentions get a name';

  -- Term filter: only that term's meetings, but the picker still offers every term.
  perform test.login(v_exec);
  work := public.get_attendance_overview('all', null, v_term2);
  perform test.logout();
  assert jsonb_array_length(work -> 'sessions') = 1 and (work -> 'sessions' -> 0 ->> 'id')::bigint = v_s2, 'term filter keeps that term only';
  assert jsonb_array_length(work -> 'terms') >= 2, 'the picker still lists every term';
  assert work ->> 'summary_term' = v_term2 and work ->> 'view_term' = v_term2, 'eligibility is read for the filtered term';
  assert (select count(*) from jsonb_array_elements(work -> 'excuses')) = 1, 'forms are limited to the term';
  perform test.login(v_exec);
  work := public.get_attendance_overview('club', null, null);
  perform test.logout();
  assert not exists (select 1 from jsonb_array_elements(work -> 'sessions') s where s ->> 'scope' <> 'club'), 'club audience';
  perform test.login(v_exec);
  work := public.get_attendance_overview('subgroup', v_group, null);
  perform test.logout();
  assert jsonb_array_length(work -> 'sessions') = 1 and (work -> 'sessions' -> 0 ->> 'id')::bigint = v_s3, 'group audience';

  -- Review queues are capped; the totals stay exact.
  perform test.login(v_exec);
  work := public.get_attendance_overview('all', null, null, now() - interval '18 months', 1);
  perform test.logout();
  assert jsonb_array_length(work -> 'excuses') = 2 and (work ->> 'excuses_total')::int = 3 and (work ->> 'excuses_pending')::int = 2, 'forms: capped list (one waiting, one reviewed), exact totals';
  assert jsonb_array_length(work -> 'remediations') = 1 and (work ->> 'remediations_pending')::int > 1, 'follow-up: capped list, exact total';

  -- An archived group keeps its name on its past meetings.
  perform test.login(v_exec);
  perform public.set_subgroup_archived(v_group, true);
  work := public.get_attendance_overview('all');
  perform test.logout();
  assert (select s ->> 'subgroup_name' from jsonb_array_elements(work -> 'sessions') s where (s ->> 'id')::bigint = v_s3) = 'Light Ensemble', 'archived group name still shown';
  perform test.login(v_exec);
  perform public.set_subgroup_archived(v_group, false);
  perform test.logout();

  -- ------------------------------------------------------------------- member
  perform test.login(v_a);
  ov := public.get_attendance_overview('all');
  perform test.logout();
  assert jsonb_array_length(ov -> 'flagged') = 0 and (ov ->> 'attended_total')::int = 0, 'members get no totals about others';
  assert jsonb_array_length(ov -> 'profiles') = 1, 'a member gets only their own name';
  assert (select count(*) from jsonb_array_elements(ov -> 'records') r where r ->> 'member_id' <> v_a::text) = 0 and jsonb_array_length(ov -> 'records') >= 3, 'a member gets their own marks';
  assert (select count(*) from jsonb_array_elements(ov -> 'excuses')) = 1, 'a member gets their own forms';
  assert not exists (select 1 from jsonb_array_elements(ov -> 'sessions') s where s -> 'live' <> 'null'::jsonb), 'no live roster counts for members';
  assert position(v_b::text in ov::text) = 0 and position(v_c::text in ov::text) = 0, 'no other member appears anywhere in a member''s overview';
  assert not exists (select 1 from jsonb_array_elements(ov -> 'sessions') s where (s ->> 'id')::bigint = v_s5), 'a member does not see a draft';
  assert length(ov::text) < 20000, 'a member''s overview is small';

  -- ---------------------------------------------------------------- the pulse
  perform test.login(v_exec);
  pulse := public.get_attendance_pulse('all');
  perform test.logout();
  assert jsonb_array_length(pulse -> 'sessions') = 1 and (pulse -> 'sessions' -> 0 ->> 'id')::bigint = v_s4, 'only the open meeting is polled';
  assert (pulse -> 'sessions' -> 0 -> 'live' ->> 'checked_in_count')::int = 3 and (pulse -> 'sessions' -> 0 -> 'live' ->> 'roster_count')::int = (v_live ->> 'roster_count')::int, 'executive counts';
  assert (pulse -> 'sessions' -> 0 -> 'live' ->> 'version') = (v_live ->> 'version'), 'live version agrees with the overview';
  assert (pulse ->> 'pending_excuses')::int = 2, 'waiting forms';
  assert length(pulse::text) < 600, 'the poll is tiny: ' || length(pulse::text);
  assert position(v_a::text in pulse::text) = 0 and position(v_b::text in pulse::text) = 0 and position(v_c::text in pulse::text) = 0 and position(v_d::text in pulse::text) = 0,
    'no member id at all in the executive poll, although A, B and C have marks in the open meeting';

  perform test.login(v_a);
  pulse := public.get_attendance_pulse('all');
  perform test.logout();
  assert (pulse -> 'sessions' -> 0 -> 'my_record' ->> 'status') = 'present' and (pulse -> 'sessions' -> 0 -> 'my_record' ->> 'member_id') = v_a::text, 'a member gets their own mark';
  assert (pulse -> 'sessions' -> 0 -> 'live') = 'null'::jsonb and (pulse ->> 'pending_excuses') is null, 'no counts for a member';
  assert length(pulse::text) < 700, 'the member poll is tiny';
  assert position(v_b::text in pulse::text) = 0 and position(v_c::text in pulse::text) = 0 and position(v_d::text in pulse::text) = 0,
    'no other member in a member''s poll, although B and C have marks in the open meeting';

  perform test.login(v_c);
  pulse := public.get_attendance_pulse('club');
  perform test.logout();
  assert (pulse -> 'sessions' -> 0 -> 'my_record' ->> 'status') = 'tardy' and (pulse -> 'sessions' -> 0 -> 'my_record' ->> 'member_id') = v_c::text, 'a member gets their own mark (tardy)';
  assert position(v_a::text in pulse::text) = 0 and position(v_b::text in pulse::text) = 0, 'and nobody else''s';
  perform test.login(v_d);
  pulse := public.get_attendance_pulse('club');
  perform test.logout();
  assert (pulse -> 'sessions' -> 0 -> 'my_record') = 'null'::jsonb, 'not checked in yet';
  perform test.login(v_c);
  pulse := public.get_attendance_pulse('subgroup', v_group);
  perform test.logout();
  assert jsonb_array_length(pulse -> 'sessions') = 0, 'the poll follows the audience';
  perform test.login(v_exec);
  pulse := public.get_attendance_pulse('all', null, v_term2);
  perform test.logout();
  assert jsonb_array_length(pulse -> 'sessions') = 0 and (pulse ->> 'pending_excuses')::int = 1, 'the poll follows the term';

  -- ---------------------------------------------------------------- the roster
  perform test.login(v_exec);
  roster := public.get_attendance_roster(v_s1);
  perform test.logout();
  assert jsonb_array_length(roster -> 'rows') = (select count(*) from public.attendance_session_participants where session_id = v_s1), 'every participant is on the roster';
  assert (select r ->> 'status' from jsonb_array_elements(roster -> 'rows') r where r ->> 'member_id' = v_b::text) = 'absent'
    and (select (r ->> 'minutes_late')::int from jsonb_array_elements(roster -> 'rows') r where r ->> 'member_id' = v_c::text) = 15
    and (select (r ->> 'unexcused_units')::numeric from jsonb_array_elements(roster -> 'rows') r where r ->> 'member_id' = v_c::text) = 0.5, 'marks, minutes late and units';
  assert (select r ->> 'full_name' from jsonb_array_elements(roster -> 'rows') r where r ->> 'member_id' = v_a::text) = 'Member Ninety A', 'names come with the roster';
  assert (select array_agg(lower(coalesce(nullif(r ->> 'full_name', ''), r ->> 'email')) order by ord) from jsonb_array_elements(roster -> 'rows') with ordinality t(r, ord))
       = (select array_agg(n order by n) from (select lower(coalesce(nullif(r ->> 'full_name', ''), r ->> 'email')) n from jsonb_array_elements(roster -> 'rows') r) q), 'the roster is in name order';

  -- The roster version moves when a mark changes, and matches the poll's.
  perform test.login(v_exec);
  roster := public.get_attendance_roster(v_s4);
  pulse := public.get_attendance_pulse('all');
  assert roster ->> 'version' = pulse -> 'sessions' -> 0 -> 'live' ->> 'version', 'roster and poll agree on the version';
  perform public.set_attendance_status(v_s4, v_d, 'present', '', 0);
  roster2 := public.get_attendance_roster(v_s4);
  pulse := public.get_attendance_pulse('all');
  assert roster2 ->> 'version' <> roster ->> 'version', 'a new mark changes the version';
  assert roster2 ->> 'version' = pulse -> 'sessions' -> 0 -> 'live' ->> 'version' and (pulse -> 'sessions' -> 0 -> 'live' ->> 'checked_in_count')::int = 4, 'poll counts follow';
  perform public.clear_attendance_status(v_s4, v_d);
  roster := public.get_attendance_roster(v_s4);
  assert roster ->> 'version' <> roster2 ->> 'version', 'clearing a mark changes the version too';
  perform test.logout();

  perform test.login(v_a);
  roster := public.get_attendance_roster(v_s1);
  perform test.logout();
  assert jsonb_array_length(roster -> 'rows') = 1 and (roster -> 'rows' -> 0 ->> 'member_id') = v_a::text, 'a member sees only their own row';
  assert position(v_b::text in roster::text) = 0, 'no other member in a member''s roster';

  -- Closing the meeting ends the poll.
  perform test.login(v_exec);
  perform public.close_attendance_session(v_s4);
  pulse := public.get_attendance_pulse('all');
  perform test.logout();
  assert jsonb_array_length(pulse -> 'sessions') = 0, 'a closed meeting leaves the poll';

  -- --------------------------------------------------------- who may call them
  assert test.error_as(null, 'select public.get_attendance_overview()') like '%permission denied%';
  assert test.error_as(null, 'select public.get_attendance_pulse()') like '%permission denied%';
  assert test.error_as(null, 'select public.get_attendance_roster(1)') like '%permission denied%';

  perform test.login(v_admin);
  perform public.admin_deactivate_member(v_c, 'Left');
  perform test.logout();
  perform test.login(v_c);
  ov := public.get_attendance_overview('all');
  pulse := public.get_attendance_pulse('all');
  roster := public.get_attendance_roster(v_s1);
  perform test.logout();
  assert jsonb_array_length(ov -> 'sessions') = 0 and jsonb_array_length(ov -> 'records') = 0 and jsonb_array_length(ov -> 'flagged') = 0, 'a deactivated member sees nothing';
  assert jsonb_array_length(pulse -> 'sessions') = 0 and jsonb_array_length(roster -> 'rows') = 0, 'nor in the poll or a roster';

  -- Six months and older meetings fall out of the window like before.
  perform test.login(v_exec);
  work := public.get_attendance_overview('all', null, null, now() - interval '100 days');
  perform test.logout();
  assert not exists (select 1 from jsonb_array_elements(work -> 'sessions') s where (s ->> 'id')::bigint = v_s2), 'the window still applies';
end $$;
rollback;
