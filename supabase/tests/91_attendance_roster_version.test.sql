-- Round 2, finding 1 (major): the roster 'version' is what tells the page that
-- the roster it holds is out of date. It used to be count(*) of the marks plus
-- the newest update time, so opening check-in on a DRAFT meeting (which adds
-- every participant but not a single mark) left it unchanged: the page never
-- reread the roster and an executive saw no members to mark.
--
-- The version now covers what the roster shows: who is on it and each mark,
-- minutes late and units. The same text comes from the overview, the poll and
-- the roster, and it changes whenever the roster content changes.
begin;
do $$
declare
  v_exec uuid := test.make_user('Exec Ninety One', 'executive');
  v_a uuid := test.make_user('Member Ninety One A');
  v_b uuid := test.make_user('Member Ninety One B');
  v_e uuid := test.make_user('Member Ninety One E');
  v_group bigint;
  v_draft bigint; v_live bigint; v_sub bigint;
  v_draft_roster jsonb; v_open_roster jsonb; v_roster jsonb; v_pulse jsonb; v_ov jsonb;
  v_before text; v_after text;
  v_members integer;
begin
  perform test.login(v_exec);

  -- ---- Draft to open: participants appear, no marks yet ----------------------------------
  select id into v_draft from public.create_attendance_session('club', null, 'Draft then open', now() + interval '1 hour');
  v_draft_roster := public.get_attendance_roster(v_draft);
  assert jsonb_array_length(v_draft_roster -> 'rows') = 0, 'a draft has no roster';

  perform public.open_attendance_session(v_draft, 30);
  v_open_roster := public.get_attendance_roster(v_draft);
  assert jsonb_array_length(v_open_roster -> 'rows') >= 3, 'opening adds every participant';
  assert (select count(*) from public.attendance_records where session_id = v_draft) = 0, 'and no marks: this is the case the old version missed';
  assert v_open_roster ->> 'version' <> v_draft_roster ->> 'version', 'opening check-in changes the roster version even before the first mark';

  -- The poll and the overview carry the same text as the roster, so the page's
  -- stale test (roster version against live version) answers correctly.
  v_pulse := public.get_attendance_pulse('all');
  assert (v_pulse -> 'sessions' -> 0 ->> 'id')::bigint = v_draft, 'the opened draft is the polled meeting';
  assert v_pulse -> 'sessions' -> 0 -> 'live' ->> 'version' = v_open_roster ->> 'version', 'the poll agrees with the roster';
  v_ov := public.get_attendance_overview('all');
  assert (select s -> 'live' ->> 'version' from jsonb_array_elements(v_ov -> 'sessions') s where (s ->> 'id')::bigint = v_draft) = v_open_roster ->> 'version', 'the overview agrees with the roster';
  -- A page that read the draft roster before opening sees it as out of date:
  assert v_draft_roster ->> 'version' <> v_pulse -> 'sessions' -> 0 -> 'live' ->> 'version', 'a roster read before opening is stale against the poll';

  -- Reading again without any change gives the same version (no refetch loop).
  assert public.get_attendance_roster(v_draft) ->> 'version' = v_open_roster ->> 'version', 'the version is stable while nothing changes';
  assert public.get_attendance_pulse('all') -> 'sessions' -> 0 -> 'live' ->> 'version' = v_open_roster ->> 'version', 'and so is the poll';

  -- ---- Marks, including a change that leaves the count alone ----------------------------
  v_before := v_open_roster ->> 'version';
  perform public.set_attendance_status(v_draft, v_a, 'present', '', 0);
  v_after := public.get_attendance_roster(v_draft) ->> 'version';
  assert v_after <> v_before, 'a first mark changes the version';
  v_before := v_after;
  -- Same member, same row, new status: the number of marks does not move and,
  -- inside one transaction, neither does the update time. The content did.
  perform public.set_attendance_status(v_draft, v_a, 'tardy', '', 12);
  v_after := public.get_attendance_roster(v_draft) ->> 'version';
  assert v_after <> v_before, 'changing a mark to another status changes the version (count and timestamp alone would miss it)';
  v_before := v_after;
  perform public.set_attendance_status(v_draft, v_a, 'tardy', '', 25);
  v_after := public.get_attendance_roster(v_draft) ->> 'version';
  assert v_after <> v_before, 'so does a change in minutes late';
  v_before := v_after;
  perform public.set_attendance_status(v_draft, v_a, 'tardy', 'Only the note changed', 25);
  assert public.get_attendance_roster(v_draft) ->> 'version' = v_before, 'a note is not on the roster, so it does not change the version';
  perform public.clear_attendance_status(v_draft, v_a);
  v_after := public.get_attendance_roster(v_draft) ->> 'version';
  assert v_after = v_open_roster ->> 'version', 'clearing the only mark returns to the content of the open roster, and to its version';

  -- ---- Closing marks everyone still missing ------------------------------------------------
  v_before := v_after;
  perform public.close_attendance_session(v_draft);
  assert public.get_attendance_roster(v_draft) ->> 'version' <> v_before, 'closing check-in (absences for everyone missing) changes the version';
  assert (select count(*) from jsonb_array_elements(public.get_attendance_roster(v_draft) -> 'rows') r where r ->> 'status' = 'absent') = jsonb_array_length(public.get_attendance_roster(v_draft) -> 'rows'), 'everyone is absent after close';

  -- ---- A group meeting that gains a participant when opened again --------------------------
  select id into v_group from public.create_subgroup('Version Ensemble', '', 'open');
  perform public.add_subgroup_member(v_group, v_a);
  perform public.add_subgroup_member(v_group, v_b);
  select id into v_sub from public.create_attendance_session('subgroup', v_group, 'Version Ensemble rehearsal', now() + interval '2 hours');
  perform public.open_attendance_session(v_sub, 30);
  v_before := public.get_attendance_roster(v_sub) ->> 'version';
  v_members := jsonb_array_length(public.get_attendance_roster(v_sub) -> 'rows');
  assert v_members = (select count(*) from public.subgroup_memberships where subgroup_id = v_group and status = 'active') and v_members >= 2, 'the roster is the active members';
  perform public.add_subgroup_member(v_group, v_e);
  perform public.open_attendance_session(v_sub, 30);   -- opening an open meeting again takes the new member in
  v_roster := public.get_attendance_roster(v_sub);
  assert jsonb_array_length(v_roster -> 'rows') = v_members + 1, 'the new member joined the roster';
  assert v_roster ->> 'version' <> v_before, 'a roster that gained a participant has a new version';
  assert public.get_attendance_pulse('subgroup', v_group) -> 'sessions' -> 0 -> 'live' ->> 'version' = v_roster ->> 'version', 'the poll follows';

  -- ---- A draft's participants are replaced when it is opened ---------------------------------
  select id into v_live from public.create_attendance_session('subgroup', v_group, 'Second rehearsal', now() + interval '3 hours');
  v_before := public.get_attendance_roster(v_live) ->> 'version';
  perform public.close_attendance_session(v_sub);
  perform public.open_attendance_session(v_live, 30);
  assert public.get_attendance_roster(v_live) ->> 'version' <> v_before, 'opening a group draft changes its roster version';
  perform test.logout();

  -- ---- A member's roster only ever holds their own row --------------------------------------
  perform test.login(v_a);
  v_roster := public.get_attendance_roster(v_live);
  perform test.logout();
  assert jsonb_array_length(v_roster -> 'rows') = 1 and position(v_b::text in v_roster::text) = 0, 'a member sees only their own row and no other member in the version';
  perform test.login(v_exec);
  assert v_roster ->> 'version' <> public.get_attendance_roster(v_live) ->> 'version', 'a member''s version is computed from what the member can read';
  perform test.logout();
end $$;
rollback;
