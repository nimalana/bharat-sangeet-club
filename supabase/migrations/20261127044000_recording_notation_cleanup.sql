-- frontend-3: a recording's uploader could not delete the recording once
-- someone else had attached a notation file to it.
--
-- Any member who can see a published recording may attach a notation note to it
-- (policy "Members add notation to accessible recordings"). Deleting a
-- recording removes its notation files from storage first, then the audio
-- file, then the row, because storage deletes are authorised by the row (plan
-- rule 0.2.6). The delete policies for notation files and notes only allowed
-- the note's own author or an executive, so the uploader hit a refusal on
-- the first file someone else had attached, with their own notation files
-- already deleted and nothing else removed.
--
-- The rule: whoever may delete a recording may also remove the notation attached
-- to it, since deleting the recording deletes all of it anyway (the notes cascade
-- with the row). So the files and notes of a recording can be deleted by:
--   * the person who wrote the note (unchanged),
--   * the recording's uploader, new,
--   * executives (unchanged).
-- Adding a note stays open to anyone who can see the recording, as before; an
-- uploader who does not want one removes it.
drop policy if exists "Members delete their recording notation" on storage.objects;
create policy "Members delete their recording notation"
on storage.objects for delete to authenticated
using (
  bucket_id = 'recording-notations'
  and exists (
    select 1 from public.recording_notes note
    where note.storage_path = objects.name
      and (
        (select private.is_executive())
        or note.uploaded_by = (select auth.uid())
        or exists (
          select 1 from public.recordings recording
          where recording.id = note.recording_id and recording.uploaded_by = (select auth.uid())
        )
      )
  )
);

drop policy if exists "Members delete their notation" on public.recording_notes;
create policy "Members delete their notation"
on public.recording_notes for delete to authenticated
using (
  (select private.is_executive())
  or uploaded_by = (select auth.uid())
  or exists (
    select 1 from public.recordings recording
    where recording.id = recording_notes.recording_id and recording.uploaded_by = (select auth.uid())
  )
);
