-- Phase 4.3, P0-02: files and rows marked "executives only" are invisible to ordinary members,
-- in the table policies AND in the storage policies.
--
-- RELEASE ORDER: safe to apply BEFORE the new frontend. It only removes rows from reads that no
-- screen could open anyway (an "executives only" archive row the storage policy already refused to
-- sign). Section "Apply before the new frontend" of docs/RELEASE_ORDER.md.
--
-- What was open, found by listing every table and bucket that has a visibility or scope concept
-- (the table is in supabase/tests/77_access_visibility_matrix.test.sql, which proves each row):
--
--   archive_items (table policy "Members view permitted archive")
--       A row of a subgroup was visible to every ACTIVE MEMBER of that subgroup whatever its
--       `visibility`: the subgroup branch of the policy had no `visibility = 'members'` test, only the
--       club-wide branch had one. A member of a group could therefore `select` the title, description
--       and storage path of an `executives` row of their own group (register P0-02). The storage
--       policy "Members read permitted archive files" did test the visibility, so signing the file was
--       already refused; the metadata and the path were not. Closed here.
--   archive_items (anon policy "Visitors view public concert recordings", and the storage policy
--       "Visitors stream public concert files")
--       `is_public and type = 'recording'` with no look at `visibility`. The client never writes
--       `visibility = 'executives'` together with `is_public` (lib/archive-sharing.ts), but nothing
--       stopped a direct write from doing so, and "executives only and public" can only mean one of the
--       two. The safe reading wins: such a row is not public. A new CHECK (not valid: see below) keeps
--       the combination out of new rows.
--   storage "Uploaders read objects in their own folder" and "Uploaders read own recording objects"
--       Both let whoever uploaded an object read it again, in the buckets recordings,
--       recording-notations AND club-archive. Only executives can upload to club-archive, so a
--       demoted executive kept read access (and a signed url) to every club-archive file they ever
--       uploaded, including the `executives` ones. For club-archive the rule now also needs the
--       caller to be an executive today. recordings and recording-notations are unchanged: a member
--       reads the files they uploaded themselves (a decision, see the test).
--   recordings / recording_notes (table and storage)
--       There is no "executives" audience on recordings (club, subgroup, public); drafts and archived
--       recordings are visible to their uploader and executives only. That was already right and is
--       now pinned by the test loop. What was NOT bound is the path: the storage read policy for the
--       recordings and recording-notations buckets trusts any registered row, and the insert policies
--       for the rows check `uploaded_by = auth.uid()` but not where the file is. A member who learned
--       the path of someone else's unregistered file (an abandoned draft take, a notation file in
--       another folder) could register it as their own recording or note and then read it. Storage only
--       lets a person upload into their own user-id folder, so every legitimate row already has
--       `<uploaded_by>/...` as its path; a new trigger requires exactly that for rows written by a
--       signed-in person (the migration role, the service role and the legacy copy are not affected).
--
-- Already right, proven by the loop and left as it is: resources (private.can_view_resource: an
-- `executives` row is for executives only, a group manager sees `members` rows of their group),
-- resource_tag_assignments (follows resources), resource_imports (creator, executives, the group's
-- managers), events and announcements (scoped to an ACTIVE membership), finance-private and
-- attendance-excuses (own folder, executives).
--
-- CHECK constraints are added NOT VALID: new and changed rows must pass, existing rows are not
-- scanned (production cannot be read from here). VALIDATE is a manual step, see docs/RELEASE_ORDER.md.
--
-- Safe to run twice.

-- ---------------------------------------------------------------------------
-- archive_items
-- ---------------------------------------------------------------------------
drop policy if exists "Members view permitted archive" on public.archive_items;
create policy "Members view permitted archive"
on public.archive_items for select to authenticated
using (
  (select private.is_executive())
  or (
    visibility = 'members'
    and (
      subgroup_id is null
      or exists (
        select 1 from public.subgroup_memberships membership
        where membership.subgroup_id = archive_items.subgroup_id
          and membership.member_id = (select auth.uid())
          and membership.status = 'active'
      )
    )
  )
);

drop policy if exists "Visitors view public concert recordings" on public.archive_items;
create policy "Visitors view public concert recordings"
on public.archive_items for select to anon
using (is_public and type = 'recording' and visibility = 'members');

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.archive_items'::regclass and conname = 'archive_items_public_not_executives'
  ) then
    alter table public.archive_items
      add constraint archive_items_public_not_executives
      check (not (is_public and visibility = 'executives')) not valid;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- storage.objects
-- ---------------------------------------------------------------------------
drop policy if exists "Visitors stream public concert files" on storage.objects;
create policy "Visitors stream public concert files"
on storage.objects for select to anon
using (
  bucket_id = 'club-archive'
  and exists (
    select 1 from public.archive_items item
    where item.storage_path = objects.name
      and item.is_public
      and item.type = 'recording'
      and item.visibility = 'members'
  )
);

drop policy if exists "Uploaders read objects in their own folder" on storage.objects;
create policy "Uploaders read objects in their own folder"
on storage.objects for select to authenticated
using (
  (storage.foldername(name))[1] = (select auth.uid())::text
  and (
    bucket_id in ('recordings', 'recording-notations')
    or (bucket_id = 'club-archive' and (select private.is_executive()))
  )
);

drop policy if exists "Uploaders read own recording objects" on storage.objects;
create policy "Uploaders read own recording objects"
on storage.objects for select to authenticated
using (
  owner_id = (select auth.uid())::text
  and (
    bucket_id in ('recordings', 'recording-notations')
    or (bucket_id = 'club-archive' and (select private.is_executive()))
  )
);

-- ---------------------------------------------------------------------------
-- recordings and recording notes: the file a row registers is in its uploader's own folder
-- ---------------------------------------------------------------------------
create or replace function private.bind_recording_file_to_uploader()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_path text;
  v_bucket text;
  v_changed boolean;
begin
  -- The migration role, the service role and definer maintenance have no signed-in user.
  if (select auth.uid()) is null then return new; end if;

  if tg_table_name = 'recordings' then
    v_path := new.storage_path;
    v_bucket := new.storage_bucket;
    v_changed := tg_op = 'INSERT'
      or new.storage_path is distinct from old.storage_path
      or new.storage_bucket is distinct from old.storage_bucket
      or new.uploaded_by is distinct from old.uploaded_by;
    -- Rows copied from the legacy archive point into club-archive, whose files executives upload: not bound here.
    if v_bucket is distinct from 'recordings' then return new; end if;
  else
    v_path := new.storage_path;
    v_changed := tg_op = 'INSERT'
      or new.storage_path is distinct from old.storage_path
      or new.uploaded_by is distinct from old.uploaded_by;
    if v_path is null then return new; end if;
  end if;

  if v_changed and split_part(v_path, '/', 1) <> new.uploaded_by::text then
    raise exception 'A file can only be registered from your own folder' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function private.bind_recording_file_to_uploader() from public, anon, authenticated;

drop trigger if exists bind_recording_file_to_uploader on public.recordings;
create trigger bind_recording_file_to_uploader
  before insert or update of storage_path, storage_bucket, uploaded_by on public.recordings
  for each row execute function private.bind_recording_file_to_uploader();

drop trigger if exists bind_recording_file_to_uploader on public.recording_notes;
create trigger bind_recording_file_to_uploader
  before insert or update of storage_path, uploaded_by on public.recording_notes
  for each row execute function private.bind_recording_file_to_uploader();
