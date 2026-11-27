-- frontend-11: permanent delete of a resource (row and stored file) is for
-- executives. Managers can still discard unfinished uploads.
begin;
do $$
declare
  v_exec uuid := test.make_user('Exec Twelve', 'executive');
  v_manager uuid := test.make_user('Manager Twelve');
  v_leader uuid := test.make_user('Leader Twelve');
  v_member uuid := test.make_user('Member Twelve');
  v_other_manager uuid := test.make_user('Other Manager Twelve');
  v_group bigint;
  v_other_group bigint;
  v_ready bigint;
  v_archived bigint;
  v_failed bigint;
  v_pending bigint;
  v_other_failed bigint;
  v_club bigint;
  v_exec_only bigint;
  v_folder bigint;
  n bigint;
begin
  perform test.login(v_exec);
  select id into v_group from public.create_subgroup('Twelve Ensemble', '', 'open');
  select id into v_other_group from public.create_subgroup('Twelve Other', '', 'open');
  perform public.add_subgroup_member(v_group, v_manager);
  perform public.add_subgroup_member(v_group, v_leader);
  perform public.add_subgroup_member(v_group, v_member);
  perform public.add_subgroup_member(v_other_group, v_other_manager);
  perform public.set_subgroup_member_role(v_group, v_manager, 'manager');
  perform public.set_subgroup_member_role(v_group, v_leader, 'leader');
  perform public.set_subgroup_member_role(v_other_group, v_other_manager, 'manager');
  perform test.logout();

  -- Rows and their stored files, created as the people who would create them.
  insert into public.resources (node_kind, media_kind, title, subgroup_id, visibility, status, storage_bucket, storage_path, created_by)
  values ('file', 'document', 'Ready file', v_group, 'members', 'ready', 'club-resources', 'twelve/ready.pdf', v_manager) returning id into v_ready;
  insert into public.resources (node_kind, media_kind, title, subgroup_id, visibility, status, storage_bucket, storage_path, created_by)
  values ('file', 'document', 'Archived file', v_group, 'members', 'archived', 'club-resources', 'twelve/archived.pdf', v_manager) returning id into v_archived;
  insert into public.resources (node_kind, media_kind, title, subgroup_id, visibility, status, storage_bucket, storage_path, created_by)
  values ('file', 'document', 'Failed upload', v_group, 'members', 'failed', 'club-resources', 'twelve/failed.pdf', v_manager) returning id into v_failed;
  insert into public.resources (node_kind, media_kind, title, subgroup_id, visibility, status, storage_bucket, storage_path, created_by)
  values ('file', 'document', 'Pending upload', v_group, 'members', 'pending_upload', 'club-resources', 'twelve/pending.pdf', v_leader) returning id into v_pending;
  insert into public.resources (node_kind, media_kind, title, subgroup_id, visibility, status, storage_bucket, storage_path, created_by)
  values ('file', 'document', 'Failed in another group', v_other_group, 'members', 'failed', 'club-resources', 'twelve/other-failed.pdf', v_other_manager) returning id into v_other_failed;
  insert into public.resources (node_kind, media_kind, title, visibility, status, storage_bucket, storage_path, created_by)
  values ('file', 'document', 'Club-wide failed upload', 'members', 'failed', 'club-resources', 'twelve/club.pdf', v_exec) returning id into v_club;
  insert into public.resources (node_kind, title, subgroup_id, visibility, status, created_by)
  values ('folder', 'Empty folder', v_group, 'members', 'ready', v_manager) returning id into v_folder;
  insert into storage.objects (bucket_id, name, owner_id)
  select 'club-resources', p, null from unnest(array['twelve/ready.pdf', 'twelve/archived.pdf', 'twelve/failed.pdf', 'twelve/pending.pdf', 'twelve/other-failed.pdf', 'twelve/club.pdf']) p;

  -- Managers and leaders cannot delete finished items, row or file.
  assert test.count_as(v_manager, format('with d as (delete from public.resources where id = %s returning 1) select count(*) from d', v_ready)) = 0, 'manager cannot delete a ready file row';
  assert test.count_as(v_leader, format('with d as (delete from public.resources where id = %s returning 1) select count(*) from d', v_ready)) = 0, 'leader cannot delete a ready file row';
  assert test.count_as(v_manager, format('with d as (delete from public.resources where id = %s returning 1) select count(*) from d', v_archived)) = 0, 'manager cannot delete an archived file row';
  assert test.count_as(v_manager, format('with d as (delete from public.resources where id = %s returning 1) select count(*) from d', v_folder)) = 0, 'manager cannot delete an empty folder';
  assert test.count_as(v_manager, 'with d as (delete from storage.objects where bucket_id = ''club-resources'' and name = ''twelve/ready.pdf'' returning 1) select count(*) from d') = 0, 'manager cannot delete a ready file object';
  assert test.count_as(v_manager, 'with d as (delete from storage.objects where bucket_id = ''club-resources'' and name = ''twelve/archived.pdf'' returning 1) select count(*) from d') = 0, 'nor an archived file object';
  assert test.count_as(v_member, format('with d as (delete from public.resources where id = %s returning 1) select count(*) from d', v_ready)) = 0, 'a plain member cannot';
  assert (select count(*) from public.resources where id in (v_ready, v_archived, v_folder)) = 3, 'nothing was deleted';
  assert (select count(*) from storage.objects where name in ('twelve/ready.pdf', 'twelve/archived.pdf')) = 2, 'no file was deleted';

  -- They can discard unfinished uploads in a group they manage: file, then row.
  assert test.count_as(v_manager, 'with d as (delete from storage.objects where bucket_id = ''club-resources'' and name = ''twelve/failed.pdf'' returning 1) select count(*) from d') = 1, 'manager removes the file of a failed upload';
  assert test.count_as(v_manager, format('with d as (delete from public.resources where id = %s returning 1) select count(*) from d', v_failed)) = 1, 'then its row';
  assert test.count_as(v_manager, 'with d as (delete from storage.objects where bucket_id = ''club-resources'' and name = ''twelve/pending.pdf'' returning 1) select count(*) from d') = 1, 'manager removes the file of a leader''s pending upload';
  assert test.count_as(v_leader, format('with d as (delete from public.resources where id = %s returning 1) select count(*) from d', v_pending)) = 1, 'a leader discards their own pending upload';
  -- Not in another group, not club-wide, not as a plain member.
  assert test.count_as(v_manager, format('with d as (delete from public.resources where id = %s returning 1) select count(*) from d', v_other_failed)) = 0, 'a manager of another group cannot';
  assert test.count_as(v_manager, format('with d as (delete from public.resources where id = %s returning 1) select count(*) from d', v_club)) = 0, 'nor club-wide uploads';
  assert test.count_as(v_member, format('with d as (delete from public.resources where id = %s returning 1) select count(*) from d', v_other_failed)) = 0;

  -- Executives delete anything: file first, then row.
  assert test.count_as(v_exec, 'with d as (delete from storage.objects where bucket_id = ''club-resources'' and name = ''twelve/ready.pdf'' returning 1) select count(*) from d') = 1, 'executive deletes a ready file object';
  assert test.count_as(v_exec, format('with d as (delete from public.resources where id = %s returning 1) select count(*) from d', v_ready)) = 1, 'and its row';
  assert test.count_as(v_exec, 'with d as (delete from storage.objects where bucket_id = ''club-resources'' and name = ''twelve/archived.pdf'' returning 1) select count(*) from d') = 1;
  assert test.count_as(v_exec, format('with d as (delete from public.resources where id = %s returning 1) select count(*) from d', v_archived)) = 1, 'an archived file';
  assert test.count_as(v_exec, format('with d as (delete from public.resources where id = %s returning 1) select count(*) from d', v_folder)) = 1, 'an empty folder';
  assert test.count_as(v_exec, format('with d as (delete from public.resources where id = %s returning 1) select count(*) from d', v_club)) = 1, 'a club-wide unfinished upload';

  -- A folder with contents still cannot be deleted, even by an executive.
  insert into public.resources (node_kind, title, visibility, status, created_by) values ('folder', 'Parent', 'members', 'ready', v_exec) returning id into v_exec_only;
  insert into public.resources (node_kind, title, parent_id, visibility, status, external_url, created_by) values ('link', 'Child', v_exec_only, 'members', 'ready', 'https://example.org/a', v_exec);
  assert test.error_as(v_exec, format('delete from public.resources where id = %s', v_exec_only)) is not null, 'a folder with contents is protected by the foreign key';
end $$;
rollback;
