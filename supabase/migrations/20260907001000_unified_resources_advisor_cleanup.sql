-- Advisor cleanup for the unified resources library.
-- Keep author lookups indexed and avoid a second permissive SELECT policy on
-- resource_tags: UPDATE requires a SELECT policy, while writes are separate.

create index if not exists resource_tags_created_by_idx
  on public.resource_tags (created_by)
  where created_by is not null;

create index if not exists resource_tag_assignments_created_by_idx
  on public.resource_tag_assignments (created_by)
  where created_by is not null;

drop policy if exists "Executives manage resource tags" on public.resource_tags;

drop policy if exists "Executives insert resource tags" on public.resource_tags;
create policy "Executives insert resource tags"
on public.resource_tags for insert to authenticated
with check (private.is_executive());

drop policy if exists "Executives update resource tags" on public.resource_tags;
create policy "Executives update resource tags"
on public.resource_tags for update to authenticated
using (private.is_executive())
with check (private.is_executive());

drop policy if exists "Executives delete resource tags" on public.resource_tags;
create policy "Executives delete resource tags"
on public.resource_tags for delete to authenticated
using (private.is_executive());
