-- Round 2 of core-5 (20261127040100): remove_subgroup_member checked what the
-- target row looked like before it checked who was asking. A signed-in person with
-- no standing in a group could call it for anyone and be told "That person is
-- waiting for review" (a pending or waitlisted request) or "That person is not in
-- this group", which maps out who has applied to which group. Before core-5 the
-- same call answered "Only group managers and executives can remove members".
--
-- The caller is now checked first: an executive, or a manager of this group (the
-- same helper as before). Only then is the target looked at, and the archived-group
-- and leader/manager limits follow, with the same messages as 20261127040100.
create or replace function public.remove_subgroup_member(
  p_subgroup_id bigint,
  p_member_id uuid
)
returns public.subgroup_memberships
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_is_executive boolean := private.is_executive();
  target public.subgroup_memberships;
  result public.subgroup_memberships;
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in required' using errcode = '42501';
  end if;
  if p_member_id = (select auth.uid()) then
    raise exception 'Use Leave group to remove yourself' using errcode = '22023';
  end if;
  if not v_is_executive and not private.is_subgroup_lead_manager(p_subgroup_id) then
    raise exception 'Only group managers and executives can remove members' using errcode = '42501';
  end if;
  if not v_is_executive and exists (
    select 1 from public.subgroups where id = p_subgroup_id and archived_at is not null
  ) then
    raise exception 'This group is archived. An executive can restore it first.' using errcode = '22023';
  end if;

  select * into target
  from public.subgroup_memberships
  where subgroup_id = p_subgroup_id and member_id = p_member_id
  for update;
  if not found or target.status = 'removed' then
    raise exception 'That person is not in this group' using errcode = 'P0002';
  end if;
  if target.status in ('pending', 'waitlisted') then
    raise exception 'That person is waiting for review. Decline the request instead of removing them.' using errcode = '22023';
  end if;
  if not v_is_executive and target.membership_role <> 'member' then
    raise exception 'Only executives can remove a group leader or manager' using errcode = '42501';
  end if;

  update public.subgroup_memberships
  set status = 'removed',
      membership_role = 'member',
      reviewed_by = (select auth.uid()),
      status_updated_at = now()
  where subgroup_id = p_subgroup_id and member_id = p_member_id
  returning * into result;
  return result;
end;
$$;

-- create or replace keeps the existing grants; state them again so this file is
-- correct on its own, including on hosted default privileges.
revoke all on function public.remove_subgroup_member(bigint, uuid) from public, anon;
grant execute on function public.remove_subgroup_member(bigint, uuid) to authenticated;
