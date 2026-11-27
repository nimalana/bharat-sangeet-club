-- frontend-11 and core-4: permanent delete of a resource is for executives.
--
-- Plan 1.4: "Permanent delete, executives only, files and empty folders only".
-- The portal shows Delete to executives alone, but the policy "Managers delete
-- resources" (20260907000000) let any leader or manager of a group delete any
-- ready or archived item in it with a direct API call, and "Managers delete
-- resource files" let them delete the stored file. Deleting the row first also
-- left the file behind with no row to authorise a later cleanup, so nobody
-- could remove it any more.
--
-- Now:
--   * executives (and admins) delete any resource row and any resource file;
--   * a leader or manager can still discard an unfinished upload (status
--     pending_upload or failed) in a group they manage, row and file, which is
--     what "Discard upload" and the cleanup after a failed upload do. Archiving,
--     renaming and pinning stay with managers.
-- Folders keep their protection: parent_id is "on delete restrict", so a folder
-- with contents cannot be deleted by anyone.
drop policy if exists "Managers delete resources" on public.resources;
drop policy if exists "Delete resources: executives, or unfinished uploads" on public.resources;
create policy "Delete resources: executives, or unfinished uploads"
on public.resources for delete to authenticated
using (
  (select private.is_executive())
  or (status in ('pending_upload', 'failed') and private.can_manage_resource(subgroup_id, visibility))
);

drop policy if exists "Managers delete resource files" on storage.objects;
drop policy if exists "Delete resource files: executives, or unfinished uploads" on storage.objects;
create policy "Delete resource files: executives, or unfinished uploads"
on storage.objects for delete to authenticated
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
);

-- core-4 (deliberate, documented only). Restoring a folder restores every
-- archived item under it, including one that was archived separately before the
-- folder was, and archiving clears pins, which a restore does not bring back.
-- That follows from "archive the whole subtree; restore does the same" in plan
-- 1.4, and an item cannot be restored while its folder is archived, so it is
-- never stranded. Recording who was archived with the folder, and the pins, would
-- need new columns; if that is wanted later, archive with a shared timestamp and
-- restore only rows carrying it.
comment on function public.set_resource_archived(bigint, boolean) is
  'Archives or restores an item and everything under it. Restoring brings back every archived row in the subtree, including items archived on their own earlier, and archiving clears pins; neither is remembered. Deliberate (plan 1.4); see the Phase 1/2 review, core-4.';
