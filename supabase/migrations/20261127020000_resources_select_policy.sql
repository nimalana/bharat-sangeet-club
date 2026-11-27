-- Phase 2 (plan 2.4): the resources SELECT policy called private.can_view_resource()
-- once per row. Each call is a security-definer function that looks the caller up in
-- profiles (is_executive) and again in subgroup_memberships, so listing or counting
-- resources cost two index lookups per row: on 2,000 resources 175 ms for a member
-- (resource_count in get_portal_bootstrap alone) and 94 ms for an executive.
--
-- The caller's executive flag and their subgroup sets do not depend on the row, so
-- the policy now reads them once per statement (uncorrelated scalar subselects are
-- evaluated as InitPlans) and compares each row against the cached values. The rule
-- is unchanged; private.can_view_resource() stays for the storage policies and the
-- resource functions that already call it for a single row.
--   executive/admin: everything
--   visibility = members and status = ready: no subgroup, or a subgroup the caller is active in
--   visibility = members and status pending_upload/failed: the uploader
--   visibility = members, inside a subgroup: its leaders and managers (any status)
-- The restrictive "Active members only" policy still applies on top.

create or replace function private.my_active_subgroup_ids()
returns bigint[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(membership.subgroup_id), '{}'::bigint[])
  from public.subgroup_memberships membership
  where membership.member_id = (select auth.uid())
    and membership.status = 'active';
$$;

-- Same condition as private.is_subgroup_manager(): an active member who leads or
-- manages the subgroup.
create or replace function private.my_managed_subgroup_ids()
returns bigint[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(membership.subgroup_id), '{}'::bigint[])
  from public.subgroup_memberships membership
  where private.is_active_member()
    and membership.member_id = (select auth.uid())
    and membership.status = 'active'
    and membership.membership_role in ('leader', 'manager');
$$;

revoke all on function private.my_active_subgroup_ids() from public, anon;
revoke all on function private.my_managed_subgroup_ids() from public, anon;
grant execute on function private.my_active_subgroup_ids() to authenticated;
grant execute on function private.my_managed_subgroup_ids() to authenticated;

drop policy if exists "Members view permitted resources" on public.resources;
create policy "Members view permitted resources"
on public.resources for select to authenticated
using (
  (select private.is_executive())
  or (
    visibility = 'members'
    and (
      (status = 'ready'
        and (subgroup_id is null or subgroup_id = any (((select private.my_active_subgroup_ids())::bigint[]))))
      or (status in ('pending_upload', 'failed') and created_by = (select auth.uid()))
      or (subgroup_id is not null and subgroup_id = any (((select private.my_managed_subgroup_ids())::bigint[])))
    )
  )
);
