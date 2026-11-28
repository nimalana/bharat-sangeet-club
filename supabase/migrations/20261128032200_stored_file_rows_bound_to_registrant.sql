-- Second security review, finding F3 (P3), and the same class swept over every policy where "a row vouches for an object".
--
-- RELEASE ORDER: apply BEFORE the new frontend (section 1 of docs/RELEASE_ORDER.md). Nothing signed-in writes what this
-- file refuses: the portal registers a library file only from its own folder in the bucket club-resources
-- (lib/api/resources.ts createPendingResourceFile, path `<user id>/<import id>/...`), and registers a finance
-- document with its own `<user id>/...` path (the old screens too: the finance-private upload policy forces that folder).
-- No function inserts into public.resources or public.finance_documents except register_finance_document, which
-- enforces the same folder itself.
--
-- The defects.
--   F3. A group manager or leader could insert a `resources` row with storage_bucket = 'club-archive' and the path of an
--       executives-only archive file (`resources_storage_bucket_check` allows the value, "Managers create resources"
--       asks only that the caller manages the group). The storage policy "Members read permitted archive files" has a
--       second branch that accepts any resources row visible to the caller, so every active member of the group could then
--       read that file. (Reproduced: gmB, in another group, read nothing; mgrA and every member of A read it.)
--   Sweep, same class. The policies for club-resources ("Members read resource files", "Update resource files...",
--       "Delete resource files...") and for finance-private ("Members read permitted finance files") also let a row vouch
--       for the object at its path, and nothing tied the row's path to its registrant's folder: a manager could register
--       a row whose path is somebody else's abandoned (unregistered) object in club-resources and then read, overwrite and
--       delete it; before 20261128029000 (section 3) a member could do the same with finance_documents, which let them read
--       another member's receipt. The recordings tables got their folder rule in 20261128030000 and 20261128032100.
--
-- The fix: one trigger per table, the same shape as bind_recording_file_to_uploader.
--   * public.resources: a signed-in person who is not an executive and who inserts a row, or changes its bucket or path,
--     may not name the bucket 'club-archive', and a file in the bucket 'club-resources' must sit in the creator's own
--     folder. Executives are not checked: they read, overwrite and delete every library and archive file through the
--     executive branches of the policies already, so a row gives them nothing (and several existing suites register
--     rows as an executive with made-up paths).
--     No signed-in person (a migration, the service role) is not checked: the legacy copy of archive items into the library
--     (20260907000000) ran that way and its rows keep reading exactly as before.
--   * public.finance_documents: for a signed-in person who is not an executive, the path must start with the uploader's own
--     folder (the rule register_finance_document applies, now also for any other writer).
--   The read policy is NOT changed: with the trigger no signed-in non-executive can create a club-archive row, and
--   requiring "the creator is an executive today" in the policy would hide legacy copies whose creator was demoted or
--   removed. The one thing the trigger cannot do is clean a row that already exists: see "club-archive rows in the library" in
--   docs/RELEASE_ORDER.md ("Manual steps") for the query that lists them before and after this file.
--
-- Left alone on purpose (and why, with the table of every row-vouches-for-object policy, in the test header):
--   archive_items (only executives write it), recording_notes (bound by 20261128030000, bucket fixed to
--   recording-notations), attendance-excuses (policies are folder-based, no row vouches), the public concert policy
--   (archive_items, executives write).
--
-- Safe to run twice.

create or replace function private.guard_resource_file_rows()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_changed boolean;
begin
  -- The migration role, the service role and definer maintenance have no signed-in user.
  if (select auth.uid()) is null then return new; end if;

  v_changed := tg_op = 'INSERT'
    or new.storage_bucket is distinct from old.storage_bucket
    or new.storage_path is distinct from old.storage_path;
  if not v_changed or new.storage_bucket is null then return new; end if;
  -- An executive reads, overwrites and deletes every library and archive file through the executive branches of the policies
  -- anyway, so a row of theirs gives them nothing they do not have.
  if (select private.is_executive()) then return new; end if;

  if new.storage_bucket = 'club-archive' then
    raise exception 'Only an executive can register a file from the club archive' using errcode = '42501';
  elsif new.storage_bucket = 'club-resources' and new.storage_path is not null
        and split_part(new.storage_path, '/', 1) is distinct from new.created_by::text then
    raise exception 'A file can only be registered from your own folder' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_resource_file_rows() from public, anon, authenticated;

drop trigger if exists guard_resource_file_rows on public.resources;
create trigger guard_resource_file_rows
  before insert or update of storage_bucket, storage_path on public.resources
  for each row execute function private.guard_resource_file_rows();

create or replace function private.guard_finance_document_path()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or (select private.is_executive()) then return new; end if;   -- an executive reads every finance file anyway
  if (tg_op = 'INSERT' or new.storage_path is distinct from old.storage_path or new.uploaded_by is distinct from old.uploaded_by)
     and split_part(new.storage_path, '/', 1) is distinct from new.uploaded_by::text then
    raise exception 'The file must be stored in your own folder' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_finance_document_path() from public, anon, authenticated;

drop trigger if exists guard_finance_document_path on public.finance_documents;
create trigger guard_finance_document_path
  before insert or update of storage_path, uploaded_by on public.finance_documents
  for each row execute function private.guard_finance_document_path();
