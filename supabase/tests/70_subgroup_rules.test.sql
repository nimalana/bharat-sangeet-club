-- Review follow-ups for groups: core-1 (old review function), core-5 (who can be
-- removed) and core-7 (what an archived group still accepts).
begin;
do $$
declare
  v_exec uuid := test.make_user('Exec Seven', 'executive');
  v_admin uuid := test.make_user('Admin Seven', 'admin');
  v_manager uuid := test.make_user('Manager Seven');
  v_leader uuid := test.make_user('Leader Seven');
  v_member uuid := test.make_user('Member Seven');
  v_left uuid := test.make_user('Left Seven');
  v_applicant uuid := test.make_user('Applicant Seven');
  v_waiting uuid := test.make_user('Waitlisted Seven');
  v_late uuid := test.make_user('Late Seven');
  v_group bigint;
  v_arch bigint;
  v_live bigint;
  message text;
  v_status public.subgroup_membership_status;
  v_name text;
begin
  perform test.login(v_exec);
  select id into v_group from public.create_subgroup('Seven Ensemble', '', 'approval');
  perform public.add_subgroup_member(v_group, v_manager);
  perform public.add_subgroup_member(v_group, v_leader);
  perform public.add_subgroup_member(v_group, v_member);
  perform public.add_subgroup_member(v_group, v_left);
  perform public.set_subgroup_member_role(v_group, v_manager, 'manager');
  perform public.set_subgroup_member_role(v_group, v_leader, 'leader');
  perform test.logout();

  -- ---------------------------------------------------------------------
  -- core-1: the old review function is not callable by anyone signed in.
  -- ---------------------------------------------------------------------
  perform test.login(v_manager);
  perform public.remove_subgroup_member(v_group, v_member);
  perform test.logout();
  assert (select m.status from public.subgroup_memberships m where m.subgroup_id = v_group and m.member_id = v_member) = 'removed';

  message := test.error_as(v_leader, format('select public.review_subgroup_enrollment(%s, %L, ''active'')', v_group, v_member));
  assert message like 'permission denied%', 'a leader cannot re-admit a removed member: ' || coalesce(message, 'no error');
  message := test.error_as(v_manager, format('select public.review_subgroup_enrollment(%s, %L, ''inactive'')', v_group, v_leader));
  assert message like 'permission denied%', 'a manager cannot use the old function either: ' || coalesce(message, 'no error');
  message := test.error_as(v_exec, format('select public.review_subgroup_enrollment(%s, %L, ''active'')', v_group, v_member));
  assert message like 'permission denied%', 'nor can an executive; they use add_subgroup_member';
  message := test.error_as(null, format('select public.review_subgroup_enrollment(%s, %L, ''active'')', v_group, v_member));
  assert message like 'permission denied%', 'nor can an anonymous visitor';
  assert (select m.status from public.subgroup_memberships m where m.subgroup_id = v_group and m.member_id = v_member) = 'removed', 'the removed member stays removed';

  -- Should the function ever be granted again, its body still refuses a removed
  -- row and an archived group. (Granted inside this transaction only.)
  grant execute on function public.review_subgroup_enrollment(bigint, uuid, public.subgroup_membership_status) to authenticated;
  message := test.error_as(v_leader, format('select public.review_subgroup_enrollment(%s, %L, ''active'')', v_group, v_member));
  assert message like 'membership request not found%', 'the old body refuses a removed row: ' || coalesce(message, 'no error');
  perform test.login(v_exec);
  perform public.set_subgroup_archived(v_group, true);
  perform test.logout();
  message := test.error_as(v_leader, format('select public.review_subgroup_enrollment(%s, %L, ''inactive'')', v_group, v_manager));
  assert message like 'This group is archived%', 'the old body refuses an archived group: ' || coalesce(message, 'no error');
  revoke execute on function public.review_subgroup_enrollment(bigint, uuid, public.subgroup_membership_status) from authenticated;
  perform test.login(v_exec);
  perform public.set_subgroup_archived(v_group, false);
  perform test.logout();

  -- ---------------------------------------------------------------------
  -- core-5: removing applies to people in the group or who left it, not to
  -- requests that are still waiting.
  -- ---------------------------------------------------------------------
  perform test.login(v_applicant);
  perform public.request_subgroup_enrollment(v_group);
  perform test.logout();
  perform test.login(v_waiting);
  perform public.request_subgroup_enrollment(v_group);
  perform test.logout();
  perform test.login(v_leader);
  perform public.review_subgroup_request(v_group, v_waiting, 'waitlist');
  perform test.logout();

  message := test.error_as(v_manager, format('select public.remove_subgroup_member(%s, %L)', v_group, v_applicant));
  assert message like 'That person is waiting for review%', 'a pending request cannot be removed: ' || coalesce(message, 'no error');
  message := test.error_as(v_manager, format('select public.remove_subgroup_member(%s, %L)', v_group, v_waiting));
  assert message like 'That person is waiting for review%', 'a waitlisted request cannot be removed: ' || coalesce(message, 'no error');
  message := test.error_as(v_exec, format('select public.remove_subgroup_member(%s, %L)', v_group, v_applicant));
  assert message like 'That person is waiting for review%', 'not even by an executive';
  assert (select m.status from public.subgroup_memberships m where m.subgroup_id = v_group and m.member_id = v_applicant) = 'pending', 'the request is untouched';
  message := test.error_as(v_manager, format('select public.remove_subgroup_member(%s, %L)', v_group, v_member));
  assert message like 'That person is not in this group%', 'an already removed member: ' || coalesce(message, 'no error');

  -- Declining is the way to turn a request down, and the person may ask again.
  perform test.login(v_manager);
  select status into v_status from public.review_subgroup_request(v_group, v_applicant, 'decline');
  perform test.logout();
  assert v_status = 'inactive';
  perform test.login(v_applicant);
  select status into v_status from public.request_subgroup_enrollment(v_group);
  perform test.logout();
  assert v_status = 'pending', 'a declined applicant can ask again';

  -- A person who left (inactive) can be removed, which stops them rejoining.
  perform test.login(v_exec);
  perform public.set_subgroup_enrollment_mode(v_group, 'open');
  perform test.logout();
  perform test.login(v_left);
  perform public.leave_subgroup(v_group);
  perform test.logout();
  perform test.login(v_manager);
  select status into v_status from public.remove_subgroup_member(v_group, v_left);
  perform test.logout();
  assert v_status = 'removed', 'a member who left can be removed';
  message := test.error_as(v_left, format('select public.request_subgroup_enrollment(%s)', v_group));
  assert message like 'You were removed from this group%', 'and then cannot rejoin by themself';

  -- The role limits are unchanged.
  message := test.error_as(v_manager, format('select public.remove_subgroup_member(%s, %L)', v_group, v_leader));
  assert message like 'Only executives can remove a group leader%';
  message := test.error_as(v_leader, format('select public.remove_subgroup_member(%s, %L)', v_group, v_manager));
  assert message like 'Only group managers%', 'a leader still cannot remove: ' || coalesce(message, 'no error');

  -- ---------------------------------------------------------------------
  -- core-7: archived groups. A fresh approval group with a manager, a member
  -- and a request that is still waiting when the group is archived.
  -- ---------------------------------------------------------------------
  perform test.login(v_exec);
  select id into v_arch from public.create_subgroup('Seven Archive', '', 'approval');
  select id into v_live from public.create_subgroup('Seven Live', '', 'approval');
  perform public.add_subgroup_member(v_arch, v_manager);
  perform public.add_subgroup_member(v_arch, v_member);
  perform public.set_subgroup_member_role(v_arch, v_manager, 'manager');
  perform public.add_subgroup_member(v_live, v_member);
  perform test.logout();
  perform test.login(v_late);
  perform public.request_subgroup_enrollment(v_arch);
  perform test.logout();
  perform test.login(v_applicant);
  perform public.request_subgroup_enrollment(v_arch);
  perform test.logout();
  perform test.login(v_exec);
  perform public.set_subgroup_archived(v_arch, true);
  perform test.logout();

  message := test.error_as(v_manager, format('select public.update_subgroup(%s, ''Renamed by manager'', '''')', v_arch));
  assert message like 'This group is archived%', 'a manager cannot rename an archived group: ' || coalesce(message, 'no error');
  message := test.error_as(v_manager, format('select public.remove_subgroup_member(%s, %L)', v_arch, v_member));
  assert message like 'This group is archived%', 'a manager cannot remove from an archived group: ' || coalesce(message, 'no error');
  assert (select m.status from public.subgroup_memberships m where m.subgroup_id = v_arch and m.member_id = v_member) = 'active';
  message := test.error_as(v_member, format('select public.update_subgroup(%s, ''X'', '''')', v_arch));
  assert message like 'Only group managers%', 'a plain member is told about permission, not about archiving';

  -- A request that was waiting when the group was archived can be declined,
  -- but not approved or waitlisted.
  message := test.error_as(v_manager, format('select public.review_subgroup_request(%s, %L, ''approve'')', v_arch, v_late));
  assert message like 'This group is archived%', 'approve is refused: ' || coalesce(message, 'no error');
  message := test.error_as(v_manager, format('select public.review_subgroup_request(%s, %L, ''waitlist'')', v_arch, v_late));
  assert message like 'This group is archived%', 'waitlist is refused';
  perform test.login(v_manager);
  select status into v_status from public.review_subgroup_request(v_arch, v_late, 'decline');
  perform test.logout();
  assert v_status = 'inactive', 'a manager can decline a request in an archived group';
  perform test.login(v_exec);
  select status into v_status from public.review_subgroup_request(v_arch, v_applicant, 'decline');
  perform test.logout();
  assert v_status = 'inactive', 'so can an executive';

  -- Executives can still administer an archived group (they could restore it anyway).
  perform test.login(v_exec);
  perform public.update_subgroup(v_arch, 'Seven Archive Renamed', '');
  perform public.remove_subgroup_member(v_arch, v_member);
  perform test.logout();
  select name into v_name from public.subgroups where id = v_arch;
  assert v_name = 'Seven Archive Renamed', 'an executive can rename an archived group';
  assert (select m.status from public.subgroup_memberships m where m.subgroup_id = v_arch and m.member_id = v_member) = 'removed', 'and remove a member';
  -- Put the member back for the profile editor checks below.
  perform test.login(v_exec);
  perform public.set_subgroup_archived(v_arch, false);
  perform public.add_subgroup_member(v_arch, v_member);
  perform public.set_subgroup_archived(v_arch, true);
  perform test.logout();

  -- admin_update_member_profile: the editor lists live groups only.
  perform test.login(v_admin);
  perform public.admin_update_member_profile(v_member, 'Member Seven', '', '', '', array[v_live]);
  perform test.logout();
  assert (select m.status from public.subgroup_memberships m where m.subgroup_id = v_arch and m.member_id = v_member) = 'active',
    'saving a profile does not remove the member from an archived group';
  assert (select m.status from public.subgroup_memberships m where m.subgroup_id = v_live and m.member_id = v_member) = 'active';
  assert (select m.status from public.subgroup_memberships m where m.subgroup_id = v_group and m.member_id = v_member) = 'removed',
    'a removed membership stays removed';
  -- An archived group the member is already in can be named; one they are not in cannot.
  message := test.error_as(v_admin, format('select public.admin_update_member_profile(%L, ''Member Seven'', '''', '''', '''', array[%s, %s])', v_member, v_live, v_arch));
  assert message is null, 'an archived group the member is already in is harmless: ' || coalesce(message, '');
  message := test.error_as(v_admin, format('select public.admin_update_member_profile(%L, ''Late Seven'', '''', '''', '''', array[%s])', v_late, v_arch));
  assert message like 'Group not found or archived%', 'nobody is added to an archived group: ' || coalesce(message, 'no error');
  assert not exists (select 1 from public.subgroup_memberships m where m.subgroup_id = v_arch and m.member_id = v_late and m.status = 'active');
  message := test.error_as(v_admin, format('select public.admin_update_member_profile(%L, ''Late Seven'', '''', '''', '''', array[999999999])', v_late));
  assert message like 'Group not found or archived%', 'an id that is not a group is refused: ' || coalesce(message, 'no error');
  -- Live groups still work as before.
  perform test.login(v_admin);
  perform public.admin_update_member_profile(v_late, 'Late Seven', '', '', '', array[v_live]);
  perform test.logout();
  assert (select m.status from public.subgroup_memberships m where m.subgroup_id = v_live and m.member_id = v_late) = 'active';
end $$;
rollback;
