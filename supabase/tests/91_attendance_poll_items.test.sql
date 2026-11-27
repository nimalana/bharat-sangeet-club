-- Round 2: what the poll and the overview say about a person's own absence
-- forms and follow-up items, and how far an executive's review queues reach.
--
-- Before: a member's poll carried nothing about forms or follow-up (the form
-- count is executives only), so a member with the page open during check-in saw
-- an executive's decision, or a new follow-up item, only after doing something
-- themselves. Now both the overview and the poll carry 'items_version', which
-- changes when the caller's own forms or items change.
begin;
do $$
declare
  v_exec uuid := test.make_user('Exec Ninety Two', 'executive');
  v_a uuid := test.make_user('Member Ninety Two A');
  v_b uuid := test.make_user('Member Ninety Two B');
  v_d uuid := test.make_user('Member Ninety Two D');
  v_group bigint;
  v_past bigint; v_past2 bigint; v_past3 bigint; v_live bigint; v_grp bigint;
  v_excuse bigint; v_remediation bigint;
  v_code text;
  ov jsonb; pulse jsonb;
  v_a0 text; v_a1 text; v_x0 text; v_x1 text;
  v_term text;
  v_expect text;
begin
  perform test.login(v_exec);
  select id into v_group from public.create_subgroup('Items Ensemble', '', 'open');
  perform public.add_subgroup_member(v_group, v_a);
  select id into v_past from public.create_attendance_session('club', null, 'Past meeting', now() - interval '10 days');
  perform public.open_attendance_session(v_past, 30);
  perform public.set_attendance_status(v_past, v_a, 'absent', '', 0);
  perform public.set_attendance_status(v_past, v_b, 'present', '', 0);
  perform public.close_attendance_session(v_past);
  select id into v_live from public.create_attendance_session('club', null, 'Live meeting', now() + interval '1 minute');
  select check_in_code into v_code from public.open_attendance_session(v_live, 30);
  select id into v_grp from public.create_attendance_session('subgroup', v_group, 'Items rehearsal', now() - interval '3 days');
  perform test.logout();

  -- A has one follow-up item (absent in the past meeting) and files a form.
  perform test.login(v_a);
  perform public.submit_attendance_excuse(v_past, 'I had a final exam that evening.', null, 'class_exam', null);
  ov := public.get_attendance_overview('all');
  pulse := public.get_attendance_pulse('all');
  perform test.logout();
  assert (ov ->> 'items_version') is not null and (ov ->> 'items_version') like 'm:%', 'a member gets an items version';
  assert pulse ->> 'items_version' = ov ->> 'items_version', 'the poll and the overview agree for the same person and audience';
  assert (pulse ->> 'pending_excuses') is null and (pulse -> 'sessions' -> 0 -> 'live') = 'null'::jsonb, 'a member still gets no counts';
  assert length(pulse ->> 'items_version') = 34, 'a short text, not the items: ' || length(pulse ->> 'items_version');
  v_a0 := pulse ->> 'items_version';

  -- The executive decides: the member's poll changes, and so does the overview they would read.
  perform test.login(v_exec);
  select id into v_excuse from public.attendance_excuses where member_id = v_a and session_id = v_past;
  v_x0 := public.get_attendance_pulse('all') ->> 'items_version';
  assert public.get_attendance_overview('all') ->> 'items_version' = v_x0, 'the executive''s poll and overview agree';
  assert v_x0 = 'x:' || (select count(*) from public.attendance_excuses where status = 'pending') || ':' || (select count(*) from public.attendance_remediations where status = 'pending'), 'an executive''s version is the number of waiting forms and open items';
  perform public.review_attendance_excuse(v_excuse, 'approved', 'Thanks');
  v_x1 := public.get_attendance_pulse('all') ->> 'items_version';
  perform test.logout();
  assert v_x1 <> v_x0, 'a decision changes the executive''s version (one fewer waiting form)';
  perform test.login(v_a);
  pulse := public.get_attendance_pulse('all');
  ov := public.get_attendance_overview('all');
  perform test.logout();
  assert pulse ->> 'items_version' <> v_a0, 'the decision on a member''s form changes the member''s poll';
  assert ov ->> 'items_version' = pulse ->> 'items_version', 'and the overview they then read matches it (no reload loop)';
  assert (select x ->> 'status' from jsonb_array_elements(ov -> 'excuses') x limit 1) = 'approved', 'the overview shows the decision';
  v_a1 := pulse ->> 'items_version';

  -- A new follow-up item for the member (marked absent in the live meeting).
  perform test.login(v_exec);
  perform public.set_attendance_status(v_live, v_a, 'absent', '', 0);
  v_x0 := v_x1;
  v_x1 := public.get_attendance_pulse('all') ->> 'items_version';
  assert v_x1 <> v_x0, 'a new follow-up item changes the executive''s version';
  perform test.logout();
  perform test.login(v_a);
  pulse := public.get_attendance_pulse('all');
  ov := public.get_attendance_overview('all');
  perform test.logout();
  assert pulse ->> 'items_version' <> v_a1, 'a new follow-up item changes the member''s poll';
  assert ov ->> 'items_version' = pulse ->> 'items_version', 'and the overview matches';
  assert (select count(*) from jsonb_array_elements(ov -> 'remediations') m where m ->> 'status' = 'pending') = 2, 'the member now sees two open items';
  v_a1 := pulse ->> 'items_version';

  -- Completing one changes it again.
  perform test.login(v_exec);
  select id into v_remediation from public.attendance_remediations where member_id = v_a and session_id = v_past;
  perform public.set_attendance_remediation(v_remediation, 'complete', 'Wrote the note', null, null);
  v_x0 := v_x1;
  v_x1 := public.get_attendance_pulse('all') ->> 'items_version';
  assert v_x1 <> v_x0, 'completing an item changes the executive''s version';
  perform test.logout();
  perform test.login(v_a);
  pulse := public.get_attendance_pulse('all');
  perform test.logout();
  assert pulse ->> 'items_version' <> v_a1, 'completing an item changes the member''s poll';
  v_a1 := pulse ->> 'items_version';

  -- Somebody else's forms and items are not the member's business: B's form
  -- and B's decision do not move A's version, and nothing of B is in it.
  perform test.login(v_b);
  perform public.submit_attendance_excuse(v_past, 'My bus broke down on the way.', null, 'other', null);
  perform test.logout();
  perform test.login(v_exec);
  perform public.review_attendance_excuse((select id from public.attendance_excuses where member_id = v_b and session_id = v_past), 'denied', 'Not covered by the policy');
  perform test.logout();
  perform test.login(v_a);
  pulse := public.get_attendance_pulse('all');
  ov := public.get_attendance_overview('all');
  perform test.logout();
  assert pulse ->> 'items_version' = v_a1 and ov ->> 'items_version' = v_a1, 'another member''s form and its decision do not change the member''s version';
  assert position(v_b::text in pulse::text) = 0 and position(v_b::text in ov::text) = 0, 'no other member in a member''s poll or overview';
  -- Someone who joined after every meeting has no forms and no items.
  v_d := test.make_user('Member Ninety Two Late');
  perform test.login(v_d);
  pulse := public.get_attendance_pulse('all');
  perform test.logout();
  assert pulse ->> 'items_version' = 'm:' || md5('|'), 'a member with no forms and no items has the version of nothing';

  -- The poll and the overview agree for every audience and term, for a member
  -- and for an executive: that is what keeps the page from reloading every poll.
  v_term := private.attendance_term_key(now() - interval '10 days');
  foreach v_expect in array array['member', 'executive'] loop
    perform test.login(case when v_expect = 'member' then v_a else v_exec end);
    assert public.get_attendance_pulse('all') ->> 'items_version' = public.get_attendance_overview('all') ->> 'items_version', v_expect || ': all';
    assert public.get_attendance_pulse('club') ->> 'items_version' = public.get_attendance_overview('club') ->> 'items_version', v_expect || ': club';
    assert public.get_attendance_pulse('subgroup', v_group) ->> 'items_version' = public.get_attendance_overview('subgroup', v_group) ->> 'items_version', v_expect || ': group';
    assert public.get_attendance_pulse('all', null, v_term) ->> 'items_version' = public.get_attendance_overview('all', null, v_term) ->> 'items_version', v_expect || ': term';
    assert public.get_attendance_pulse('all', null, '1999-fall') ->> 'items_version' = public.get_attendance_overview('all', null, '1999-fall') ->> 'items_version', v_expect || ': a term with no meetings';
    perform test.logout();
  end loop;
  perform test.login(v_a);
  assert public.get_attendance_pulse('subgroup', v_group) ->> 'items_version' <> public.get_attendance_pulse('club') ->> 'items_version', 'the version follows the audience';
  perform test.logout();

  -- The poll for an executive still carries the form count and no member.
  perform test.login(v_exec);
  pulse := public.get_attendance_pulse('all');
  perform test.logout();
  assert (pulse ->> 'pending_excuses')::int = (select count(*) from public.attendance_excuses where status = 'pending'), 'waiting forms, as before';
  assert position(v_a::text in pulse::text) = 0 and position(v_b::text in pulse::text) = 0, 'no member in the executive poll';

  -- ------------------------------------------------------------ the review queue cap
  -- Three meetings, each with an open follow-up item and a waiting form for A.
  perform test.login(v_exec);
  select id into v_past2 from public.create_attendance_session('club', null, 'Past two', now() - interval '9 days');
  perform public.close_attendance_session(v_live);
  perform public.open_attendance_session(v_past2, 30);
  perform public.close_attendance_session(v_past2);
  select id into v_past3 from public.create_attendance_session('club', null, 'Past three', now() - interval '8 days');
  perform public.open_attendance_session(v_past3, 30);
  perform public.close_attendance_session(v_past3);
  perform test.logout();
  perform test.login(v_a);
  perform public.submit_attendance_excuse(v_past2, 'Out of town for a family event.', null, 'family_emergency', null);
  perform public.submit_attendance_excuse(v_past3, 'Sick with the flu all week.', null, 'illness', null);
  perform test.logout();

  perform test.login(v_exec);
  ov := public.get_attendance_overview('all', null, null, now() - interval '18 months', 1);
  assert (ov ->> 'list_limit')::int = 1 and jsonb_array_length(ov -> 'remediations') = 1 and (ov ->> 'remediations_pending')::int >= 2, 'cap 1: one open item shown, the total exact';
  assert (select count(*) from jsonb_array_elements(ov -> 'excuses') x where x ->> 'status' = 'pending') = 1 and (ov ->> 'excuses_pending')::int = 2, 'cap 1: one waiting form shown, the total exact';
  -- Show more: a larger p_list_limit returns the older items.
  ov := public.get_attendance_overview('all', null, null, now() - interval '18 months', 250);
  assert (ov ->> 'list_limit')::int = 250, 'the cap asked for is the cap applied';
  assert jsonb_array_length(ov -> 'remediations') = (ov ->> 'remediations_pending')::int, 'cap 250: every open item is listed';
  assert (select count(*) from jsonb_array_elements(ov -> 'excuses') x where x ->> 'status' = 'pending') = (ov ->> 'excuses_pending')::int, 'cap 250: every waiting form is listed';
  -- The newest comes first, so the older ones are what the first page leaves out.
  ov := public.get_attendance_overview('all', null, null, now() - interval '18 months', 1);
  assert (ov -> 'remediations' -> 0 ->> 'id')::bigint = (select max(id) from public.attendance_remediations where status = 'pending'), 'the newest open item comes first';
  -- The limits the function accepts: default 100, at least 1, at most 1000.
  assert (public.get_attendance_overview('all', null, null, now() - interval '18 months', null) ->> 'list_limit')::int = 100, 'no limit given: 100';
  assert (public.get_attendance_overview('all', null, null, now() - interval '18 months', 0) ->> 'list_limit')::int = 1, '0 is raised to 1';
  assert (public.get_attendance_overview('all', null, null, now() - interval '18 months', 750) ->> 'list_limit')::int = 750, '750 is allowed (it was cut to 500 before)';
  assert (public.get_attendance_overview('all', null, null, now() - interval '18 months', 1000) ->> 'list_limit')::int = 1000, '1000 is the most';
  assert (public.get_attendance_overview('all', null, null, now() - interval '18 months', 100000) ->> 'list_limit')::int = 1000, 'more than that is cut to 1000';
  perform test.logout();

  -- A member's own lists are never capped.
  perform test.login(v_a);
  ov := public.get_attendance_overview('all', null, null, now() - interval '18 months', 1);
  perform test.logout();
  assert jsonb_array_length(ov -> 'excuses') = 3, 'a member gets all of their own forms whatever the limit';
end $$;
rollback;
