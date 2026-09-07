-- Unified resources library: folders, uploaded files, and external links.
-- This migration keeps recording/archive compatibility while moving documents,
-- photos, and resource links into one scoped, policy-protected model.

create extension if not exists pgcrypto with schema extensions;

do $$
begin
  if not exists (select 1 from pg_type where typnamespace = 'public'::regnamespace and typname = 'resource_node_kind') then
    execute 'create type public.resource_node_kind as enum (''folder'', ''file'', ''link'')';
  end if;
  if not exists (select 1 from pg_type where typnamespace = 'public'::regnamespace and typname = 'resource_media_kind') then
    execute 'create type public.resource_media_kind as enum (''document'', ''image'', ''other'')';
  end if;
  if not exists (select 1 from pg_type where typnamespace = 'public'::regnamespace and typname = 'resource_status') then
    execute 'create type public.resource_status as enum (''pending_upload'', ''ready'', ''failed'', ''archived'')';
  end if;
end;
$$;

create table if not exists public.resource_imports (
  id uuid primary key default extensions.gen_random_uuid(),
  name text not null,
  root_parent_id bigint,
  subgroup_id bigint references public.subgroups(id) on delete restrict,
  visibility public.archive_visibility not null default 'members',
  status text not null default 'pending'
    check (status in ('pending', 'uploading', 'completed', 'partial', 'failed', 'canceled')),
  total_files integer not null default 0 check (total_files >= 0),
  completed_files integer not null default 0 check (completed_files >= 0),
  failed_files integer not null default 0 check (failed_files >= 0),
  total_bytes bigint not null default 0 check (total_bytes >= 0),
  uploaded_bytes bigint not null default 0 check (uploaded_bytes >= 0),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint resource_imports_name_length check (char_length(btrim(name)) between 1 and 240),
  constraint resource_imports_counts_check check (completed_files + failed_files <= total_files),
  constraint resource_imports_bytes_check check (uploaded_bytes <= total_bytes)
);

