-- core-1: leaders and managers could re-admit a removed member, or switch a
-- manager to inactive, through the original review function.
--
-- public.review_subgroup_enrollment (20260812140000) updates any membership row
-- to active, waitlisted or inactive. It does not look at the row's current
-- status, so a leader could set a member that a manager had removed back to
-- active, and the row of a manager to inactive. It also ignores archived groups.
-- The portal calls review_subgroup_request instead, which only acts on rows
-- that are waiting for review, and the frontend on main never called this
-- function (git show origin/main:app/page.tsx has no review_subgroup call).
--
-- Plan 2.0 revokes it after Phase 1 ships; that moves here, because the
-- removed status is new in this release and gives the old function a second
-- abuse path. Nobody signed in can call it any more.
--
-- If the function is ever granted again (a later migration, a restored backup,
-- or a hosted default privilege), it still refuses to touch a removed row or a
-- row in an archived group. Everything else about it is unchanged.
create or replace function public.review_subgroup_enrollment(
  target_subgroup_id bigint,
  target_member_id uuid,
  next_status public.subgroup_membership_status
)
returns public.subgroup_memberships
language plpgsql
security definer
set search_path = ''
as $$
declare result public.subgroup_memberships;
begin
  if (select auth.uid()) is null then raise exception 'authentication required'; end if;
  if next_status not in ('active', 'waitlisted', 'inactive') then
    raise exception 'requests may only be approved, waitlisted, or made inactive';
  end if;
  if not (private.is_executive() or private.is_subgroup_manager(target_subgroup_id)) then
    raise exception 'subgroup management permission required';
  end if;
  if exists (select 1 from public.subgroups where id = target_subgroup_id and archived_at is not null) then
    raise exception 'This group is archived' using errcode = '22023';
  end if;

  update public.subgroup_memberships
  set status = next_status,
      reviewed_by = (select auth.uid()),
      added_by = case when next_status = 'active' then (select auth.uid()) else added_by end,
      status_updated_at = now()
  where subgroup_id = target_subgroup_id
    and member_id = target_member_id
    and status <> 'removed'
  returning * into result;
  if not found then raise exception 'membership request not found'; end if;
  return result;
end;
$$;

-- Hosted Supabase also grants EXECUTE on new functions to anon and
-- authenticated through default privileges, so name every role.
revoke all on function public.review_subgroup_enrollment(bigint, uuid, public.subgroup_membership_status)
  from public, anon, authenticated;
