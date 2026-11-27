-- A file uploaded and then abandoned could not be deleted through Storage.
--
-- The recording room uploads the take (bucket recordings) and any notation file
-- (recording-notations) under the member's own user-id folder first, and only then
-- writes the database row that registers them. When that row fails, or the member
-- closes the page, the file stays, and the portal's clean-up call
-- (storage.from(bucket).remove([path])) is refused. The exec archive form
-- (club-archive) does the same.
--
-- Why it is refused: Storage deletes with
--     delete from storage.objects where bucket_id = $1 and name = any($2)
-- and PostgreSQL applies the SELECT policies to that statement as well as the
-- DELETE policies. An object nobody has registered is visible to no read policy
-- that needs a registered row ("Members read accessible recordings",
-- "...notation", "Members read permitted archive files"), so the statement finds
-- zero rows before the delete policy is even asked. The delete policies for these
-- buckets also required a registered row. (The older policy "Uploaders read own
-- recording objects" keys on storage.objects.owner_id, which Storage does not
-- reliably fill in, so it could not be relied on.)
--
-- Fix, the same shape the finance bucket got in 20261127000000:
--   * read: a signed-in person may read objects under their own user-id folder in
--     these three buckets, and nothing else;
--   * delete: a signed-in person may delete an object under their own folder that
--     no recording or note has registered. Registered files keep the rules they
--     had: the recording's uploader or an executive; for notation also the note's
--     author (20261127044000).
-- Executives still delete the files of any registered recording and note, and any
-- object in club-archive ("Executives delete archive files", unchanged).
-- Nobody else can read, so nobody else can delete, another person's abandoned file.
-- Finance and attendance buckets are not touched here.

drop policy if exists "Uploaders read objects in their own folder" on storage.objects;
create policy "Uploaders read objects in their own folder"
on storage.objects for select to authenticated
using (
  bucket_id in ('recordings', 'recording-notations', 'club-archive')
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists "Members delete their recording files" on storage.objects;
create policy "Members delete their recording files"
on storage.objects for delete to authenticated
using (
  bucket_id = 'recordings'
  and (
    exists (
      select 1 from public.recordings recording
      where recording.storage_path = objects.name
        and ((select private.is_executive()) or recording.uploaded_by = (select auth.uid()))
    )
    or (
      (storage.foldername(name))[1] = (select auth.uid())::text
      and not exists (select 1 from public.recordings recording where recording.storage_path = objects.name)
    )
  )
);

drop policy if exists "Members delete their recording notation" on storage.objects;
create policy "Members delete their recording notation"
on storage.objects for delete to authenticated
using (
  bucket_id = 'recording-notations'
  and (
    exists (
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
    or (
      (storage.foldername(name))[1] = (select auth.uid())::text
      and not exists (select 1 from public.recording_notes note where note.storage_path = objects.name)
    )
  )
);
