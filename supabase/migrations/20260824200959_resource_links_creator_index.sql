create index resource_links_created_by_idx
  on public.resource_links (created_by)
  where created_by is not null;
