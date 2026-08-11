alter table public.archive_items
  add column is_public boolean not null default false;

create index archive_items_public_concert_idx
  on public.archive_items(created_at desc)
  where is_public and type = 'recording';

grant select on public.archive_items to anon;

create policy "Visitors view public concert recordings"
on public.archive_items for select to anon
using (is_public and type = 'recording');

create policy "Visitors stream public concert files"
on storage.objects for select to anon
using (
  bucket_id = 'club-archive' and exists (
    select 1 from public.archive_items
    where storage_path = name
      and is_public
      and type = 'recording'
  )
);
