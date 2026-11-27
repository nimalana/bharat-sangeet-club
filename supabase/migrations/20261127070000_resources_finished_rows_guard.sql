-- Round 2 of frontend-11 and core-4: close the ways around "only executives
-- permanently delete a finished resource".
--
-- 20261127043000 let a leader or manager delete a resource row, and its stored
-- file, only while its status is pending_upload or failed. But the update policy
-- on resources ("Managers update resources") puts no limit on what a manager may
-- change, so the rule was a lock with the key beside it:
--   1. UPDATE resources SET status = 'failed' on a ready file, then delete the
--      file with the Storage API and the row with a normal delete. Two calls.
--   2. UPDATE the ready row's storage_path to something else, insert a new
--      pending row for the old path, and delete the old file as that "unfinished
--      upload". The ready row is left pointing at nothing.
--   3. Move the stored file (a Storage UPDATE of its name) onto the path of such
--      an unfinished row of their own, then delete it there.
--
-- The delete rights depend on a row's status and location, so those are what a
-- non-executive may no longer change on a finished row:
--   * a trigger refuses a non-executive moving a ready or archived row back to
--     pending_upload or failed, and refuses any non-executive change of
--     storage_bucket or storage_path (nothing in the portal changes them; a file
--     is registered once, when its row is created);
--   * the Storage update policy follows the delete policy: executives, or the
--     unfinished uploads of a group the person manages.
-- Unchanged, and still allowed for managers: pending_upload to failed and to ready
-- (an upload finishing or failing), failed back to pending_upload, ready to
-- archived and back (set_resource_archived), rename, pin and move. A manager can
-- still discard their group's unfinished uploads, row and file.
--
-- Callers with no signed-in user (migrations, the dashboard, the service role) and
-- executives are not limited.
create or replace function private.guard_finished_resources()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or (select private.is_executive()) then
    return new;
  end if;
  if old.status in ('ready', 'archived') and new.status in ('pending_upload', 'failed') then
    raise exception 'Only executives can mark a finished resource as failed or waiting for upload'
      using errcode = '42501';
  end if;
  if new.storage_bucket is distinct from old.storage_bucket
     or new.storage_path is distinct from old.storage_path then
    raise exception 'Only executives can change where a resource''s file is stored'
      using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_finished_resources() from public, anon, authenticated;

drop trigger if exists guard_finished_resources on public.resources;
create trigger guard_finished_resources
  before update of status, storage_bucket, storage_path on public.resources
  for each row execute function private.guard_finished_resources();

drop policy if exists "Managers update resource files" on storage.objects;
drop policy if exists "Update resource files: executives, or unfinished uploads" on storage.objects;
create policy "Update resource files: executives, or unfinished uploads"
on storage.objects for update to authenticated
using (
  bucket_id = 'club-resources'
  and exists (
    select 1 from public.resources resource
    where resource.storage_bucket = objects.bucket_id
      and resource.storage_path = objects.name
      and (
        (select private.is_executive())
        or (resource.status in ('pending_upload', 'failed') and private.can_manage_resource(resource.subgroup_id, resource.visibility))
      )
  )
)
with check (
  bucket_id = 'club-resources'
  and exists (
    select 1 from public.resources resource
    where resource.storage_bucket = objects.bucket_id
      and resource.storage_path = objects.name
      and (
        (select private.is_executive())
        or (resource.status in ('pending_upload', 'failed') and private.can_manage_resource(resource.subgroup_id, resource.visibility))
      )
  )
);
