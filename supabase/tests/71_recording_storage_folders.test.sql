-- Abandoned uploads in the recordings buckets can be deleted by whoever uploaded
-- them, through the statement the Storage service issues:
--     delete from storage.objects where bucket_id = X and name = any(...)
-- under the caller's role and claims. That statement needs SELECT visibility of
-- the object as well as a DELETE policy, so an object nobody has registered (the
-- row insert failed, or the page was closed) could not be removed.
--
-- The objects below are inserted with owner_id null: the policy must not depend
-- on the owner column, which Storage does not reliably fill in.
begin;
do $$
declare
  v_exec uuid := test.make_user('Exec Folders', 'executive');
  v_owner uuid := test.make_user('Owner Folders');
  v_other uuid := test.make_user('Other Folders');
  v_outsider uuid := test.make_user('Outsider Folders');
  v_group bigint;
  v_recording bigint;
  v_take text;
  v_lost_take text;
  v_lost_notation text;
  v_note_by_other text;
  v_exec_archive text;
  v_other_lost text;
  v_own_registered_note text;
  n bigint;
begin
  perform test.login(v_exec);
  select id into v_group from public.create_subgroup('Folders Ensemble', '', 'open');
  perform public.add_subgroup_member(v_group, v_owner);
  perform public.add_subgroup_member(v_group, v_other);
  perform test.logout();

  v_take := v_owner || '/subgroups/' || v_group || '/registered-take.webm';
  v_lost_take := v_owner || '/subgroups/' || v_group || '/abandoned-take.webm';
  v_lost_notation := v_owner || '/abandoned-notation.pdf';
  v_note_by_other := v_other || '/notation-on-owner-take.pdf';
  v_own_registered_note := v_owner || '/own-note.pdf';
  v_other_lost := v_other || '/subgroups/' || v_group || '/other-abandoned.webm';
  v_exec_archive := v_exec || '/abandoned-archive.mp3';

  insert into public.recordings (title, subgroup_id, uploaded_by, storage_path, status, audience)
  values ('Owner take', v_group, v_owner, v_take, 'published', 'subgroup') returning id into v_recording;
  insert into public.recording_notes (recording_id, title, note_type, storage_path, uploaded_by)
  values (v_recording, 'By other', 'file', v_note_by_other, v_other),
         (v_recording, 'By owner', 'file', v_own_registered_note, v_owner);

  insert into storage.objects (bucket_id, name, owner_id) values
    ('recordings', v_take, null),
    ('recordings', v_lost_take, null),
    ('recordings', v_other_lost, null),
    ('recordings', 'loose-at-root.webm', null),
    ('recording-notations', v_lost_notation, null),
    ('recording-notations', v_note_by_other, null),
    ('recording-notations', v_own_registered_note, null),
    ('club-archive', v_exec_archive, null),
    ('club-resources', v_owner || '/not-a-recording-bucket.pdf', null),
    ('finance-private', v_owner || '/receipt.pdf', null);

  -- ---------------------------------------------------------------------
  -- Reading: only your own user-id folder, only in these three buckets.
  -- ---------------------------------------------------------------------
  assert test.count_as(v_owner, format('select count(*) from storage.objects where bucket_id = ''recordings'' and name = %L', v_lost_take)) = 1, 'the uploader can see their abandoned take';
  assert test.count_as(v_owner, format('select count(*) from storage.objects where bucket_id = ''recording-notations'' and name = %L', v_lost_notation)) = 1, 'and their abandoned notation';
  assert test.count_as(v_other, format('select count(*) from storage.objects where bucket_id = ''recordings'' and name = %L', v_lost_take)) = 0, 'another member cannot see it';
  assert test.count_as(v_exec, format('select count(*) from storage.objects where bucket_id = ''recordings'' and name = %L', v_lost_take)) = 0, 'nor can an executive: nothing registers it';
  assert test.count_as(v_owner, format('select count(*) from storage.objects where bucket_id = ''recordings'' and name = %L', v_other_lost)) = 0, 'the uploader cannot see another member''s abandoned take';
  assert test.count_as(v_owner, 'select count(*) from storage.objects where bucket_id = ''recordings'' and name = ''loose-at-root.webm''') = 0, 'a file outside any user folder is not readable';
  assert test.count_as(v_owner, format('select count(*) from storage.objects where bucket_id = ''club-resources'' and name = %L', v_owner || '/not-a-recording-bucket.pdf')) = 0, 'the own-folder rule is not extended to other buckets';
  -- finance-private has its own rule (20261127050200): a member reads their own UNREGISTERED files so Storage can delete them; nobody else's.
  assert test.count_as(v_owner, format('select count(*) from storage.objects where bucket_id = ''finance-private'' and name = %L', v_owner || '/receipt.pdf')) = 1, 'finance keeps its own rule: the owner reads their own unregistered file';
  assert test.count_as(v_outsider, format('select count(*) from storage.objects where bucket_id = ''finance-private'' and name = %L', v_owner || '/receipt.pdf')) = 0, 'and nobody else can';
  assert test.count_as(v_exec, format('select count(*) from storage.objects where bucket_id = ''club-archive'' and name = %L', v_exec_archive)) = 1, 'an executive sees their abandoned archive upload';
  assert test.count_as(v_owner, format('select count(*) from storage.objects where bucket_id = ''club-archive'' and name = %L', v_exec_archive)) = 0, 'a member does not';

  -- ---------------------------------------------------------------------
  -- Deleting an abandoned take: the owner only.
  -- ---------------------------------------------------------------------
  assert test.count_as(v_other, format('with d as (delete from storage.objects where bucket_id = ''recordings'' and name = any(array[%L]) returning 1) select count(*) from d', v_lost_take)) = 0, 'another member cannot delete the abandoned take';
  assert test.count_as(v_exec, format('with d as (delete from storage.objects where bucket_id = ''recordings'' and name = any(array[%L]) returning 1) select count(*) from d', v_lost_take)) = 0, 'nor an executive';
  assert test.count_as(v_outsider, format('with d as (delete from storage.objects where bucket_id = ''recordings'' and name = any(array[%L]) returning 1) select count(*) from d', v_lost_take)) = 0, 'nor someone outside the group';
  assert test.count_as(null, format('with d as (delete from storage.objects where bucket_id = ''recordings'' and name = any(array[%L]) returning 1) select count(*) from d', v_lost_take)) = 0, 'nor a visitor';
  assert (select count(*) from storage.objects where bucket_id = 'recordings' and name = v_lost_take) = 1, 'it is still there';
  -- A batch with something the caller may not delete removes only their own.
  assert test.count_as(v_owner, format('with d as (delete from storage.objects where bucket_id = ''recordings'' and name = any(array[%L, %L, %L]) returning 1) select count(*) from d', v_lost_take, v_other_lost, 'loose-at-root.webm')) = 1, 'the owner deletes the abandoned take (and only that)';
  assert (select count(*) from storage.objects where bucket_id = 'recordings' and name in (v_other_lost, 'loose-at-root.webm')) = 2, 'the others are untouched';
  assert (select count(*) from storage.objects where bucket_id = 'recordings' and name = v_lost_take) = 0, 'it is gone';

  -- Registered takes keep their rules: the uploader or an executive.
  assert test.count_as(v_other, format('with d as (delete from storage.objects where bucket_id = ''recordings'' and name = any(array[%L]) returning 1) select count(*) from d', v_take)) = 0, 'a group member cannot delete a registered take';
  assert test.count_as(v_owner, format('with d as (delete from storage.objects where bucket_id = ''recordings'' and name = any(array[%L]) returning 1) select count(*) from d', v_take)) = 1, 'the uploader deletes their registered take, as before';

  -- ---------------------------------------------------------------------
  -- The same for notation files.
  -- ---------------------------------------------------------------------
  assert test.count_as(v_other, format('with d as (delete from storage.objects where bucket_id = ''recording-notations'' and name = any(array[%L]) returning 1) select count(*) from d', v_lost_notation)) = 0, 'another member cannot delete an abandoned notation file';
  assert test.count_as(v_exec, format('with d as (delete from storage.objects where bucket_id = ''recording-notations'' and name = any(array[%L]) returning 1) select count(*) from d', v_lost_notation)) = 0, 'nor an executive';
  assert test.count_as(v_owner, format('with d as (delete from storage.objects where bucket_id = ''recording-notations'' and name = any(array[%L]) returning 1) select count(*) from d', v_lost_notation)) = 1, 'the uploader deletes their abandoned notation file';
  -- A notation file that a note registers: the author, the recording's uploader
  -- (20261127044000) and executives, nobody else.
  assert test.count_as(v_outsider, format('with d as (delete from storage.objects where bucket_id = ''recording-notations'' and name = any(array[%L]) returning 1) select count(*) from d', v_note_by_other)) = 0, 'an outsider cannot delete a registered note file';
  assert test.count_as(v_owner, format('with d as (delete from storage.objects where bucket_id = ''recording-notations'' and name = any(array[%L]) returning 1) select count(*) from d', v_note_by_other)) = 1, 'the recording''s uploader deletes notation attached to it (unchanged)';
  assert test.count_as(v_exec, format('with d as (delete from storage.objects where bucket_id = ''recording-notations'' and name = any(array[%L]) returning 1) select count(*) from d', v_own_registered_note)) = 1, 'an executive deletes a registered note file (unchanged)';

  -- ---------------------------------------------------------------------
  -- Executives' abandoned archive uploads (club-archive).
  -- ---------------------------------------------------------------------
  assert test.count_as(v_owner, format('with d as (delete from storage.objects where bucket_id = ''club-archive'' and name = any(array[%L]) returning 1) select count(*) from d', v_exec_archive)) = 0, 'a member cannot delete it';
  assert test.count_as(v_exec, format('with d as (delete from storage.objects where bucket_id = ''club-archive'' and name = any(array[%L]) returning 1) select count(*) from d', v_exec_archive)) = 1, 'the executive removes their abandoned archive upload';

  -- ---------------------------------------------------------------------
  -- Not widened: other buckets still follow their own rules.
  -- ---------------------------------------------------------------------
  assert test.count_as(v_owner, format('with d as (delete from storage.objects where bucket_id = ''club-resources'' and name = any(array[%L]) returning 1) select count(*) from d', v_owner || '/not-a-recording-bucket.pdf')) = 0, 'club-resources is not covered by the own-folder rule';
  assert (select count(*) from storage.objects where bucket_id = 'club-resources') = 1;
end $$;
rollback;
