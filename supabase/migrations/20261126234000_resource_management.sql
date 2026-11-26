-- Resource library management: change visibility, archive and restore.
--
-- validate_resource_hierarchy requires every item to match its parent's
-- visibility, so a folder with contents can never be changed row by row.
-- set_resource_visibility updates the whole subtree in one statement and
-- tells the trigger to stand down for that statement only.

drop trigger if exists validate_resource_hierarchy on public.resources;
create trigger validate_resource_hierarchy
before insert or update of parent_id, subgroup_id, visibility, node_kind on public.resources
for each row
when (coalesce(current_setting('app.resource_subtree_update', true), 'off') <> 'on')
execute function private.validate_resource_hierarchy();

create or replace function public.set_resource_visibility(p_resource_id bigint, p_visibility public.archive_visibility)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  target public.resources;
  changed integer;
begin
  if (select auth.uid()) is null or not private.is_executive() then
    raise exception 'Only executives can change who can see a resource' using errcode = '42501';
  end if;
  select * into target from public.resources where id = p_resource_id for update;
  if not found then
    raise exception 'Resource not found' using errcode = 'P0002';
  end if;
  if target.parent_id is not null then
    raise exception 'Items inside a folder use the folder''s visibility. Change the top-level folder instead.' using errcode = '22023';
  end if;

  perform set_config('app.resource_subtree_update', 'on', true);
  with recursive tree(id) as (
    select target.id
    union all
    select child.id from public.resources child join tree on child.parent_id = tree.id
  )
  update public.resources resource
  set visibility = p_visibility, updated_at = now()
  from tree
  where resource.id = tree.id and resource.visibility <> p_visibility;
  get diagnostics changed = row_count;
  perform set_config('app.resource_subtree_update', 'off', true);
  return changed;
end;
$$;

create or replace function public.set_resource_archived(p_resource_id bigint, p_archived boolean)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  target public.resources;
  changed integer;
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in required' using errcode = '42501';
  end if;
  select * into target from public.resources where id = p_resource_id for update;
  if not found then
    raise exception 'Resource not found' using errcode = 'P0002';
  end if;
  if not private.can_manage_resource(target.subgroup_id, target.visibility) then
    raise exception 'You do not have permission to manage this resource' using errcode = '42501';
  end if;
  if not p_archived and target.parent_id is not null and exists (
    select 1 from public.resources parent where parent.id = target.parent_id and parent.status = 'archived'
  ) then
    raise exception 'Restore the folder this item is in first' using errcode = '22023';
  end if;

  with recursive tree(id) as (
    select target.id
    union all
    select child.id from public.resources child join tree on child.parent_id = tree.id
  )
  update public.resources resource
  set status = case when p_archived then 'archived' else 'ready' end::public.resource_status,
      is_pinned = case when p_archived then false else resource.is_pinned end,
      updated_at = now()
  from tree
  where resource.id = tree.id
    and resource.status = (case when p_archived then 'ready' else 'archived' end)::public.resource_status;
  get diagnostics changed = row_count;
  return changed;
end;
$$;

revoke all on function public.set_resource_visibility(bigint, public.archive_visibility) from public, anon;
revoke all on function public.set_resource_archived(bigint, boolean) from public, anon;
grant execute on function public.set_resource_visibility(bigint, public.archive_visibility) to authenticated;
grant execute on function public.set_resource_archived(bigint, boolean) to authenticated;
