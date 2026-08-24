-- Club-wide links live separately from uploaded archive files: links do not
-- need a Storage object, but they follow the same member-view/executive-manage
-- authorization model as other shared resources.
create table public.resource_links (
  id bigint generated always as identity primary key,
  title text not null,
  description text not null default '',
  url text not null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint resource_links_title_length
    check (char_length(btrim(title)) between 1 and 160),
  constraint resource_links_description_length
    check (char_length(description) <= 1000),
  constraint resource_links_url_length
    check (char_length(url) <= 2048),
  constraint resource_links_http_url
    check (url ~* '^https?://[^[:space:]]+$')
);

create index resource_links_created_at_idx
  on public.resource_links (created_at desc);

alter table public.resource_links enable row level security;

revoke all on table public.resource_links from anon;
revoke all on sequence public.resource_links_id_seq from anon;
grant select, insert, delete on table public.resource_links to authenticated;
grant usage, select on sequence public.resource_links_id_seq to authenticated;

create policy "Members view resource links"
on public.resource_links
for select
to authenticated
using ((select auth.uid()) is not null);

create policy "Executives add resource links"
on public.resource_links
for insert
to authenticated
with check (
  (select private.is_executive())
  and created_by = (select auth.uid())
);

create policy "Executives delete resource links"
on public.resource_links
for delete
to authenticated
using ((select private.is_executive()));

comment on table public.resource_links is
  'Club-wide external resources visible to signed-in Bharat Sangeet members.';
