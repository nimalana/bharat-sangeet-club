-- Round 2 of core-5: remove_subgroup_member answers "who may do this" before it
-- says anything about the person being removed, so a signed-in member with no
-- standing in the group cannot learn who has a pending or waitlisted request.
begin;
do $$
declare
  v_exec uuid := test.make_user('Exec Probe', 'executive');
  v_manager uuid := test.make_user('Manager Probe');
  v_leader uuid := test.make_user('Leader Probe');
  v_member uuid := test.make_user('Member Probe');
  v_stranger uuid := test.make_user('Stranger Probe');
  v_pending uuid := test.make_user('Pending Probe');
  v_waiting uuid := test.make_user('Waitlisted Probe');
  v_gone uuid := test.make_user('Removed Probe');
  v_never uuid := test.make_user('Never Probe');
  v_other_manager uuid := test.make_user('Other Manager Probe');
  v_group bigint;
  v_other bigint;
  v_arch bigint;
  message text;
  expected constant text := 'Only group managers and executives can remove members';
begin
  perform test.login(v_exec);
  select id into v_group from public.create_subgroup('Probe Ensemble', '', 'approval');
  select id into v_other from public.create_subgroup('Probe Other', '', 'approval');
  select id into v_arch from public.create_subgroup('Probe Archived', '', 'approval');
  perform public.add_subgroup_member(v_group, v_manager);
  perform public.add_subgroup_member(v_group, v_leader);
  perform public.add_subgroup_member(v_group, v_member);
  perform public.add_subgroup_member(v_group, v_gone);
  perform public.add_subgroup_member(v_other, v_other_manager);
  perform public.add_subgroup_member(v_arch, v_manager);
  perform public.add_subgroup_member(v_arch, v_member);
  perform public.set_subgroup_member_role(v_group, v_manager, 'manager');
  perform public.set_subgroup_member_role(v_group, v_leader, 'leader');
  perform public.set_subgroup_member_role(v_other, v_other_manager, 'manager');
  perform public.set_subgroup_member_role(v_arch, v_manager, 'manager');
  perform public.remove_subgroup_member(v_group, v_gone);
  perform test.logout();
  perform test.login(v_pending);
  perform public.request_subgroup_enrollment(v_group);
  perform test.logout();
  perform test.login(v_waiting);
  perform public.request_subgroup_enrollment(v_group);
  perform test.logout();
  perform test.login(v_leader);
  perform public.review_subgroup_request(v_group, v_waiting, 'waitlist');
  perform test.logout();

  -- ---------------------------------------------------------------------
  -- The probe: whoever may not remove anyone gets the same answer whatever the
  -- target is (a waiting request, a waitlisted one, a removed one, a stranger,
  -- an active member, or nobody at all).
  -- ---------------------------------------------------------------------
  message := test.error_as(v_stranger, format('select public.remove_subgroup_member(%s, %L)', v_group, v_pending));
  assert message = expected, 'a stranger asking about a pending request: ' || coalesce(message, 'no error');
  message := test.error_as(v_stranger, format('select public.remove_subgroup_member(%s, %L)', v_group, v_waiting));
  assert message = expected, 'a waitlisted request: ' || coalesce(message, 'no error');
  message := test.error_as(v_stranger, format('select public.remove_subgroup_member(%s, %L)', v_group, v_gone));
  assert message = expected, 'a removed member: ' || coalesce(message, 'no error');
  message := test.error_as(v_stranger, format('select public.remove_subgroup_member(%s, %L)', v_group, v_never));
  assert message = expected, 'someone with no row: ' || coalesce(message, 'no error');
  message := test.error_as(v_stranger, format('select public.remove_subgroup_member(%s, %L)', v_group, v_member));
  assert message = expected, 'an active member: ' || coalesce(message, 'no error');
  message := test.error_as(v_member, format('select public.remove_subgroup_member(%s, %L)', v_group, v_pending));
  assert message = expected, 'a plain member of the group: ' || coalesce(message, 'no error');
  message := test.error_as(v_leader, format('select public.remove_subgroup_member(%s, %L)', v_group, v_waiting));
  assert message = expected, 'a leader (reviews requests, does not remove): ' || coalesce(message, 'no error');
  message := test.error_as(v_other_manager, format('select public.remove_subgroup_member(%s, %L)', v_group, v_pending));
  assert message = expected, 'the manager of a different group: ' || coalesce(message, 'no error');
  message := test.error_as(v_pending, format('select public.remove_subgroup_member(%s, %L)', v_group, v_waiting));
  assert message = expected, 'one applicant asking about another: ' || coalesce(message, 'no error');
  message := test.error_as(null, format('select public.remove_subgroup_member(%s, %L)', v_group, v_pending));
  assert message like 'permission denied%', 'a visitor: ' || coalesce(message, 'no error');

  -- Nothing changed.
  assert (select m.status from public.subgroup_memberships m where m.subgroup_id = v_group and m.member_id = v_pending) = 'pending';
  assert (select m.status from public.subgroup_memberships m where m.subgroup_id = v_group and m.member_id = v_waiting) = 'waitlisted';
  assert (select m.status from public.subgroup_memberships m where m.subgroup_id = v_group and m.member_id = v_member) = 'active';

  -- ---------------------------------------------------------------------
  -- The people who may ask still get the specific answers.
  -- ---------------------------------------------------------------------
  message := test.error_as(v_manager, format('select public.remove_subgroup_member(%s, %L)', v_group, v_pending));
  assert message like 'That person is waiting for review%', 'a manager is told the request is waiting: ' || coalesce(message, 'no error');
  message := test.error_as(v_manager, format('select public.remove_subgroup_member(%s, %L)', v_group, v_waiting));
  assert message like 'That person is waiting for review%', 'and about a waitlisted one: ' || coalesce(message, 'no error');
  message := test.error_as(v_exec, format('select public.remove_subgroup_member(%s, %L)', v_group, v_pending));
  assert message like 'That person is waiting for review%', 'an executive too: ' || coalesce(message, 'no error');
  message := test.error_as(v_manager, format('select public.remove_subgroup_member(%s, %L)', v_group, v_gone));
  assert message like 'That person is not in this group%', 'already removed: ' || coalesce(message, 'no error');
  message := test.error_as(v_manager, format('select public.remove_subgroup_member(%s, %L)', v_group, v_never));
  assert message like 'That person is not in this group%', 'no row: ' || coalesce(message, 'no error');
  message := test.error_as(v_manager, format('select public.remove_subgroup_member(%s, %L)', v_group, v_manager));
  assert message like 'Use Leave group%', 'yourself: ' || coalesce(message, 'no error');
  message := test.error_as(v_manager, format('select public.remove_subgroup_member(%s, %L)', v_group, v_leader));
  assert message like 'Only executives can remove a group leader%', 'a manager cannot remove a leader: ' || coalesce(message, 'no error');

  -- The archived-group rule still applies to a manager, after the permission check.
  perform test.login(v_exec);
  perform public.set_subgroup_archived(v_arch, true);
  perform test.logout();
  message := test.error_as(v_manager, format('select public.remove_subgroup_member(%s, %L)', v_arch, v_member));
  assert message like 'This group is archived%', 'archived group, manager: ' || coalesce(message, 'no error');
  message := test.error_as(v_stranger, format('select public.remove_subgroup_member(%s, %L)', v_arch, v_member));
  assert message = expected, 'archived group, stranger learns nothing about it: ' || coalesce(message, 'no error');

  -- Removal itself is unchanged.
  perform test.login(v_manager);
  assert (select status from public.remove_subgroup_member(v_group, v_member)) = 'removed', 'a manager removes a member';
  perform test.logout();
  perform test.login(v_exec);
  assert (select status from public.remove_subgroup_member(v_group, v_leader)) = 'removed', 'an executive removes a leader';
  assert (select status from public.remove_subgroup_member(v_arch, v_manager)) = 'removed', 'and anyone in an archived group';
  perform test.logout();
end $$;
rollback;
