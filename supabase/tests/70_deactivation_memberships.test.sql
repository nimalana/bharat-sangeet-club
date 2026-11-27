-- core-8: deactivation marks memberships inactive (not removed), so a member who
-- is reactivated can ask to join open groups again.
begin;
do $$
declare
  v_admin uuid := test.make_user('Admin Nine', 'admin');
  v_exec uuid := test.make_user('Exec Nine', 'executive');
  v_member uuid := test.make_user('Member Nine');
  v_open bigint;
  v_approval bigint;
  v_pending bigint;
  v_wait bigint;
  v_removed bigint;
  v_invite bigint;
  v_status public.subgroup_membership_status;
  v_role public.subgroup_membership_role;
  message text;
  v_details jsonb;
begin
  perform test.login(v_exec);
  select id into v_open from public.create_subgroup('Nine Open', '', 'open');
  select id into v_approval from public.create_subgroup('Nine Approval', '', 'approval');
  select id into v_pending from public.create_subgroup('Nine Pending', '', 'approval');
  select id into v_wait from public.create_subgroup('Nine Waitlist', '', 'approval');
  select id into v_removed from public.create_subgroup('Nine Removed', '', 'open');
  select id into v_invite from public.create_subgroup('Nine Invite', '', 'invite');
  perform public.add_subgroup_member(v_open, v_member);
  perform public.set_subgroup_member_role(v_open, v_member, 'manager');
  perform public.add_subgroup_member(v_approval, v_member);
  perform public.add_subgroup_member(v_invite, v_member);
  perform public.add_subgroup_member(v_removed, v_member);
  perform public.remove_subgroup_member(v_removed, v_member);
  perform test.logout();
  perform test.login(v_member);
  perform public.request_subgroup_enrollment(v_pending);
  perform public.request_subgroup_enrollment(v_wait);
  perform test.logout();
  perform test.login(v_exec);
  perform public.review_subgroup_request(v_wait, v_member, 'waitlist');
  perform test.logout();

  -- Deactivate.
  perform test.login(v_admin);
  perform public.admin_deactivate_member(v_member, 'Mistake');
  perform test.logout();

  assert (select count(*) from public.subgroup_memberships m where m.member_id = v_member and m.status = 'removed' and m.subgroup_id <> v_removed) = 0,
    'deactivation marks nothing removed';
  assert (select count(*) from public.subgroup_memberships m
          where m.member_id = v_member and m.status = 'inactive' and m.membership_role = 'member'
            and m.subgroup_id in (v_open, v_approval, v_pending, v_wait, v_invite)) = 5,
    'active, pending and waitlisted memberships become inactive and roles are reset';
  assert (select m.status from public.subgroup_memberships m where m.member_id = v_member and m.subgroup_id = v_removed) = 'removed',
    'a membership removed on purpose before stays removed';
  assert (select count(*) from public.subgroup_memberships m
          where m.member_id = v_member and m.status = 'inactive' and m.reviewed_by = v_admin and m.status_updated_at is not null) = 5,
    'the rows record who changed them';

  -- The audit entry lists the groups and roles, so they can be put back.
  select a.details into v_details from public.admin_audit_log a where a.target_id = v_member and a.action = 'member_deactivated';
  assert (v_details ->> 'groups_removed')::int = 5, 'groups_removed still counts the rows changed';
  assert jsonb_array_length(v_details -> 'groups') = 5, 'every group is listed';
  assert exists (select 1 from jsonb_array_elements(v_details -> 'groups') g
                 where (g ->> 'subgroup_id')::bigint = v_open and g ->> 'membership_role' = 'manager' and g ->> 'status' = 'active'), 'the manager role in the open group is recorded';
  assert exists (select 1 from jsonb_array_elements(v_details -> 'groups') g
                 where (g ->> 'subgroup_id')::bigint = v_wait and g ->> 'status' = 'waitlisted'), 'a waitlisted request is recorded';
  assert not exists (select 1 from jsonb_array_elements(v_details -> 'groups') g where (g ->> 'subgroup_id')::bigint = v_removed), 'the removed group is not listed';

  -- While deactivated the person cannot ask to join anything.
  message := test.error_as(v_member, format('select public.request_subgroup_enrollment(%s)', v_open));
  assert message is not null, 'a deactivated member cannot request: ' || coalesce(message, 'no error');
  assert (select m.status from public.subgroup_memberships m where m.member_id = v_member and m.subgroup_id = v_open) = 'inactive';

  -- Reactivate: they can ask again.
  perform test.login(v_admin);
  perform public.admin_reactivate_member(v_member);
  perform test.logout();
  perform test.login(v_member);
  select status, membership_role into v_status, v_role from public.request_subgroup_enrollment(v_open);
  assert v_status = 'active' and v_role = 'member', 'an open group takes them back as a plain member: ' || v_status::text || '/' || v_role::text;
  select status into v_status from public.request_subgroup_enrollment(v_approval);
  assert v_status = 'pending', 'an approval group gets a new request';
  perform test.logout();
  message := test.error_as(v_member, format('select public.request_subgroup_enrollment(%s)', v_invite));
  assert message like '%invitation only%', 'an invitation-only group still needs an executive: ' || coalesce(message, 'no error');
  message := test.error_as(v_member, format('select public.request_subgroup_enrollment(%s)', v_removed));
  assert message like 'You were removed from this group%', 'a group they were removed from on purpose still refuses them: ' || coalesce(message, 'no error');
end $$;
rollback;
