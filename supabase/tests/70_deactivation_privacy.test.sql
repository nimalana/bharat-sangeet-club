-- core-2: the deactivation reason, who deactivated and when are visible to
-- administrators only.
begin;
do $$
declare
  v_admin uuid := test.make_user('Admin Eight', 'admin');
  v_exec uuid := test.make_user('Exec Eight', 'executive');
  v_leader uuid := test.make_user('Leader Eight');
  v_member uuid := test.make_user('Member Eight');
  v_target uuid := test.make_user('Target Eight');
  v_group bigint;
  message text;
  n bigint;
begin
  perform test.login(v_exec);
  select id into v_group from public.create_subgroup('Privacy Ensemble', '', 'open');
  perform public.add_subgroup_member(v_group, v_leader);
  perform public.set_subgroup_member_role(v_group, v_leader, 'leader');
  perform test.logout();

  perform test.login(v_admin);
  perform public.admin_deactivate_member(v_target, 'Harassment complaint #4');
  perform test.logout();

  -- profiles no longer carries the three columns, so no select (including
  -- select *) by any member can return them.
  select count(*) into n from information_schema.columns
  where table_schema = 'public' and table_name = 'profiles'
    and column_name in ('deactivation_reason', 'deactivated_by', 'deactivated_at');
  assert n = 0, 'the deactivation columns are gone from profiles';
  message := test.error_as(v_member, format('select deactivation_reason from public.profiles where id = %L', v_target));
  assert message like '%does not exist%', 'a member cannot select the reason from profiles: ' || coalesce(message, 'no error');
  assert test.count_as(v_member, 'select count(*) from (select * from public.profiles) p') >= 5, 'select * on profiles still works for members';
  assert test.count_as(v_member, format('select count(*) from public.profiles where id = %L and status = ''deactivated''', v_target)) = 1, 'the status itself is still visible in the directory';

  -- The record: administrators read it, nobody else does.
  assert test.count_as(v_admin, format('select count(*) from public.member_deactivations where member_id = %L and reason = ''Harassment complaint #4'' and deactivated_by = %L and deactivated_at is not null', v_target, v_admin)) = 1, 'an administrator reads the reason, actor and time';
  assert test.count_as(v_member, 'select count(*) from public.member_deactivations') = 0, 'a plain member sees no record';
  assert test.count_as(v_leader, 'select count(*) from public.member_deactivations') = 0, 'a group leader sees no record';
  assert test.count_as(v_exec, 'select count(*) from public.member_deactivations') = 0, 'an executive sees no record';
  assert test.count_as(v_target, 'select count(*) from public.member_deactivations') = 0, 'the deactivated person sees no record, not even their own';
  message := test.error_as(null, 'select count(*) from public.member_deactivations');
  assert message like 'permission denied%', 'anon has no access: ' || coalesce(message, 'no error');

  -- Nobody writes the table directly, administrators included.
  message := test.error_as(v_admin, format('update public.member_deactivations set reason = ''x'' where member_id = %L', v_target));
  assert message like 'permission denied%', 'no direct update: ' || coalesce(message, 'no error');
  message := test.error_as(v_admin, format('insert into public.member_deactivations (member_id) values (%L)', v_member));
  assert message like 'permission denied%', 'no direct insert';
  message := test.error_as(v_admin, 'delete from public.member_deactivations');
  assert message like 'permission denied%', 'no direct delete';

  -- The audit log still holds the reason, for administrators.
  assert test.count_as(v_admin, format('select count(*) from public.admin_audit_log where target_id = %L and action = ''member_deactivated'' and details ->> ''reason'' = ''Harassment complaint #4''', v_target)) = 1;
  assert test.count_as(v_member, 'select count(*) from public.admin_audit_log') = 0, 'members cannot read the audit log';

  -- Deactivating again replaces nothing (it is refused); reactivating clears the record.
  message := test.error_as(v_admin, format('select public.admin_deactivate_member(%L, ''again'')', v_target));
  assert message like 'This member is already deactivated%';
  perform test.login(v_admin);
  perform public.admin_reactivate_member(v_target);
  perform test.logout();
  assert test.count_as(v_admin, 'select count(*) from public.member_deactivations') = 0, 'reactivating clears the record';
  perform test.login(v_admin);
  perform public.admin_deactivate_member(v_target, '  Second time  ');
  perform test.logout();
  assert test.count_as(v_admin, format('select count(*) from public.member_deactivations where member_id = %L and reason = ''Second time''', v_target)) = 1, 'the reason is trimmed and a new record is written';

  -- The reason is capped at 500 characters.
  perform test.login(v_admin);
  perform public.admin_reactivate_member(v_target);
  perform public.admin_deactivate_member(v_target, repeat('x', 900));
  perform test.logout();
  assert (select char_length(d.reason) from public.member_deactivations d where d.member_id = v_target) = 500;
end $$;
rollback;
