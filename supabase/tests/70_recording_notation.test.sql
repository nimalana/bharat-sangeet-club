-- frontend-3: the uploader of a recording can delete the notation other members
-- attached to it, so deleting their own recording is not blocked.
begin;
do $$
declare
  v_exec uuid := test.make_user('Exec Thirteen', 'executive');
  v_uploader uuid := test.make_user('Uploader Thirteen');
  v_author uuid := test.make_user('Author Thirteen');
  v_bystander uuid := test.make_user('Bystander Thirteen');
  v_group bigint;
  v_recording bigint;
  v_other_recording bigint;
  v_note bigint;
  v_own_note bigint;
  v_other_note bigint;
begin
  perform test.login(v_exec);
  select id into v_group from public.create_subgroup('Thirteen Ensemble', '', 'open');
  perform public.add_subgroup_member(v_group, v_uploader);
  perform public.add_subgroup_member(v_group, v_author);
  perform public.add_subgroup_member(v_group, v_bystander);
  perform test.logout();

  insert into public.recordings (title, subgroup_id, uploaded_by, storage_path, status, audience)
  values ('Take one', v_group, v_uploader, v_uploader || '/take-one.webm', 'published', 'subgroup') returning id into v_recording;
  insert into public.recordings (title, subgroup_id, uploaded_by, storage_path, status, audience)
  values ('Someone else''s take', v_group, v_author, v_author || '/take-two.webm', 'published', 'subgroup') returning id into v_other_recording;

  -- The author attaches a notation file to the uploader's recording (allowed),
  -- the uploader attaches one of their own, and the author has a note on their own recording.
  perform test.login(v_author);
  insert into public.recording_notes (recording_id, title, note_type, storage_path, uploaded_by)
  values (v_recording, 'Notation by author', 'file', v_author || '/notation.pdf', v_author) returning id into v_note;
  perform test.logout();
  perform test.login(v_uploader);
  insert into public.recording_notes (recording_id, title, note_type, storage_path, uploaded_by)
  values (v_recording, 'Notation by uploader', 'file', v_uploader || '/own.pdf', v_uploader) returning id into v_own_note;
  perform test.logout();
  perform test.login(v_author);
  insert into public.recording_notes (recording_id, title, note_type, storage_path, uploaded_by)
  values (v_other_recording, 'Notation on own take', 'file', v_author || '/mine.pdf', v_author) returning id into v_other_note;
  perform test.logout();
  insert into storage.objects (bucket_id, name, owner_id)
  values ('recording-notations', v_author || '/notation.pdf', v_author::text),
         ('recording-notations', v_uploader || '/own.pdf', v_uploader::text),
         ('recording-notations', v_author || '/mine.pdf', v_author::text),
         ('recordings', v_uploader || '/take-one.webm', v_uploader::text);

  -- Who may delete the notation files of the uploader's recording.
  assert test.count_as(v_bystander, format('with d as (delete from storage.objects where bucket_id = ''recording-notations'' and name = ''%s/notation.pdf'' returning 1) select count(*) from d', v_author)) = 0, 'a bystander cannot';
  assert test.count_as(v_uploader, format('with d as (delete from storage.objects where bucket_id = ''recording-notations'' and name = ''%s/mine.pdf'' returning 1) select count(*) from d', v_author)) = 0, 'the uploader cannot delete notation on someone else''s recording';
  assert test.count_as(v_uploader, format('with d as (delete from storage.objects where bucket_id = ''recording-notations'' and name = ''%s/notation.pdf'' returning 1) select count(*) from d', v_author)) = 1, 'the uploader deletes notation someone else attached to their recording';
  assert test.count_as(v_uploader, format('with d as (delete from storage.objects where bucket_id = ''recording-notations'' and name = ''%s/own.pdf'' returning 1) select count(*) from d', v_uploader)) = 1, 'and their own, as before';
  assert test.count_as(v_author, format('with d as (delete from storage.objects where bucket_id = ''recording-notations'' and name = ''%s/mine.pdf'' returning 1) select count(*) from d', v_author)) = 1, 'authors still delete their own notation';

  -- The notes: the same people may delete them.
  assert test.count_as(v_bystander, format('with d as (delete from public.recording_notes where id = %s returning 1) select count(*) from d', v_note)) = 0, 'a bystander cannot delete a note';
  assert test.count_as(v_uploader, format('with d as (delete from public.recording_notes where id = %s returning 1) select count(*) from d', v_other_note)) = 0, 'the uploader cannot delete notes on other recordings';
  assert test.count_as(v_uploader, format('with d as (delete from public.recording_notes where id = %s returning 1) select count(*) from d', v_note)) = 1, 'the uploader deletes a note attached to their recording';
  assert test.count_as(v_exec, format('with d as (delete from public.recording_notes where id = %s returning 1) select count(*) from d', v_own_note)) = 1, 'executives still can';

  -- What the portal does when the uploader deletes their recording: notation
  -- files first (as above), then the audio file, then the row.
  assert test.count_as(v_uploader, format('with d as (delete from storage.objects where bucket_id = ''recordings'' and name = ''%s/take-one.webm'' returning 1) select count(*) from d', v_uploader)) = 1, 'the uploader deletes the take';
  assert test.count_as(v_uploader, format('with d as (delete from public.recordings where id = %s returning 1) select count(*) from d', v_recording)) = 1, 'and the recording';
end $$;
rollback;
