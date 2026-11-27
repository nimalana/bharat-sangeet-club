-- Round 2 of frontend-11: a manager must not be able to turn a finished
-- resource into an "unfinished upload" and so delete it. The checker's replay:
--   update resources set status = 'failed' where id = <ready file>   (succeeded)
--   delete from storage.objects ... that file                         (1 row)
--   delete from resources ...                                         (1 row)
begin;
do $$
declare
  v_exec uuid := test.make_user('Exec Guard', 'executive');
  v_manager uuid := test.make_user('Manager Guard');
  v_leader uuid := test.make_user('Leader Guard');
  v_member uuid := test.make_user('Member Guard');
  v_other_manager uuid := test.make_user('Other Manager Guard');
  v_group bigint;
  v_other_group bigint;
  v_ready bigint;
  v_archived bigint;
  v_ready2 bigint;
  v_pending bigint;
  v_pending2 bigint;
  v_decoy bigint;
  v_slot bigint;
  v_link bigint;
  v_status text;
  message text;
  n bigint;
begin
  perform test.login(v_exec);
  select id into v_group from public.create_subgroup('Guard Ensemble', '', 'open');
  select id into v_other_group from public.create_subgroup('Guard Other', '', 'open');
  perform public.add_subgroup_member(v_group, v_manager);
  perform public.add_subgroup_member(v_group, v_leader);
  perform public.add_subgroup_member(v_group, v_member);
  perform public.add_subgroup_member(v_other_group, v_other_manager);
  perform public.set_subgroup_member_role(v_group, v_manager, 'manager');
  perform public.set_subgroup_member_role(v_group, v_leader, 'leader');
  perform public.set_subgroup_member_role(v_other_group, v_other_manager, 'manager');
  perform test.logout();

  insert into public.resources (node_kind, media_kind, title, subgroup_id, visibility, status, storage_bucket, storage_path, created_by)
  values ('file', 'document', 'Ready file', v_group, 'members', 'ready', 'club-resources', 'guard/ready.pdf', v_manager) returning id into v_ready;
  insert into public.resources (node_kind, media_kind, title, subgroup_id, visibility, status, storage_bucket, storage_path, created_by)
  values ('file', 'document', 'Archived file', v_group, 'members', 'archived', 'club-resources', 'guard/archived.pdf', v_manager) returning id into v_archived;
  insert into public.resources (node_kind, media_kind, title, subgroup_id, visibility, status, storage_bucket, storage_path, created_by)
  values ('file', 'document', 'Second ready file', v_group, 'members', 'ready', 'club-resources', 'guard/ready2.pdf', v_manager) returning id into v_ready2;
  insert into public.resources (node_kind, media_kind, title, subgroup_id, visibility, status, storage_bucket, storage_path, created_by)
  values ('file', 'document', 'Pending upload', v_group, 'members', 'pending_upload', 'club-resources', 'guard/pending.pdf', v_leader) returning id into v_pending;
  insert into public.resources (node_kind, media_kind, title, subgroup_id, visibility, status, storage_bucket, storage_path, created_by)
  values ('file', 'document', 'Second pending upload', v_group, 'members', 'pending_upload', 'club-resources', 'guard/pending2.pdf', v_manager) returning id into v_pending2;
  insert into public.resources (node_kind, media_kind, title, subgroup_id, visibility, status, storage_bucket, storage_path, created_by)
  values ('file', 'document', 'Empty slot', v_group, 'members', 'pending_upload', 'club-resources', 'guard/slot.pdf', v_manager) returning id into v_slot;
  insert into public.resources (node_kind, title, subgroup_id, visibility, status, external_url, created_by)
  values ('link', 'A link', v_group, 'members', 'ready', 'https://example.org/guard', v_manager) returning id into v_link;
  insert into storage.objects (bucket_id, name, owner_id)
  select 'club-resources', p, null from unnest(array['guard/ready.pdf', 'guard/archived.pdf', 'guard/ready2.pdf', 'guard/pending.pdf', 'guard/pending2.pdf']) p;

  -- ---------------------------------------------------------------------
  -- 1. The replay: flipping a finished row to an unfinished status is refused,
  --    so neither the file nor the row can then be deleted.
  -- ---------------------------------------------------------------------
  message := test.error_as(v_manager, format('update public.resources set status = ''failed'' where id = %s', v_ready));
  assert message like 'Only executives can mark a finished resource%', 'a manager cannot fail a ready file: ' || coalesce(message, 'no error');
  message := test.error_as(v_manager, format('update public.resources set status = ''pending_upload'' where id = %s', v_ready));
  assert message like 'Only executives can mark a finished resource%', 'nor reopen it as a pending upload: ' || coalesce(message, 'no error');
  message := test.error_as(v_manager, format('update public.resources set status = ''failed'' where id = %s', v_archived));
  assert message like 'Only executives can mark a finished resource%', 'nor fail an archived file: ' || coalesce(message, 'no error');
  message := test.error_as(v_leader, format('update public.resources set status = ''failed'', title = ''x'' where id = %s', v_ready));
  assert message like 'Only executives can mark a finished resource%', 'a leader cannot either: ' || coalesce(message, 'no error');
  message := test.error_as(v_manager, format('update public.resources set status = ''failed'' where id = %s', v_link));
  assert message like 'Only executives can mark a finished resource%', 'nor a link: ' || coalesce(message, 'no error');
  assert (select status::text from public.resources where id = v_ready) = 'ready', 'the row is untouched';
  assert test.count_as(v_manager, 'with d as (delete from storage.objects where bucket_id = ''club-resources'' and name = ''guard/ready.pdf'' returning 1) select count(*) from d') = 0, 'so its file cannot be deleted';
  assert test.count_as(v_manager, format('with d as (delete from public.resources where id = %s returning 1) select count(*) from d', v_ready)) = 0, 'nor its row';

  -- ---------------------------------------------------------------------
  -- 2. Moving the file, or the row's idea of where the file is.
  -- ---------------------------------------------------------------------
  message := test.error_as(v_manager, format('update public.resources set storage_path = ''guard/elsewhere.pdf'' where id = %s', v_ready));
  assert message like 'Only executives can change where%', 'a manager cannot repoint a ready file: ' || coalesce(message, 'no error');
  message := test.error_as(v_manager, format('update public.resources set storage_bucket = ''club-archive'' where id = %s', v_ready));
  assert message like 'Only executives can change where%', 'nor change its bucket: ' || coalesce(message, 'no error');
  message := test.error_as(v_manager, format('update public.resources set storage_path = ''guard/elsewhere.pdf'' where id = %s', v_archived));
  assert message like 'Only executives can change where%', 'nor an archived file''s path: ' || coalesce(message, 'no error');
  -- The three-step version: give the ready row another path, register an unfinished
  -- row at the old one, then delete that "unfinished" file. The first step fails.
  assert (select storage_path from public.resources where id = v_ready) = 'guard/ready.pdf';
  -- Moving the stored object onto an unfinished row's path (what a Storage move does).
  assert test.count_as(v_manager, 'with u as (update storage.objects set name = ''guard/slot.pdf'' where bucket_id = ''club-resources'' and name = ''guard/ready2.pdf'' returning 1) select count(*) from u') = 0, 'a manager cannot move a finished file onto an unfinished row''s path';
  assert test.count_as(v_manager, 'with u as (update storage.objects set owner_id = ''x'' where bucket_id = ''club-resources'' and name = ''guard/ready2.pdf'' returning 1) select count(*) from u') = 0, 'nor change a finished file at all';
  assert (select count(*) from storage.objects where name in ('guard/ready.pdf', 'guard/ready2.pdf', 'guard/archived.pdf')) = 3, 'all three files are still there';

  -- ---------------------------------------------------------------------
  -- 3. What managers can still do.
  -- ---------------------------------------------------------------------
  -- An upload finishing, failing and being discarded.
  perform test.login(v_manager);
  update public.resources set status = 'ready' where id = v_pending2;
  perform test.logout();
  assert (select status::text from public.resources where id = v_pending2) = 'ready', 'a pending upload becomes ready';

  perform test.login(v_leader);
  update public.resources set status = 'failed' where id = v_pending;
  perform test.logout();
  assert (select status::text from public.resources where id = v_pending) = 'failed', 'an uploader fails their own pending upload';
  assert test.count_as(v_manager, 'with u as (update storage.objects set owner_id = ''x'' where bucket_id = ''club-resources'' and name = ''guard/pending.pdf'' returning 1) select count(*) from u') = 1, 'a manager may still touch an unfinished upload''s file';
  assert test.count_as(v_leader, 'with d as (delete from storage.objects where bucket_id = ''club-resources'' and name = ''guard/pending.pdf'' returning 1) select count(*) from d') = 1, 'discard the failed upload: file first';
  assert test.count_as(v_leader, format('with d as (delete from public.resources where id = %s returning 1) select count(*) from d', v_pending)) = 1, 'then its row';

  -- A failed upload can be retried.
  insert into public.resources (node_kind, media_kind, title, subgroup_id, visibility, status, storage_bucket, storage_path, created_by)
  values ('file', 'document', 'Retry', v_group, 'members', 'failed', 'club-resources', 'guard/retry.pdf', v_manager) returning id into v_decoy;
  perform test.login(v_manager);
  update public.resources set status = 'pending_upload' where id = v_decoy;
  update public.resources set status = 'ready', updated_at = now() where id = v_decoy;
  perform test.logout();
  assert (select status::text from public.resources where id = v_decoy) = 'ready', 'failed -> pending_upload -> ready';

  -- Archive and restore, directly and through the function; rename and pin.
  perform test.login(v_manager);
  update public.resources set status = 'archived' where id = v_ready;
  update public.resources set status = 'ready' where id = v_ready;
  perform public.set_resource_archived(v_ready2, true);
  perform test.logout();
  assert (select status::text from public.resources where id = v_ready2) = 'archived', 'set_resource_archived still archives';
  perform test.login(v_manager);
  perform public.set_resource_archived(v_ready2, false);
  update public.resources set title = 'Renamed', description = 'Notes', is_pinned = true where id = v_ready;
  perform test.logout();
  assert (select status::text from public.resources where id = v_ready2) = 'ready', 'and restores';
  assert (select title from public.resources where id = v_ready) = 'Renamed' and (select is_pinned from public.resources where id = v_ready), 'rename and pin work';
  -- Writing a status or a path to the value it already has is harmless.
  perform test.login(v_manager);
  update public.resources set status = 'ready', storage_path = 'guard/ready.pdf' where id = v_ready;
  perform test.logout();

  -- ---------------------------------------------------------------------
  -- 4. Others: a plain member and a manager of another group change nothing.
  -- ---------------------------------------------------------------------
  assert test.count_as(v_member, format('with u as (update public.resources set title = ''x'' where id = %s returning 1) select count(*) from u', v_ready)) = 0, 'a plain member updates nothing';
  assert test.count_as(v_other_manager, format('with u as (update public.resources set status = ''failed'' where id = %s returning 1) select count(*) from u', v_ready)) = 0, 'nor does a manager of another group';

  -- ---------------------------------------------------------------------
  -- 5. Executives (and callers with no signed-in user) are not limited.
  -- ---------------------------------------------------------------------
  assert test.count_as(v_exec, 'with u as (update storage.objects set name = ''guard/slot.pdf'' where bucket_id = ''club-resources'' and name = ''guard/ready2.pdf'' returning 1) select count(*) from u') = 1, 'an executive may move a finished file';
  perform test.login(v_exec);
  update public.resources set status = 'failed' where id = v_ready2;
  update public.resources set storage_path = 'guard/ready2-renamed.pdf' where id = v_ready2;
  perform test.logout();
  assert (select status::text from public.resources where id = v_ready2) = 'failed', 'an executive may set any status';
  assert (select storage_path from public.resources where id = v_ready2) = 'guard/ready2-renamed.pdf', 'and a path';
  update public.resources set status = 'archived' where id = v_ready2;   -- no signed-in user (as a migration or the service role)
  assert (select status::text from public.resources where id = v_ready2) = 'archived';

  -- Executives still delete finished items, file then row (unchanged).
  assert test.count_as(v_exec, 'with d as (delete from storage.objects where bucket_id = ''club-resources'' and name = ''guard/ready.pdf'' returning 1) select count(*) from d') = 1, 'an executive deletes a ready file';
  assert test.count_as(v_exec, format('with d as (delete from public.resources where id = %s returning 1) select count(*) from d', v_ready)) = 1, 'and its row';
end $$;
rollback;
