-- Resource library: visibility for a whole folder, archive and restore.
begin;
do $$
declare
  v_exec uuid := test.make_user('Exec Three', 'executive');
  v_manager uuid := test.make_user('Manager Three');
  v_member uuid := test.make_user('Member Three');
  v_group bigint;
  v_folder bigint;
  v_child bigint;
  v_link bigint;
  v_group_folder bigint;
  message text;
  n integer;
begin
  perform test.login(v_exec);
  select id into v_group from public.create_subgroup('Resource Ensemble', '', 'open');
  perform public.add_subgroup_member(v_group, v_manager);
  perform public.add_subgroup_member(v_group, v_member);
  perform public.set_subgroup_member_role(v_group, v_manager, 'manager');
  insert into public.resources (node_kind, title, visibility, status, created_by) values ('folder', 'Concert planning', 'members', 'ready', v_exec) returning id into v_folder;
  insert into public.resources (node_kind, title, parent_id, visibility, status, created_by) values ('folder', 'Budgets', v_folder, 'members', 'ready', v_exec) returning id into v_child;
  insert into public.resources (node_kind, title, parent_id, visibility, status, external_url, created_by) values ('link', 'Sheet', v_child, 'members', 'ready', 'https://example.org/sheet', v_exec) returning id into v_link;
  insert into public.resources (node_kind, title, subgroup_id, visibility, status, created_by) values ('folder', 'Group notes', v_group, 'members', 'ready', v_exec) returning id into v_group_folder;
  perform test.logout();

  assert test.count_as(v_member, 'select count(*) from public.resources') = 4, 'member sees everything shared';

  -- The row-by-row route is still refused.
  message := test.error_as(v_exec, format('update public.resources set visibility = ''executives'' where id = %s', v_folder));
  assert message like '%same subgroup scope and visibility%', 'direct folder change is refused: ' || coalesce(message, 'no error');

  -- Visibility: executives only, top level only, whole subtree.
  message := test.error_as(v_manager, format('select public.set_resource_visibility(%s, ''executives'')', v_group_folder));
  assert message like 'Only executives%', 'managers cannot change visibility';
  message := test.error_as(v_exec, format('select public.set_resource_visibility(%s, ''executives'')', v_child));
  assert message like 'Items inside a folder%', 'nested items are refused';
  perform test.login(v_exec);
  n := public.set_resource_visibility(v_folder, 'executives');
  perform test.logout();
  assert n = 3, 'folder, subfolder and link all change';
  assert (select count(*) from public.resources where id in (v_folder, v_child, v_link) and visibility = 'executives') = 3;
  assert test.count_as(v_member, 'select count(*) from public.resources') = 1, 'members no longer see the executive folder';

  -- The trigger is back on afterwards.
  message := test.error_as(v_exec, format('update public.resources set visibility = ''members'' where id = %s', v_link));
  assert message is not null, 'the hierarchy check still applies after the function ran';
  perform test.login(v_exec);
  perform public.set_resource_visibility(v_folder, 'members');
  perform test.logout();

  -- Archive: managers can archive in their own group, not club-wide items.
  message := test.error_as(v_member, format('select public.set_resource_archived(%s, true)', v_group_folder));
  assert message like 'You do not have permission%', 'plain members cannot archive';
  message := test.error_as(v_manager, format('select public.set_resource_archived(%s, true)', v_folder));
  assert message like 'You do not have permission%', 'group managers cannot archive club-wide resources';
  message := test.error_as(v_manager, format('select public.set_resource_archived(%s, true)', v_group_folder));
  assert message is null, 'group managers archive their group''s resources: ' || coalesce(message, '');
  assert test.count_as(v_member, format('select count(*) from public.resources where id = %s', v_group_folder)) = 0, 'archived items are hidden from members';

  perform test.login(v_exec);
  n := public.set_resource_archived(v_folder, true);
  perform test.logout();
  assert n = 3, 'archiving a folder archives its contents';
  message := test.error_as(v_exec, format('select public.set_resource_archived(%s, false)', v_link));
  assert message like 'Restore the folder%', 'an item cannot be restored into an archived folder: ' || coalesce(message, 'no error');
  perform test.login(v_exec);
  n := public.set_resource_archived(v_folder, false);
  perform test.logout();
  assert n = 3, 'restoring a folder restores its contents';
  assert test.count_as(v_member, format('select count(*) from public.resources where id = %s', v_link)) = 1;
end $$;
rollback;
