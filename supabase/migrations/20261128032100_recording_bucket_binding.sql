-- Second security review, finding F2 (P2): the own-folder rule of a recording could be skipped by naming another bucket.
--
-- RELEASE ORDER: apply BEFORE the new frontend (section 1 of docs/RELEASE_ORDER.md). The portal never writes
-- recordings.storage_bucket (lib/api/recordings.ts inserts and updates leave it at its default 'recordings'; it only
-- reads the column to open a legacy copy), so no screen of any version meets the new refusal.
--
-- The defect. bind_recording_file_to_uploader() (20261128030000) bound a recording's storage_path to its uploader's own
-- folder only when storage_bucket = 'recordings'; a row that named 'club-archive' (the check constraint allows it, and the
-- insert policy lets any member set it) was let through as "a legacy copy". The three storage policies that decide who
-- may read, rewrite and delete a recording file ("Members read accessible recordings", "Members update their recording
-- files", "Members delete their recording files") match `recording.storage_path = objects.name` and never compare the
-- row's bucket with the object's bucket. So a member of group B could register a row (group B, bucket 'club-archive',
-- path '<member of A>/subgroups/<A>/take.webm') and then read, overwrite and delete that member's unregistered object in
-- the bucket `recordings`.
--
-- Two layers, either one closes the hole:
--   (1) the trigger no longer has an exemption by bucket. A write by a signed-in person (auth.uid() is not null) that
--       sets or changes a recording's path, bucket or uploader must name the bucket 'recordings' and a path in the
--       uploader's own folder. Nothing signed-in writes another bucket today (checked: the frontend, and no function
--       writes public.recordings), so the exemption is removed, not narrowed to executives. The legacy copy ran in a
--       migration (auth.uid() is null, still exempt by the first line of the function) and a later edit of a legacy
--       row that does not touch path, bucket or uploader (a new title, publishing it) is not "a change" for the rule.
--   (2) the three policies compare `recording.storage_bucket = objects.bucket_id`, so a row only vouches for an object
--       in the bucket it names, also for rows that exist already. The unregistered-file test of the delete policy
--       is bucket-aware too, so a legacy row that happens to share a name does not hide a person's own abandoned file.
--       The two notation policies have no such gap: recording_notes has no bucket column and both policies fix the bucket
--       to 'recording-notations'.
--
-- Rows that exist already: a legacy copy (bucket club-archive, uploaded by an executive of old) keeps reading exactly as
-- before, because its file is served by the club-archive policies through its archive_items row, never by the recording
-- policies (they only ever matched objects in the bucket `recordings`). A row planted by the attack above stays in the
-- table but vouches for nothing. supabase/tests/78_recording_bucket_binding.test.sql covers both.
--
-- Safe to run twice (create or replace, drop policy if exists).

create or replace function private.bind_recording_file_to_uploader()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_path text;
  v_changed boolean;
begin
  -- The migration role, the service role and definer maintenance have no signed-in user (the legacy copy of archive
  -- items into recordings ran this way).
  if (select auth.uid()) is null then return new; end if;

  if tg_table_name = 'recordings' then
    v_path := new.storage_path;
    v_changed := tg_op = 'INSERT'
      or new.storage_path is distinct from old.storage_path
      or new.storage_bucket is distinct from old.storage_bucket
      or new.uploaded_by is distinct from old.uploaded_by;
    -- No bucket exemption: whoever is signed in registers a take in the bucket `recordings`, from their own folder.
    if v_changed and new.storage_bucket is distinct from 'recordings' then
      raise exception 'A recording file can only be registered in the recordings bucket' using errcode = '42501';
    end if;
  else
    v_path := new.storage_path;
    v_changed := tg_op = 'INSERT'
      or new.storage_path is distinct from old.storage_path
      or new.uploaded_by is distinct from old.uploaded_by;
    if v_path is null then return new; end if;
  end if;

  if v_changed and split_part(v_path, '/', 1) is distinct from new.uploaded_by::text then
    raise exception 'A file can only be registered from your own folder' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function private.bind_recording_file_to_uploader() from public, anon, authenticated;

-- (2) a recordings row vouches for an object in its own bucket only.
drop policy if exists "Members read accessible recordings" on storage.objects;
create policy "Members read accessible recordings"
on storage.objects for select to authenticated
using (
  bucket_id = 'recordings'
  and exists (
    select 1 from public.recordings recording
    where recording.storage_path = objects.name
      and recording.storage_bucket = objects.bucket_id
  )
);

drop policy if exists "Members update their recording files" on storage.objects;
create policy "Members update their recording files"
on storage.objects for update to authenticated
using (
  bucket_id = 'recordings'
  and exists (
    select 1 from public.recordings recording
    where recording.storage_path = objects.name
      and recording.storage_bucket = objects.bucket_id
      and ((select private.is_executive()) or recording.uploaded_by = (select auth.uid()))
  )
)
with check (bucket_id = 'recordings');

drop policy if exists "Members delete their recording files" on storage.objects;
create policy "Members delete their recording files"
on storage.objects for delete to authenticated
using (
  bucket_id = 'recordings'
  and (
    exists (
      select 1 from public.recordings recording
      where recording.storage_path = objects.name
        and recording.storage_bucket = objects.bucket_id
        and ((select private.is_executive()) or recording.uploaded_by = (select auth.uid()))
    )
    or (
      (storage.foldername(name))[1] = (select auth.uid())::text
      and not exists (
        select 1 from public.recordings recording
        where recording.storage_path = objects.name and recording.storage_bucket = objects.bucket_id
      )
    )
  )
);
