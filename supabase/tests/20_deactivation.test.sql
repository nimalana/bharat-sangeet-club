-- Member deactivation: a deactivated account keeps its history and loses all
-- access, through policies and through security definer functions alike.
begin;
do $$
declare
  v_admin uuid := test.make_user('Admin Two', 'admin');
  v_exec uuid := test.make_user('Exec Two', 'executive');
  v_member uuid := test.make_user('Member Two');
  v_other uuid := test.make_user('Other Two');
  v_group bigint;
  message text;
  missing text;
  v_session bigint;
  n bigint;
begin
  -- Every public table carries the policy and the trigger.
  select string_agg(c.relname, ', ') into missing
  from pg_class c
  where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
    and (not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname and p.policyname = 'Active members only' and p.permissive = 'RESTRICTIVE')
      or not exists (select 1 from pg_trigger t where t.tgrelid = c.oid and t.tgname = 'block_deactivated_writer'));
  assert missing is null, 'tables missing the deactivation policy or trigger: ' || missing;

  -- Setup: a group with the member as manager, an announcement, a reimbursement.
  perform test.login(v_exec);
  select id into v_group from public.create_subgroup('Deactivation Ensemble', '', 'open');
  perform public.add_subgroup_member(v_group, v_member);
  perform public.set_subgroup_member_role(v_group, v_member, 'manager');
  insert into public.announcements (title, body, created_by) values ('Hello', 'Club-wide', v_exec);
  perform test.logout();
  perform test.login(v_member);
  perform public.submit_member_reimbursement('Strings', 'Shop', 20, current_date, 'Supplies', '1234');
  perform test.logout();

  assert test.count_as(v_member, 'select count(*) from public.announcements') = 1, 'active member reads announcements';
  assert test.count_as(v_member, 'select count(*) from public.profiles') >= 4, 'active member reads the directory';

  -- Only admins deactivate; not themselves.
  message := test.error_as(v_exec, format('select public.admin_deactivate_member(%L, ''left'')', v_member));
  assert message like 'Only administrators%', 'executives cannot deactivate: ' || coalesce(message, 'no error');
  message := test.error_as(v_admin, format('select public.admin_deactivate_member(%L, '''')', v_admin));
  assert message like 'Administrators cannot deactivate themselves%';

  -- Deleting a member with finance history gives a readable message.
  message := test.error_as(v_admin, format('select public.admin_delete_member(%L)', v_member));
  assert message like 'This member has finance or recording history%', 'delete explains itself: ' || coalesce(message, 'no error');
  assert (select count(*) from public.admin_audit_log where target_id = v_member and action = 'member_deleted') = 0, 'failed delete leaves no audit row';

  -- Deactivate.
  message := test.error_as(v_admin, format('select public.admin_deactivate_member(%L, ''Graduated'')', v_member));
  assert message is null, 'admin deactivates: ' || coalesce(message, '');
  assert (select status from public.profiles where id = v_member) = 'deactivated';
  assert (select m.status from public.subgroup_memberships m where m.member_id = v_member and m.subgroup_id = v_group) = 'removed', 'memberships are marked removed';
  assert (select m.membership_role from public.subgroup_memberships m where m.member_id = v_member and m.subgroup_id = v_group) = 'member', 'manager role is dropped';
  assert (select count(*) from public.admin_audit_log where target_id = v_member and action = 'member_deactivated' and details ->> 'reason' = 'Graduated') = 1, 'deactivation is audited';
  assert (select count(*) from public.personal_reimbursements r where r.member_id = v_member) = 1, 'finance history is kept';
  message := test.error_as(v_admin, format('select public.admin_deactivate_member(%L, '''')', v_member));
  assert message like 'This member is already deactivated%';

  -- Reads: nothing but their own profile row.
  assert test.count_as(v_member, 'select count(*) from public.announcements') = 0, 'deactivated member reads no announcements';
  assert test.count_as(v_member, 'select count(*) from public.events') = 0;
  assert test.count_as(v_member, 'select count(*) from public.subgroups') = 0;
  assert test.count_as(v_member, 'select count(*) from public.personal_reimbursements') = 0;
  assert test.count_as(v_member, 'select count(*) from public.finance_expenses') = 0;
  assert test.count_as(v_member, 'select count(*) from public.profiles') = 1, 'deactivated member reads only their own profile';
  assert test.count_as(v_member, 'select count(*) from storage.objects') = 0;

  -- Writes through definer functions are refused.
  message := test.error_as(v_member, 'select public.submit_member_reimbursement(''More'', ''Shop'', 5, current_date, ''Supplies'', ''1234'')');
  assert message like 'Your access to the portal has been deactivated%', 'reimbursement refused: ' || coalesce(message, 'no error');
  message := test.error_as(v_member, format('select public.request_subgroup_enrollment(%s)', v_group));
  assert message is not null, 'enrollment refused';
  message := test.error_as(v_member, format('select public.leave_subgroup(%s)', v_group));
  assert message is not null, 'leave refused';
  message := test.error_as(v_member, format('select public.update_subgroup(%s, ''Hijacked'', '''')', v_group));
  assert message is not null, 'former manager cannot rename the group';
  message := test.error_as(v_member, 'update public.profiles set full_name = ''Ghost'' where id = (select auth.uid())');
  assert (select p.full_name from public.profiles p where p.id = v_member) = 'Member Two', 'profile edit refused';

  -- Nobody can add a deactivated member to a group.
  message := test.error_as(v_exec, format('select public.add_subgroup_member(%s, %L)', v_group, v_member));
  assert message like 'This member is deactivated%', 'cannot add a deactivated member: ' || coalesce(message, 'no error');

  -- A deactivated executive loses executive powers.
  perform test.login(v_admin);
  perform public.admin_deactivate_member(v_exec, 'Stepped down');
  perform test.logout();
  message := test.error_as(v_exec, 'select public.create_subgroup(''Rogue'', '''', ''open'')');
  assert message is not null, 'deactivated executive cannot create groups';
  assert test.count_as(v_exec, 'select count(*) from public.finance_payments') = 0;

  -- Club-wide attendance rosters skip deactivated members.
  perform test.login(v_admin);
  select id into v_session from public.create_attendance_session('club', null, 'Roster check', now());
  perform public.open_attendance_session(v_session, 30);
  perform test.logout();
  select count(*) into n from public.attendance_session_participants p where p.session_id = v_session and p.member_id in (v_member, v_exec);
  assert n = 0, 'deactivated members are left off the roster';
  assert exists (select 1 from public.attendance_session_participants p where p.session_id = v_session and p.member_id = v_other), 'active members are on the roster';

  -- Reactivate: access returns, group memberships do not.
  message := test.error_as(v_exec, format('select public.admin_reactivate_member(%L)', v_member));
  assert message like 'Only administrators%';
  perform test.login(v_admin);
  perform public.admin_reactivate_member(v_member);
  perform test.logout();
  assert test.count_as(v_member, 'select count(*) from public.announcements') = 1, 'reactivated member reads again';
  assert test.count_as(v_member, format('select count(*) from public.subgroup_memberships where subgroup_id = %s and member_id = (select auth.uid()) and status = ''active''', v_group)) = 0, 'memberships are not restored';
  assert (select count(*) from public.admin_audit_log where target_id = v_member and action = 'member_reactivated') = 1;
end $$;
rollback;
