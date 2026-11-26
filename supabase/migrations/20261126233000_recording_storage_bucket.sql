-- Recordings copied from the legacy archive kept their storage_path, but
-- their files still live in the club-archive bucket, while the workspace
-- signs every URL from the recordings bucket. Record which bucket holds each
-- file so the client can open the right one, and so shared files are never
-- deleted from under the legacy row.
alter table public.recordings
  add column if not exists storage_bucket text not null default 'recordings';

alter table public.recordings drop constraint if exists recordings_storage_bucket_check;
alter table public.recordings add constraint recordings_storage_bucket_check
  check (storage_bucket in ('recordings', 'club-archive'));

update public.recordings recording
set storage_bucket = 'club-archive'
where recording.storage_bucket = 'recordings'
  and exists (
    select 1 from public.archive_items item
    where item.storage_path = recording.storage_path
  );
