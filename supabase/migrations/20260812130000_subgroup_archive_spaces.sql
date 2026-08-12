alter table public.archive_items
  add column if not exists subgroup_id bigint references public.subgroups(id) on delete cascade;

create index if not exists archive_items_subgroup_created_idx
  on public.archive_items(subgroup_id, created_at desc)
  where subgroup_id is not null;

drop policy if exists "Members can view shared archive" on public.archive_items;
create policy "Members view accessible archive"
on public.archive_items for select to authenticated
using (
  private.is_executive()
  or (
    visibility = 'members' and (
      subgroup_id is null
      or exists (
        select 1 from public.subgroup_memberships membership
        where membership.subgroup_id = archive_items.subgroup_id
          and membership.member_id = (select auth.uid())
      )
    )
  )
);

drop policy if exists "Members read shared files" on storage.objects;
create policy "Members read accessible files"
on storage.objects for select to authenticated
using (
  bucket_id = 'club-archive' and exists (
    select 1 from public.archive_items item
    where item.storage_path = name
      and (
        private.is_executive()
        or (
          item.visibility = 'members' and (
            item.subgroup_id is null
            or exists (
              select 1 from public.subgroup_memberships membership
              where membership.subgroup_id = item.subgroup_id
                and membership.member_id = (select auth.uid())
            )
          )
        )
      )
  )
);