create table if not exists public.resources (
  id bigint generated always as identity primary key,
  node_kind public.resource_node_kind not null,
  media_kind public.resource_media_kind,
  title text not null,
  description text not null default '',
  parent_id bigint references public.resources(id) on delete restrict,
  subgroup_id bigint references public.subgroups(id) on delete restrict,
  visibility public.archive_visibility not null default 'members',
  storage_bucket text,
  storage_path text,
  external_url text,
  original_filename text,
  mime_type text,
  byte_size bigint,
  checksum_sha256 text,
  event_id bigint references public.events(id) on delete set null,
  occurred_on date,
  season_label text,
  status public.resource_status not null default 'pending_upload',
  is_pinned boolean not null default false,
  import_id uuid,
  created_by uuid references public.profiles(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint resources_title_length check (char_length(btrim(title)) between 1 and 240),
  constraint resources_description_length check (char_length(description) <= 5000),
  constraint resources_storage_path_length check (storage_path is null or char_length(storage_path) between 1 and 1024),
  constraint resources_external_url_length check (external_url is null or char_length(external_url) <= 2048),
  constraint resources_original_filename_length check (original_filename is null or char_length(original_filename) <= 1024),
  constraint resources_mime_type_length check (mime_type is null or char_length(mime_type) <= 255),
  constraint resources_byte_size_nonnegative check (byte_size is null or byte_size >= 0),
  constraint resources_checksum_format check (checksum_sha256 is null or checksum_sha256 ~ '^[0-9a-fA-F]{64}$'),
  constraint resources_metadata_object check (jsonb_typeof(metadata) = 'object'),
  constraint resources_node_shape check (
    (node_kind = 'folder' and media_kind is null and storage_bucket is null and storage_path is null and external_url is null and original_filename is null and mime_type is null and byte_size is null and checksum_sha256 is null)
    or (node_kind = 'file' and media_kind is not null and storage_bucket is not null and storage_path is not null and external_url is null)
    or (node_kind = 'link' and media_kind is null and storage_bucket is null and storage_path is null and external_url is not null and external_url ~* '^https?://[^[:space:]]+$')
  ),
  constraint resources_storage_bucket_check check (storage_bucket is null or storage_bucket in ('club-resources', 'club-archive'))
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'resources_import_id_fkey' and conrelid = 'public.resources'::regclass) then
    alter table public.resources
      add constraint resources_import_id_fkey
      foreign key (import_id) references public.resource_imports(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'resource_imports_root_parent_id_fkey' and conrelid = 'public.resource_imports'::regclass) then
    alter table public.resource_imports
      add constraint resource_imports_root_parent_id_fkey
      foreign key (root_parent_id) references public.resources(id) on delete set null;
  end if;
end;
$$;

create table if not exists public.resource_tags (
  id bigint generated always as identity primary key,
  name text not null unique,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint resource_tags_name_length check (char_length(btrim(name)) between 1 and 80)
);

create table if not exists public.resource_tag_assignments (
  resource_id bigint not null references public.resources(id) on delete cascade,
  tag_id bigint not null references public.resource_tags(id) on delete cascade,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (resource_id, tag_id)
);

create unique index if not exists resources_storage_object_key_idx
  on public.resources (storage_bucket, storage_path);
create index if not exists resources_scope_status_updated_idx
  on public.resources (subgroup_id, status, updated_at desc);
create index if not exists resources_parent_kind_title_idx
  on public.resources (parent_id, node_kind, lower(title));
create index if not exists resources_media_updated_idx
  on public.resources (media_kind, updated_at desc)
  where node_kind = 'file';
create index if not exists resources_event_idx on public.resources (event_id) where event_id is not null;
create index if not exists resources_creator_idx on public.resources (created_by) where created_by is not null;
create index if not exists resources_import_idx on public.resources (import_id) where import_id is not null;
create index if not exists resources_subgroup_visibility_status_idx
  on public.resources (subgroup_id, visibility, status);
create index if not exists resource_imports_creator_status_idx
  on public.resource_imports (created_by, status);
create index if not exists resource_imports_subgroup_created_idx
  on public.resource_imports (subgroup_id, created_at desc);
create index if not exists resource_imports_root_parent_idx
  on public.resource_imports (root_parent_id)
  where root_parent_id is not null;
create index if not exists resource_tag_assignments_tag_idx
  on public.resource_tag_assignments (tag_id, resource_id);

create or replace function private.touch_resource_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
revoke all on function private.touch_resource_updated_at() from public;

drop trigger if exists set_resource_updated_at on public.resources;
create trigger set_resource_updated_at
before update on public.resources
for each row execute procedure private.touch_resource_updated_at();

drop trigger if exists set_resource_import_updated_at on public.resource_imports;
create trigger set_resource_import_updated_at
before update on public.resource_imports
for each row execute procedure private.touch_resource_updated_at();

create or replace function private.validate_resource_hierarchy()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  parent_resource public.resources;
  ancestor_depth integer;
  has_cycle boolean;
  descendant_scope_mismatch boolean;
  subtree_depth integer;
begin
  if new.id is not null and new.node_kind <> 'folder'
    and exists (select 1 from public.resources child where child.parent_id = new.id) then
    raise exception 'a resource with children must remain a folder';
  end if;

  if new.parent_id is null then
    if new.id is not null and new.node_kind = 'folder' then
      with recursive descendants(id, subgroup_id, visibility) as (
        select child.id, child.subgroup_id, child.visibility
        from public.resources child
        where child.parent_id = new.id
        union all
        select child.id, child.subgroup_id, child.visibility
        from public.resources child
        join descendants on descendants.id = child.parent_id
      )
      select exists (
        select 1 from descendants
        where subgroup_id is distinct from new.subgroup_id
          or visibility <> new.visibility
      ) into descendant_scope_mismatch;
      if descendant_scope_mismatch then
        raise exception 'resource descendants must have the same subgroup scope and visibility';
      end if;
    end if;
    return new;
  end if;

  if new.id is not null and new.id = new.parent_id then
    raise exception 'a resource cannot be its own parent';
  end if;

  select * into parent_resource
  from public.resources
  where id = new.parent_id;
  if not found then
    raise exception 'resource parent does not exist';
  end if;
  if parent_resource.node_kind <> 'folder' then
    raise exception 'resource parent must be a folder';
  end if;
  if parent_resource.subgroup_id is distinct from new.subgroup_id then
    raise exception 'resource parent and child must have the same subgroup scope';
  end if;
  if parent_resource.visibility <> new.visibility then
    raise exception 'resource parent and child must have the same visibility';
  end if;

  with recursive ancestry(id, parent_id, depth, path) as (
    select parent_resource.id, parent_resource.parent_id, 1, array[parent_resource.id]::bigint[]
    union all
    select ancestor.id, ancestor.parent_id, ancestry.depth + 1, ancestry.path || ancestor.id
    from public.resources ancestor
    join ancestry on ancestry.parent_id = ancestor.id
    where not ancestor.id = any(ancestry.path)
  )
  select coalesce(max(depth), 0), coalesce(bool_or(new.id = id), false)
  into ancestor_depth, has_cycle
  from ancestry;

  if has_cycle then
    raise exception 'resource hierarchy cannot contain a cycle';
  end if;
  if ancestor_depth > 3 or (new.node_kind = 'folder' and ancestor_depth >= 3) then
    raise exception 'resource hierarchy cannot exceed three folder levels';
  end if;

  if new.id is not null and new.node_kind = 'folder' then
    with recursive descendants(id, folder_depth) as (
      select new.id, ancestor_depth + 1
      union all
      select child.id, descendants.folder_depth + 1
      from public.resources child
      join descendants on descendants.id = child.parent_id
      where child.node_kind = 'folder'
    )
    select max(folder_depth) into subtree_depth
    from descendants;
    if coalesce(subtree_depth, 0) > 3 then
      raise exception 'resource hierarchy cannot exceed three folder levels';
    end if;
  end if;

  if new.id is not null then
    with recursive descendants(id, subgroup_id, visibility) as (
      select child.id, child.subgroup_id, child.visibility
      from public.resources child
      where child.parent_id = new.id
      union all
      select child.id, child.subgroup_id, child.visibility
      from public.resources child
      join descendants on descendants.id = child.parent_id
    )
    select exists (
      select 1 from descendants
      where subgroup_id is distinct from new.subgroup_id
        or visibility <> new.visibility
    ) into descendant_scope_mismatch;
    if descendant_scope_mismatch then
      raise exception 'resource descendants must have the same subgroup scope and visibility';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.validate_resource_hierarchy() from public;

drop trigger if exists validate_resource_hierarchy on public.resources;
create trigger validate_resource_hierarchy
before insert or update of parent_id, subgroup_id, visibility, node_kind on public.resources
for each row execute procedure private.validate_resource_hierarchy();

create or replace function private.validate_resource_import_destination()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  parent_resource public.resources;
begin
  if new.root_parent_id is null then
    return new;
  end if;

  select * into parent_resource
  from public.resources
  where id = new.root_parent_id;
  if not found then
    raise exception 'resource import parent does not exist';
  end if;
  if parent_resource.node_kind <> 'folder' then
    raise exception 'resource import parent must be a folder';
  end if;
  if parent_resource.subgroup_id is distinct from new.subgroup_id then
    raise exception 'resource import parent and import must have the same subgroup scope';
  end if;
  if parent_resource.visibility <> new.visibility then
    raise exception 'resource import parent and import must have the same visibility';
  end if;
  return new;
end;
$$;
revoke all on function private.validate_resource_import_destination() from public;

drop trigger if exists validate_resource_import_destination on public.resource_imports;
create trigger validate_resource_import_destination
before insert or update of root_parent_id, subgroup_id, visibility on public.resource_imports
for each row execute procedure private.validate_resource_import_destination();

create or replace function private.can_view_resource(
  target_subgroup_id bigint,
  target_visibility public.archive_visibility,
  target_status public.resource_status,
  target_created_by uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select private.is_executive())
    or (
      target_visibility = 'members'
      and target_status = 'ready'
      and (
        target_subgroup_id is null
        or exists (
          select 1 from public.subgroup_memberships membership
          where membership.subgroup_id = target_subgroup_id
            and membership.member_id = (select auth.uid())
            and membership.status = 'active'
        )
      )
    )
    or (
      target_visibility = 'members'
      and target_status in ('pending_upload', 'failed')
      and target_created_by = (select auth.uid())
    )
    or (
      target_visibility = 'members'
      and target_subgroup_id is not null
      and private.is_subgroup_manager(target_subgroup_id)
    );
$$;

create or replace function private.can_manage_resource(
  target_subgroup_id bigint,
  target_visibility public.archive_visibility
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select private.is_executive())
    or (
      target_visibility = 'members'
      and target_subgroup_id is not null
      and private.is_subgroup_manager(target_subgroup_id)
    );
$$;

create or replace function private.can_manage_resource_import(
  target_subgroup_id bigint,
  target_created_by uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select private.is_executive())
    or target_created_by = (select auth.uid())
    or (target_subgroup_id is not null and private.is_subgroup_manager(target_subgroup_id));
$$;

revoke all on function private.can_view_resource(bigint, public.archive_visibility, public.resource_status, uuid) from public;
revoke all on function private.can_manage_resource(bigint, public.archive_visibility) from public;
revoke all on function private.can_manage_resource_import(bigint, uuid) from public;
grant execute on function private.can_view_resource(bigint, public.archive_visibility, public.resource_status, uuid) to authenticated;
grant execute on function private.can_manage_resource(bigint, public.archive_visibility) to authenticated;
grant execute on function private.can_manage_resource_import(bigint, uuid) to authenticated;

alter table public.resources enable row level security;
alter table public.resource_imports enable row level security;
alter table public.resource_tags enable row level security;
alter table public.resource_tag_assignments enable row level security;

revoke all on table public.resources, public.resource_imports, public.resource_tags, public.resource_tag_assignments from anon;
revoke all on sequence public.resources_id_seq, public.resource_tags_id_seq from anon;
revoke all on table public.resources, public.resource_imports, public.resource_tags, public.resource_tag_assignments from authenticated;
revoke all on sequence public.resources_id_seq, public.resource_tags_id_seq from authenticated;
grant select, insert, update, delete on table public.resources, public.resource_imports, public.resource_tags, public.resource_tag_assignments to authenticated;
grant usage, select on sequence public.resources_id_seq, public.resource_tags_id_seq to authenticated;

drop policy if exists "Members view permitted resources" on public.resources;
create policy "Members view permitted resources"
on public.resources for select to authenticated
using (private.can_view_resource(subgroup_id, visibility, status, created_by));

drop policy if exists "Managers create resources" on public.resources;
create policy "Managers create resources"
on public.resources for insert to authenticated
with check (
  private.can_manage_resource(subgroup_id, visibility)
  and created_by = (select auth.uid())
);

drop policy if exists "Managers update resources" on public.resources;
create policy "Managers update resources"
on public.resources for update to authenticated
using (private.can_manage_resource(subgroup_id, visibility))
with check (private.can_manage_resource(subgroup_id, visibility));

drop policy if exists "Managers delete resources" on public.resources;
create policy "Managers delete resources"
on public.resources for delete to authenticated
using (private.can_manage_resource(subgroup_id, visibility));

drop policy if exists "Members view permitted resource imports" on public.resource_imports;
create policy "Members view permitted resource imports"
on public.resource_imports for select to authenticated
using (private.can_manage_resource_import(subgroup_id, created_by));

drop policy if exists "Managers create resource imports" on public.resource_imports;
create policy "Managers create resource imports"
on public.resource_imports for insert to authenticated
with check (
  created_by = (select auth.uid())
  and private.can_manage_resource(subgroup_id, visibility)
);

drop policy if exists "Managers update resource imports" on public.resource_imports;
create policy "Managers update resource imports"
on public.resource_imports for update to authenticated
using (private.can_manage_resource_import(subgroup_id, created_by))
with check (private.can_manage_resource_import(subgroup_id, created_by));

drop policy if exists "Managers delete resource imports" on public.resource_imports;
create policy "Managers delete resource imports"
on public.resource_imports for delete to authenticated
using (private.can_manage_resource_import(subgroup_id, created_by));

drop policy if exists "Members view resource tags" on public.resource_tags;
create policy "Members view resource tags"
on public.resource_tags for select to authenticated using (true);
drop policy if exists "Executives manage resource tags" on public.resource_tags;
create policy "Executives manage resource tags"
on public.resource_tags for all to authenticated
using (private.is_executive()) with check (private.is_executive());

drop policy if exists "Members view resource tag assignments" on public.resource_tag_assignments;
create policy "Members view resource tag assignments"
on public.resource_tag_assignments for select to authenticated
using (exists (
  select 1 from public.resources resource
  where resource.id = resource_tag_assignments.resource_id
    and private.can_view_resource(resource.subgroup_id, resource.visibility, resource.status, resource.created_by)
));
drop policy if exists "Managers add resource tag assignments" on public.resource_tag_assignments;
create policy "Managers add resource tag assignments"
on public.resource_tag_assignments for insert to authenticated
with check (exists (
  select 1 from public.resources resource
  where resource.id = resource_tag_assignments.resource_id
    and private.can_manage_resource(resource.subgroup_id, resource.visibility)
));
drop policy if exists "Managers update resource tag assignments" on public.resource_tag_assignments;
create policy "Managers update resource tag assignments"
on public.resource_tag_assignments for update to authenticated
using (exists (
  select 1 from public.resources resource
  where resource.id = resource_tag_assignments.resource_id
    and private.can_manage_resource(resource.subgroup_id, resource.visibility)
))
with check (exists (
  select 1 from public.resources resource
  where resource.id = resource_tag_assignments.resource_id
    and private.can_manage_resource(resource.subgroup_id, resource.visibility)
));
drop policy if exists "Managers delete resource tag assignments" on public.resource_tag_assignments;
create policy "Managers delete resource tag assignments"
on public.resource_tag_assignments for delete to authenticated
using (exists (
  select 1 from public.resources resource
  where resource.id = resource_tag_assignments.resource_id
    and private.can_manage_resource(resource.subgroup_id, resource.visibility)
));

-- Preserve old records and storage objects. The JSON source marker makes this
-- data copy safe if a local migration is replayed during development.
insert into public.resources (
  node_kind, media_kind, title, description, subgroup_id, visibility,
  storage_bucket, storage_path, original_filename, mime_type, occurred_on,
  status, created_by, metadata, created_at, updated_at
)
select
  'file', case when item.type = 'photo' then 'image'::public.resource_media_kind else 'document'::public.resource_media_kind end,
  coalesce(nullif(btrim(item.title), ''), 'Untitled resource'),
  coalesce(item.description, ''), item.subgroup_id, item.visibility,
  'club-archive', item.storage_path,
  reverse(split_part(reverse(item.storage_path), '/', 1)),
  case when item.type = 'photo' then 'image/*' else 'application/octet-stream' end,
  item.event_date, 'ready', item.uploaded_by,
  jsonb_build_object('legacy_archive_item_id', item.id, 'legacy_archive_type', item.type::text),
  item.created_at, item.created_at
from public.archive_items item
where item.type in ('document', 'photo')
  and not exists (
    select 1 from public.resources resource
    where resource.metadata ->> 'legacy_archive_item_id' = item.id::text
  )
on conflict do nothing;

insert into public.resources (
  node_kind, title, description, visibility, external_url, status,
  created_by, metadata, created_at, updated_at
)
select
  'link', coalesce(nullif(btrim(link.title), ''), 'Untitled link'),
  coalesce(link.description, ''), 'members', link.url, 'ready',
  link.created_by,
  jsonb_build_object('legacy_resource_link_id', link.id),
  link.created_at, link.created_at
from public.resource_links link
where not exists (
  select 1 from public.resources resource
  where resource.metadata ->> 'legacy_resource_link_id' = link.id::text
);

insert into storage.buckets (id, name, public)
values ('club-resources', 'club-resources', false)
on conflict (id) do update set public = false;

-- Storage policies are keyed to the resource row, not merely to a guessed
-- object path. The legacy policy is extended so migrated docs/photos remain
-- readable from club-archive under their original paths.
drop policy if exists "Members read permitted archive files" on storage.objects;
create policy "Members read permitted archive files"
on storage.objects for select to authenticated
using (
  bucket_id = 'club-archive' and (
    exists (
      select 1 from public.archive_items item
      where item.storage_path = name and (
        private.is_executive()
        or (item.subgroup_id is null and item.visibility = 'members')
        or exists (
          select 1 from public.subgroup_memberships membership
          where membership.subgroup_id = item.subgroup_id
            and membership.member_id = (select auth.uid())
            and membership.status = 'active'
            and item.visibility = 'members'
        )
      )
    )
    or exists (
      select 1 from public.resources resource
      where resource.storage_bucket = bucket_id
        and resource.storage_path = name
        and private.can_view_resource(resource.subgroup_id, resource.visibility, resource.status, resource.created_by)
    )
  )
);

drop policy if exists "Members read resource files" on storage.objects;
create policy "Members read resource files"
on storage.objects for select to authenticated
using (
  bucket_id = 'club-resources' and exists (
    select 1 from public.resources resource
    where resource.storage_bucket = bucket_id
      and resource.storage_path = name
      and private.can_view_resource(resource.subgroup_id, resource.visibility, resource.status, resource.created_by)
  )
);

drop policy if exists "Managers upload resource files" on storage.objects;
create policy "Managers upload resource files"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'club-resources' and exists (
    select 1 from public.resources resource
    where resource.storage_bucket = bucket_id
      and resource.storage_path = name
      and resource.node_kind = 'file'
      and private.can_manage_resource(resource.subgroup_id, resource.visibility)
  )
);

drop policy if exists "Managers update resource files" on storage.objects;
create policy "Managers update resource files"
on storage.objects for update to authenticated
using (
  bucket_id = 'club-resources' and exists (
    select 1 from public.resources resource
    where resource.storage_bucket = bucket_id
      and resource.storage_path = name
      and private.can_manage_resource(resource.subgroup_id, resource.visibility)
  )
)
with check (
  bucket_id = 'club-resources' and exists (
    select 1 from public.resources resource
    where resource.storage_bucket = bucket_id
      and resource.storage_path = name
      and private.can_manage_resource(resource.subgroup_id, resource.visibility)
  )
);

drop policy if exists "Managers delete resource files" on storage.objects;
create policy "Managers delete resource files"
on storage.objects for delete to authenticated
using (
  bucket_id = 'club-resources' and exists (
    select 1 from public.resources resource
    where resource.storage_bucket = bucket_id
      and resource.storage_path = name
      and private.can_manage_resource(resource.subgroup_id, resource.visibility)
  )
);
