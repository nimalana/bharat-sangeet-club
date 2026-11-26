-- Subgroup management: who can review, remove, edit, archive, leave.
begin;
do $$
declare
  exec_id uuid := test.make_user('Exec One', 'executive');
  manager_id uuid := test.make_user('Manager One');
  leader_id uuid := test.make_user('Leader One');
  member_id uuid := test.make_user('Member One');
  applicant_id uuid := test.make_user('Applicant One');
  outsider_id uuid := test.make_user('Outsider One');
  group_id bigint;
  open_group_id bigint;
  message text;
  row_status public.subgroup_membership_status;
  row_role public.subgroup_membership_role;
begin
  -- Setup as the executive.
  perform test.login(exec_id);
  select id into group_id from public.create_subgroup('Test Ensemble', 'For tests', 'approval');
  select id into open_group_id from public.create_subgroup('Open Ensemble', '', 'open');
  perform public.add_subgroup_member(group_id, manager_id);
  perform public.add_subgroup_member(group_id, leader_id);
  perform public.add_subgroup_member(group_id, member_id);
  perform public.set_subgroup_member_role(group_id, manager_id, 'manager');
  perform public.set_subgroup_member_role(group_id, leader_id, 'leader');
  perform test.logout();

  -- A member requests to join an approval group and waits.
  perform test.login(applicant_id);
  select status into row_status from public.request_subgroup_enrollment(group_id);
  perform test.logout();
  assert row_status = 'pending', 'approval groups create pending requests';

  -- Ordinary members and outsiders cannot review.
  message := test.error_as(member_id, format('select public.review_subgroup_request(%s, %L, ''approve'')', group_id, applicant_id));
  assert message like 'Only group leaders%', 'a plain member cannot review: ' || coalesce(message, 'no error');
  message := test.error_as(outsider_id, format('select public.review_subgroup_request(%s, %L, ''approve'')', group_id, applicant_id));
  assert message like 'Only group leaders%', 'an outsider cannot review';

  -- The roster shows requests to leaders but not to plain members.
  assert test.count_as(leader_id, format('select count(*) from public.list_subgroup_roster(%s) where status = ''pending''', group_id)) = 1, 'leader sees the request';
  assert test.count_as(member_id, format('select count(*) from public.list_subgroup_roster(%s) where status = ''pending''', group_id)) = 0, 'member does not see requests';
  assert test.count_as(member_id, format('select count(*) from public.list_subgroup_roster(%s) where status = ''active''', group_id)) = 4, 'member sees active roster';

  -- A leader who is not an executive can waitlist then approve.
  perform test.login(leader_id);
  select status into row_status from public.review_subgroup_request(group_id, applicant_id, 'waitlist');
  assert row_status = 'waitlisted';
  select status into row_status from public.review_subgroup_request(group_id, applicant_id, 'approve');
  assert row_status = 'active', 'leader can approve';
  perform test.logout();

  -- Review cannot touch someone who is already active (the old function could
  -- be used by a leader to deactivate the manager).
  message := test.error_as(leader_id, format('select public.review_subgroup_request(%s, %L, ''decline'')', group_id, manager_id));
  assert message like 'That request is no longer waiting%', 'review only acts on waiting rows: ' || coalesce(message, 'no error');
  message := test.error_as(leader_id, format('select public.review_subgroup_request(%s, %L, ''banish'')', group_id, applicant_id));
  assert message like 'Decision must be%';

  -- Removing: leaders cannot, managers can remove plain members only.
  message := test.error_as(leader_id, format('select public.remove_subgroup_member(%s, %L)', group_id, member_id));
  assert message like 'Only group managers%', 'leader cannot remove';
  message := test.error_as(manager_id, format('select public.remove_subgroup_member(%s, %L)', group_id, leader_id));
  assert message like 'Only executives can remove a group leader%', 'manager cannot remove a leader';
  message := test.error_as(manager_id, format('select public.remove_subgroup_member(%s, %L)', group_id, manager_id));
  assert message like 'Use Leave group%';
  perform test.login(manager_id);
  select status into row_status from public.remove_subgroup_member(group_id, member_id);
  perform test.logout();
  assert row_status = 'removed', 'manager removes a plain member';

  -- A removed member cannot rejoin by themself, even after the group is open.
  perform test.login(exec_id);
  perform public.set_subgroup_enrollment_mode(group_id, 'open');
  perform test.logout();
  message := test.error_as(member_id, format('select public.request_subgroup_enrollment(%s)', group_id));
  assert message like 'You were removed from this group%', 'removed member cannot rejoin: ' || coalesce(message, 'no error');

  -- An executive can add them back; an existing role is kept on re-add.
  perform test.login(exec_id);
  select status into row_status from public.add_subgroup_member(group_id, member_id);
  assert row_status = 'active';
  select membership_role into row_role from public.add_subgroup_member(group_id, manager_id);
  assert row_role = 'manager', 'adding an existing manager keeps the role';
  perform test.logout();
  message := test.error_as(manager_id, format('select public.add_subgroup_member(%s, %L)', group_id, outsider_id));
  assert message like 'Only executives can add%', 'manager cannot add directly';

  -- Leaving is voluntary, so the member may come back to an open group.
  perform test.login(member_id);
  select status into row_status from public.leave_subgroup(group_id);
  assert row_status = 'inactive';
  select status into row_status from public.request_subgroup_enrollment(group_id);
  assert row_status = 'active', 'a member who left may rejoin an open group';
  perform test.logout();
  message := test.error_as(outsider_id, format('select public.leave_subgroup(%s)', group_id));
  assert message like 'You are not in this group%';

  -- Settings: managers rename, only executives change enrollment or archive.
  perform test.login(manager_id);
  perform public.update_subgroup(group_id, '  Renamed Ensemble ', 'New words');
  perform test.logout();
  assert (select name from public.subgroups where id = group_id) = 'Renamed Ensemble';
  message := test.error_as(leader_id, format('select public.update_subgroup(%s, ''X'', '''')', group_id));
  assert message like 'Only group managers%', 'leader cannot rename';
  message := test.error_as(manager_id, format('select public.update_subgroup(%s, ''open ensemble'', '''')', group_id));
  assert message like 'Another group already uses%', 'names are unique ignoring case';
  message := test.error_as(manager_id, format('select public.update_subgroup(%s, ''   '', '''')', group_id));
  assert message like 'A group name is required%';
  message := test.error_as(manager_id, format('select public.set_subgroup_enrollment_mode(%s, ''open'')', group_id));
  assert message like 'Only executives can change%';
  message := test.error_as(manager_id, format('select public.set_subgroup_archived(%s, true)', group_id));
  assert message like 'Only executives can archive%';

  -- Archived groups refuse new requests and reviews, and can be restored.
  perform test.login(exec_id);
  perform public.set_subgroup_archived(open_group_id, true);
  perform test.logout();
  message := test.error_as(outsider_id, format('select public.request_subgroup_enrollment(%s)', open_group_id));
  assert message like 'This group is archived%';
  message := test.error_as(exec_id, format('select public.add_subgroup_member(%s, %L)', open_group_id, outsider_id));
  assert message like 'Group not found or archived%';
  perform test.login(exec_id);
  perform public.set_subgroup_archived(open_group_id, false);
  perform test.logout();
  perform test.login(outsider_id);
  select status into row_status from public.request_subgroup_enrollment(open_group_id);
  perform test.logout();
  assert row_status = 'active', 'restored open group accepts members';

  -- Anonymous visitors can call none of it.
  message := test.error_as(null, format('select public.leave_subgroup(%s)', group_id));
  assert message like 'permission denied%', 'anon has no execute: ' || coalesce(message, 'no error');
  message := test.error_as(null, format('select * from public.list_subgroup_roster(%s)', group_id));
  assert message like 'permission denied%';
end $$;

-- admin_update_member_profile no longer deletes waiting requests.
do $$
declare
  admin_id uuid := test.make_user('Admin Two', 'admin');
  target_id uuid := test.make_user('Target Two');
  group_a bigint;
  group_b bigint;
  group_c bigint;
begin
  perform test.login(admin_id);
  select id into group_a from public.create_subgroup('Group A', '', 'approval');
  select id into group_b from public.create_subgroup('Group B', '', 'approval');
  select id into group_c from public.create_subgroup('Group C', '', 'approval');
  perform public.add_subgroup_member(group_a, target_id);
  perform public.set_subgroup_member_role(group_a, target_id, 'leader');
  perform public.add_subgroup_member(group_b, target_id);
  perform test.logout();
  perform test.login(target_id);
  perform public.request_subgroup_enrollment(group_c);
  perform test.logout();

  -- Keep A, drop B, say nothing about the pending request to C.
  perform test.login(admin_id);
  perform public.admin_update_member_profile(target_id, 'Target Two', '', '', '', array[group_a]);
  perform test.logout();
  assert (select status from public.subgroup_memberships where subgroup_id = group_a and member_id = target_id) = 'active';
  assert (select membership_role from public.subgroup_memberships where subgroup_id = group_a and member_id = target_id) = 'leader', 'kept membership keeps its role';
  assert (select status from public.subgroup_memberships where subgroup_id = group_b and member_id = target_id) = 'removed', 'dropped membership is marked removed, not deleted';
  assert (select status from public.subgroup_memberships where subgroup_id = group_c and member_id = target_id) = 'pending', 'a waiting request survives a profile edit';
end $$;
rollback;
